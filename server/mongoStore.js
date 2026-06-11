// MongoDB-only data layer for the serverless (Vercel) backend.
// Unlike server/mongo.js (a cloud *mirror* of the disk workspace), this module treats
// MongoDB as the ONE source of truth — there is no filesystem on Vercel.
//
//   nodes  collection : the whole workspace (folders + docs inline, binaries -> GridFS)
//   app    collection : { _id:'auth' } admin credential, { _id:'config' } settings
//   files  GridFS      : raw binary uploads (images, pdfs, sheets, archives …)
import { MongoClient, GridFSBucket, ObjectId } from 'mongodb'
import { Readable } from 'node:stream'

// ---- connection (cached across serverless invocations) ----
const cache = globalThis.__idyaaMongo || (globalThis.__idyaaMongo = { client: null, db: null, promise: null })

export async function getDb() {
  if (cache.db) return cache.db
  if (!cache.promise) {
    const uri = process.env.MONGODB_URI
    if (!uri) throw new Error('MONGODB_URI environment variable is not set on the server.')
    if (/[<>]/.test(uri)) throw new Error('MONGODB_URI still contains a <placeholder> — put your real password in it.')
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 10 })
    cache.promise = client
      .connect()
      .then(async (c) => {
        cache.client = c
        cache.db = c.db(process.env.MONGODB_DB || 'entropy')
        await cache.db.collection('nodes').createIndex({ path: 1 }, { unique: true }).catch(() => {})
        return cache.db
      })
      .catch((e) => {
        cache.promise = null
        throw e
      })
  }
  return cache.promise
}

const nodes = (db) => db.collection('nodes')
const appcol = (db) => db.collection('app')
const bucketOf = (db) => new GridFSBucket(db, { bucketName: 'files' })

// ---- posix path helpers (paths are always forward-slash, relative to root) ----
const dirname = (p) => {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}
const basename = (p) => {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}
const extname = (p) => {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i).toLowerCase()
}
const joinPath = (dir, name) => (dir ? dir + '/' + name : name)
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'])
export function nodeType(name) {
  const e = extname(name)
  if (e === '.html') return 'doc'
  if (IMAGE.has(e)) return 'image'
  if (e === '.pdf') return 'pdf'
  if (['.xlsx', '.xls', '.csv'].includes(e)) return 'sheet'
  if (['.docx', '.doc'].includes(e)) return 'word'
  if (['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'].includes(e)) return 'archive'
  return 'file'
}
const CONTENT_TYPE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
}

async function exists(db, p) {
  return !!(await nodes(db).findOne({ path: p, deleted: { $ne: true } }, { projection: { _id: 1 } }))
}
async function uniqueName(db, dir, name) {
  const ext = extname(name)
  const base = ext ? name.slice(0, -ext.length) : name
  let candidate = name
  let i = 1
  while (await exists(db, joinPath(dir, candidate))) candidate = `${base} (${i++})${ext}`
  return candidate
}

// ---- tree ----
export async function getTree() {
  const db = await getDb()
  const docs = await nodes(db)
    .find({ deleted: { $ne: true } }, { projection: { html: 0 } })
    .toArray()
  const byPath = new Map()
  const mk = (path, type, extra = {}) => ({
    name: basename(path),
    path,
    type,
    ...extra,
    ...(type === 'folder' ? { children: [] } : {}),
  })
  for (const d of docs) {
    byPath.set(d.path, mk(d.path, d.type, { color: d.color, icon: d.icon, size: d.size, updatedAt: d.updatedAt }))
  }
  // synthesize any missing ancestor folders so orphans still appear
  for (const p of [...byPath.keys()]) {
    let dir = dirname(p)
    while (dir && !byPath.has(dir)) {
      byPath.set(dir, mk(dir, 'folder'))
      dir = dirname(dir)
    }
  }
  const roots = []
  for (const node of byPath.values()) {
    const dir = dirname(node.path)
    if (dir && byPath.get(dir)?.children) byPath.get(dir).children.push(node)
    else roots.push(node)
  }
  const sort = (arr) => {
    arr.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1))
    for (const n of arr) if (n.children) sort(n.children)
  }
  sort(roots)
  return roots
}

