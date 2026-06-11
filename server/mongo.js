// MongoDB data layer for Entropy's cloud mirror.
// Stores the workspace as `nodes` documents (folders + docs inline; binaries in GridFS).
// Connection is lazy: nothing connects until the user goes Online with a URI configured.
import { MongoClient, GridFSBucket, ObjectId } from 'mongodb'
import { Readable } from 'node:stream'

let client = null
let db = null
let bucket = null
let currentUri = ''

export function connected() {
  return !!db
}

export async function connect(uri, dbName = 'entropy') {
  if (db && uri === currentUri) return
  await disconnect()
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  await client.connect()
  db = client.db(dbName)
  bucket = new GridFSBucket(db, { bucketName: 'files' })
  currentUri = uri
  await db.collection('nodes').createIndex({ path: 1 }, { unique: true })
}

export async function disconnect() {
  if (client) {
    try {
      await client.close()
    } catch {}
  }
  client = null
  db = null
  bucket = null
  currentUri = ''
}

// quick connectivity test (used by the Settings "test" / when toggling online)
export async function ping(uri, dbName = 'entropy') {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  try {
    await c.connect()
    await c.db(dbName).command({ ping: 1 })
    return true
  } finally {
    await c.close().catch(() => {})
  }
}

function nodes() {
  if (!db) throw new Error('MongoDB not connected')
  return db.collection('nodes')
}

// Full index of remote state (no heavy content) for reconciliation.
export async function remoteIndex() {
  const arr = await nodes()
    .find({}, { projection: { path: 1, type: 1, hash: 1, updatedAt: 1, deleted: 1, deletedAt: 1, size: 1 } })
    .toArray()
  const map = new Map()
  for (const n of arr) map.set(n.path, n)
  return map
}

export async function getDocHtml(path) {
  const n = await nodes().findOne({ path })
  return n?.html ?? ''
}

export async function getBinary(path) {
  const n = await nodes().findOne({ path })
  if (!n?.gridId) return null
  const chunks = []
  await new Promise((resolve, reject) => {
    bucket
      .openDownloadStream(n.gridId)
      .on('data', (c) => chunks.push(c))
      .on('end', resolve)
      .on('error', reject)
  })
  return Buffer.concat(chunks)
}

export async function upsertFolder(path, updatedAt) {
  await nodes().updateOne(
    { path },
    { $set: { path, type: 'folder', updatedAt, deleted: false }, $unset: { deletedAt: '' } },
    { upsert: true }
  )
}

export async function upsertDoc(path, html, hash, updatedAt) {
  await nodes().updateOne(
    { path },
    { $set: { path, type: 'doc', html, hash, updatedAt, deleted: false }, $unset: { deletedAt: '', gridId: '' } },
    { upsert: true }
  )
}

export async function upsertBinary(path, type, buffer, hash, updatedAt) {
  // remove any previous blob for this path
  const prev = await nodes().findOne({ path })
  if (prev?.gridId) await bucket.delete(prev.gridId).catch(() => {})
  const gridId = new ObjectId()
  await new Promise((resolve, reject) => {
    Readable.from(buffer)
      .pipe(bucket.openUploadStreamWithId(gridId, path))
      .on('finish', resolve)
      .on('error', reject)
  })
  await nodes().updateOne(
    { path },
    { $set: { path, type, gridId, hash, size: buffer.length, updatedAt, deleted: false }, $unset: { deletedAt: '', html: '' } },
    { upsert: true }
  )
}

export async function markDeleted(path, when) {
  const n = await nodes().findOne({ path })
  if (n?.gridId) await bucket.delete(n.gridId).catch(() => {})
  await nodes().updateOne(
    { path },
    { $set: { path, deleted: true, deletedAt: when, updatedAt: when }, $unset: { html: '', gridId: '' } },
    { upsert: true }
  )
}

// app credential (admin login) — stored hashed, never plaintext
export async function getAuth() {
  if (!db) return null
  return db.collection('app').findOne({ _id: 'auth' })
}
export async function setAuth(doc) {
  if (!db) return
  await db.collection('app').updateOne({ _id: 'auth' }, { $set: { _id: 'auth', ...doc } }, { upsert: true })
}
export async function removeAuth() {
  if (!db) return
  await db.collection('app').deleteOne({ _id: 'auth' })
}

// storage usage for the database (bytes)
export async function dbStats() {
  if (!db) throw new Error('MongoDB not connected')
  const s = await db.command({ dbStats: 1, scale: 1 })
  return {
    used: (s.dataSize || 0) + (s.indexSize || 0),
    dataSize: s.dataSize || 0,
    indexSize: s.indexSize || 0,
    storageSize: s.storageSize || 0,
    objects: s.objects || 0,
  }
}

// rename/move handled as delete(old) + upsert(new) by the sync layer.
