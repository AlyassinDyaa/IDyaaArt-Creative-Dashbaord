// Cloudflare D1 + R2 cloud mirror — a drop-in replacement for server/mongo.js used by
// the local sync engine (sync.js). Same function signatures, so the desktop app's
// Online toggle syncs the disk workspace to D1 (tree + doc HTML) and R2 (binaries)
// instead of MongoDB + GridFS.
import { randomUUID } from 'node:crypto'
import * as d1 from './d1.js'
import * as r2 from './r2.js'

let D1 = null // d1 creds
let R2 = null // r2 creds

export function connected() {
  return !!D1
}

// `cfg` is the full app config (has .d1 and .r2). Verifies creds + ensures schema.
export async function connect(cfg) {
  const d1cfg = cfg?.d1
  const r2cfg = cfg?.r2
  if (!d1.d1Enabled(d1cfg)) throw new Error('Cloudflare D1 is not configured.')
  if (!r2.r2CanServe(r2cfg)) throw new Error('Cloudflare R2 (with a public URL) is required for binary files.')
  await d1.d1InitSchema(d1cfg)
  D1 = d1cfg
  R2 = r2cfg
}

export async function disconnect() {
  D1 = null
  R2 = null
}

export async function ping(cfg) {
  await d1.d1Query('SELECT 1', [], cfg?.d1)
  return true
}

const q = (sql, params) => d1.d1Query(sql, params, D1)

// Full index of remote state (no heavy content) for reconciliation.
export async function remoteIndex() {
  const rows = await q('SELECT path,type,hash,size,updated_at,deleted,deleted_at FROM nodes', [])
  const map = new Map()
  for (const r of rows) {
    map.set(r.path, {
      path: r.path,
      type: r.type,
      hash: r.hash,
      size: r.size,
      updatedAt: r.updated_at,
      deleted: !!r.deleted,
      deletedAt: r.deleted_at,
    })
  }
  return map
}

export async function getDocHtml(path) {
  const n = await d1.d1First('SELECT html FROM nodes WHERE path=?', [path], D1)
  return n?.html ?? ''
}

export async function getBinary(path) {
  const n = await d1.d1First('SELECT r2_key FROM nodes WHERE path=?', [path], D1)
  if (!n?.r2_key) return null
  const got = await r2.r2Get(n.r2_key, R2)
  return got ? got.buffer : null
}

export async function upsertFolder(path, updatedAt) {
  await q(
    `INSERT INTO nodes(path,type,hash,updated_at,deleted,deleted_at) VALUES(?,?,?,?,0,NULL)
     ON CONFLICT(path) DO UPDATE SET type='folder', hash='folder', updated_at=excluded.updated_at, deleted=0, deleted_at=NULL`,
    [path, 'folder', 'folder', updatedAt]
  )
}

export async function upsertDoc(path, html, hash, updatedAt) {
  await q(
    `INSERT INTO nodes(path,type,html,r2_key,hash,size,updated_at,deleted,deleted_at) VALUES(?,?,?,NULL,?,NULL,?,0,NULL)
     ON CONFLICT(path) DO UPDATE SET type='doc', html=excluded.html, r2_key=NULL, hash=excluded.hash, updated_at=excluded.updated_at, deleted=0, deleted_at=NULL`,
    [path, 'doc', html, hash, updatedAt]
  )
}

export async function upsertBinary(path, type, buffer, hash, updatedAt) {
  // remove any previous blob for this path, then upload the new one to R2
  const prev = await d1.d1First('SELECT r2_key FROM nodes WHERE path=?', [path], D1)
  if (prev?.r2_key) await r2.r2Delete(prev.r2_key, R2).catch(() => {})
  const name = path.slice(path.lastIndexOf('/') + 1)
  const key = `files/${randomUUID()}/${name}`
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  await r2.r2Put(key, buffer, CONTENT_TYPE[ext] || 'application/octet-stream', R2)
  await q(
    `INSERT INTO nodes(path,type,html,r2_key,hash,size,updated_at,deleted,deleted_at) VALUES(?,?,NULL,?,?,?,?,0,NULL)
     ON CONFLICT(path) DO UPDATE SET type=excluded.type, html=NULL, r2_key=excluded.r2_key, hash=excluded.hash, size=excluded.size, updated_at=excluded.updated_at, deleted=0, deleted_at=NULL`,
    [path, type, key, hash, buffer.length, updatedAt]
  )
}

export async function markDeleted(path, when) {
  const n = await d1.d1First('SELECT r2_key FROM nodes WHERE path=?', [path], D1)
  if (n?.r2_key) await r2.r2Delete(n.r2_key, R2).catch(() => {})
  await q(
    `INSERT INTO nodes(path,type,hash,updated_at,deleted,deleted_at) VALUES(?,'file',NULL,?,1,?)
     ON CONFLICT(path) DO UPDATE SET html=NULL, r2_key=NULL, deleted=1, deleted_at=excluded.deleted_at, updated_at=excluded.updated_at`,
    [path, when, when]
  )
}

// app credential (admin login)
export async function getAuth() {
  if (!D1) return null
  const row = await d1.d1First('SELECT value FROM app WHERE id=?', ['auth'], D1)
  if (!row?.value) return null
  try { return JSON.parse(row.value) } catch { return null }
}
export async function setAuth(doc) {
  if (!D1) return
  await q('INSERT INTO app(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', ['auth', JSON.stringify(doc)])
}
export async function removeAuth() {
  if (!D1) return
  await q('DELETE FROM app WHERE id=?', ['auth'])
}

export async function dbStats() {
  const u = await d1.d1Usage(D1)
  return { used: u.used, dataSize: u.used, indexSize: 0, objects: u.objects }
}

const CONTENT_TYPE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
}