export async function setMeta(path, body) {
  const db = await getDb()
  const set = {}
  const unset = {}
  for (const key of ['color', 'icon']) {
    if (key in body) {
      if (body[key]) set[key] = body[key]
      else unset[key] = ''
    }
  }
  const update = {}
  if (Object.keys(set).length) update.$set = set
  if (Object.keys(unset).length) update.$unset = unset
  if (Object.keys(update).length) await nodes(db).updateOne({ path }, update)
}

// ---- folders ----
export async function createFolder(parent, rawName, now) {
  const db = await getDb()
  const name = await uniqueName(db, parent || '', (rawName || 'New Folder').trim())
  const path = joinPath(parent || '', name)
  await nodes(db).updateOne(
    { path },
    { $set: { path, type: 'folder', updatedAt: now, deleted: false }, $unset: { deletedAt: '' } },
    { upsert: true }
  )
  return path
}

// ---- rename / move (updates the node and all its descendants) ----
async function reparent(db, oldPath, newPath, now) {
  const matched = await nodes(db)
    .find({ $or: [{ path: oldPath }, { path: { $regex: '^' + reEscape(oldPath) + '/' } }] })
    .project({ path: 1 })
    .toArray()
  for (const m of matched) {
    const np = newPath + m.path.slice(oldPath.length)
    await nodes(db).updateOne({ _id: m._id }, { $set: { path: np, updatedAt: now } })
  }
}
export async function renameNode(path, rawNew, now) {
  const db = await getDb()
  const dir = dirname(path)
  const node = await nodes(db).findOne({ path })
  let newName = (rawNew || '').trim()
  if (node?.type === 'doc' && !newName.toLowerCase().endsWith('.html')) newName += '.html'
  newName = await uniqueName(db, dir, newName)
  const dest = joinPath(dir, newName)
  await reparent(db, path, dest, now)
  return dest
}
export async function moveNode(path, destDir, now) {
  const db = await getDb()
  const name = await uniqueName(db, destDir || '', basename(path))
  const dest = joinPath(destDir || '', name)
  await reparent(db, path, dest, now)
  return dest
}

// ---- delete (node + descendants, plus their blobs) ----
export async function removeNode(path) {
  const db = await getDb()
  const bucket = bucketOf(db)
  const matched = await nodes(db)
    .find({ $or: [{ path }, { path: { $regex: '^' + reEscape(path) + '/' } }] })
    .project({ path: 1, gridId: 1 })
    .toArray()
  for (const m of matched) {
    if (m.gridId) await bucket.delete(m.gridId).catch(() => {})
  }
  await nodes(db).deleteMany({ _id: { $in: matched.map((m) => m._id) } })
}

// ---- documents ----
export async function newDoc(dir, rawName, now) {
  const db = await getDb()
  let name = (rawName || 'Untitled Document').trim()
  if (!name.toLowerCase().endsWith('.html')) name += '.html'
  name = await uniqueName(db, dir || '', name)
  const path = joinPath(dir || '', name)
  await nodes(db).updateOne(
    { path },
    { $set: { path, type: 'doc', html: '<p></p>', updatedAt: now, deleted: false }, $unset: { deletedAt: '', gridId: '' } },
    { upsert: true }
  )
  return path
}
export async function getDoc(path) {
  const db = await getDb()
  const n = await nodes(db).findOne({ path })
  if (!n) throw new Error('Document not found')
  return { path, title: basename(path).replace(/\.html$/i, ''), html: n.html ?? '' }
}
export async function saveDoc(path, html, now) {
  const db = await getDb()
  await nodes(db).updateOne(
    { path },
    { $set: { path, type: 'doc', html: html ?? '', updatedAt: now, deleted: false }, $unset: { deletedAt: '', gridId: '' } },
    { upsert: true }
  )
}

// ---- binaries ----
export async function saveBinary(dir, originalName, buffer, now) {
  const db = await getDb()
  const bucket = bucketOf(db)
  const name = await uniqueName(db, dir || '', originalName)
  const path = joinPath(dir || '', name)
  const gridId = new ObjectId()
  await new Promise((resolve, reject) => {
    Readable.from(buffer).pipe(bucket.openUploadStreamWithId(gridId, path)).on('finish', resolve).on('error', reject)
  })
  await nodes(db).updateOne(
    { path },
    { $set: { path, type: nodeType(name), gridId, size: buffer.length, updatedAt: now, deleted: false }, $unset: { deletedAt: '', html: '' } },
    { upsert: true }
  )
  return path
}
export async function getBinary(path) {
  const db = await getDb()
  const n = await nodes(db).findOne({ path })
  if (!n?.gridId) return null
  const bucket = bucketOf(db)
  const chunks = []
  await new Promise((resolve, reject) => {
    bucket.openDownloadStream(n.gridId).on('data', (c) => chunks.push(c)).on('end', resolve).on('error', reject)
  })
  return { buffer: Buffer.concat(chunks), contentType: CONTENT_TYPE[extname(path)] || 'application/octet-stream' }
}

// ---- search corpus ----
export async function collectAll() {
  const db = await getDb()
  const docs = await nodes(db).find({ deleted: { $ne: true } }).toArray()
  const acc = []
  for (const d of docs) {
    if (d.type === 'folder') continue
    const folder = dirname(d.path)
    if (d.type === 'doc') {
      const html = d.html || ''
      const body = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const title = basename(d.path).replace(/\.html$/i, '')
      acc.push({ path: d.path, title, type: 'doc', folder, text: title + ' ' + body, body })
    } else {
      const title = basename(d.path)
      acc.push({ path: d.path, title, type: d.type, folder, text: title + ' ' + d.path.replace(/[\/_-]/g, ' '), body: '' })
    }
  }
  return acc
}

// ---- settings (config) ----
const DEFAULT_CONFIG = { authMode: 'apikey', apiKey: '', oauthToken: '', model: 'claude-sonnet-4-6' }
export async function getConfig() {
  const db = await getDb()
  const c = await appcol(db).findOne({ _id: 'config' })
  return { ...DEFAULT_CONFIG, ...(c || {}) }
}
export async function saveConfig(patch) {
  const db = await getDb()
  const cfg = await getConfig()
  if (patch.authMode === 'subscription' || patch.authMode === 'apikey') cfg.authMode = patch.authMode
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) cfg.apiKey = patch.apiKey.trim()
  if (typeof patch.oauthToken === 'string' && patch.oauthToken.trim()) cfg.oauthToken = patch.oauthToken.trim()
  if (patch.model) cfg.model = patch.model
  await appcol(db).updateOne({ _id: 'config' }, { $set: { _id: 'config', ...cfg } }, { upsert: true })
  return cfg
}

// ---- admin credential ----
export async function getAuth() {
  const db = await getDb()
  return appcol(db).findOne({ _id: 'auth' })
}
export async function setAuth(doc) {
  const db = await getDb()
  await appcol(db).updateOne({ _id: 'auth' }, { $set: { _id: 'auth', ...doc } }, { upsert: true })
}
export async function removeAuth() {
  const db = await getDb()
  await appcol(db).deleteOne({ _id: 'auth' })
}

// ---- storage usage ----
export async function dbStats() {
  const db = await getDb()
  const s = await db.command({ dbStats: 1, scale: 1 })
  return { used: (s.dataSize || 0) + (s.indexSize || 0), dataSize: s.dataSize || 0, indexSize: s.indexSize || 0, objects: s.objects || 0 }
}
