// Cloudflare D1 data layer — the SQL twin of mongoStore.js. Same exported API so the
// serverless backend can swap one import. D1 holds the tree (nodes table: folders +
// docs with HTML inline) and an app key/value table (auth + config); binary blobs live
// in R2 (referenced by r2_key). Accessed over D1's REST API via ./d1.js.
import crypto from 'node:crypto'
import * as d1 from './d1.js'
import * as r2 from './r2.js'

// Lazily ensure the schema exists (once per process).
let inited = null
async function ready() {
  if (!inited) inited = d1.d1InitSchema().catch((e) => { inited = null; throw e })
  return inited
}
const q = async (sql, params) => {
  await ready()
  return d1.d1Query(sql, params)
}
const first = async (sql, params) => {
  await ready()
  return d1.d1First(sql, params)
}
async function r2over() {
  return (await getConfig()).r2
}

// ---- posix path helpers ----
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
// escape LIKE wildcards so descendant matching ("dir/%") is literal
const likePrefix = (p) => p.replace(/[%_\\]/g, (c) => '\\' + c) + '/%'

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

async function exists(p) {
  const rows = await q('SELECT 1 FROM nodes WHERE path=? AND deleted=0 LIMIT 1', [p])
  return rows.length > 0
}
async function uniqueName(dir, name) {
  const ext = extname(name)
  const base = ext ? name.slice(0, -ext.length) : name
  let candidate = name
  let i = 1
  while (await exists(joinPath(dir, candidate))) candidate = `${base} (${i++})${ext}`
  return candidate
}

// ---- tree ----
export async function getTree() {
  const rows = await q('SELECT path,type,color,icon,size,updated_at FROM nodes WHERE deleted=0', [])
  const byPath = new Map()
  const mk = (path, type, extra = {}) => ({
    name: basename(path),
    path,
    type,
    ...extra,
    ...(type === 'folder' ? { children: [] } : {}),
  })
  for (const d of rows) {
    byPath.set(d.path, mk(d.path, d.type, { color: d.color, icon: d.icon, size: d.size, updatedAt: d.updated_at }))
  }
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
  for (const key of ['color', 'icon']) {
    if (key in body) await q(`UPDATE nodes SET ${key}=? WHERE path=?`, [body[key] || null, path])
  }
}

// ---- folders ----
export async function createFolder(parent, rawName, now) {
  const name = await uniqueName(parent || '', (rawName || 'New Folder').trim())
  const path = joinPath(parent || '', name)
  await q(
    `INSERT INTO nodes(path,type,updated_at,deleted,deleted_at) VALUES(?,?,?,0,NULL)
     ON CONFLICT(path) DO UPDATE SET type='folder', updated_at=excluded.updated_at, deleted=0, deleted_at=NULL`,
    [path, 'folder', now]
  )
  return path
}

// ---- rename / move (node + descendants) ----
async function reparent(oldPath, newPath, now) {
  const matched = await q('SELECT path FROM nodes WHERE path=? OR path LIKE ? ESCAPE ?', [oldPath, likePrefix(oldPath), '\\'])
  for (const m of matched) {
    const np = newPath + m.path.slice(oldPath.length)
    await q('UPDATE nodes SET path=?, updated_at=? WHERE path=?', [np, now, m.path])
  }
}
export async function renameNode(path, rawNew, now) {
  const dir = dirname(path)
  const node = await first('SELECT type FROM nodes WHERE path=?', [path])
  let newName = (rawNew || '').trim()
  if (node?.type === 'doc' && !newName.toLowerCase().endsWith('.html')) newName += '.html'
  newName = await uniqueName(dir, newName)
  const dest = joinPath(dir, newName)
  await reparent(path, dest, now)
  return dest
}
export async function moveNode(path, destDir, now) {
  const name = await uniqueName(destDir || '', basename(path))
  const dest = joinPath(destDir || '', name)
  await reparent(path, dest, now)
  return dest
}

// ---- delete (node + descendants + their R2 blobs) ----
export async function removeNode(path) {
  const matched = await q('SELECT path,r2_key FROM nodes WHERE path=? OR path LIKE ? ESCAPE ?', [path, likePrefix(path), '\\'])
  const over = await r2over()
  for (const m of matched) {
    if (m.r2_key) await r2.r2Delete(m.r2_key, over).catch(() => {})
  }
  await q('DELETE FROM nodes WHERE path=? OR path LIKE ? ESCAPE ?', [path, likePrefix(path), '\\'])
}

// ---- documents ----
async function upsertDoc(path, html, now) {
  await q(
    `INSERT INTO nodes(path,type,html,r2_key,size,updated_at,deleted,deleted_at)
       VALUES(?,?,?,NULL,NULL,?,0,NULL)
     ON CONFLICT(path) DO UPDATE SET type='doc', html=excluded.html, r2_key=NULL, updated_at=excluded.updated_at, deleted=0, deleted_at=NULL`,
    [path, 'doc', html, now]
  )
}
export async function newDoc(dir, rawName, now) {
  let name = (rawName || 'Untitled Document').trim()
  if (!name.toLowerCase().endsWith('.html')) name += '.html'
  name = await uniqueName(dir || '', name)
  const path = joinPath(dir || '', name)
  await upsertDoc(path, '<p></p>', now)
  return path
}
export async function getDoc(path) {
  const n = await first('SELECT html FROM nodes WHERE path=?', [path])
  if (!n) throw new Error('Document not found')
  return { path, title: basename(path).replace(/\.html$/i, ''), html: n.html ?? '' }
}
export async function saveDoc(path, html, now) {
  await upsertDoc(path, html ?? '', now)
}

// ---- binaries (always R2; D1 has no blob store) ----
async function upsertBinary(path, key, size, now) {
  await q(
    `INSERT INTO nodes(path,type,html,r2_key,size,updated_at,deleted,deleted_at)
       VALUES(?,?,NULL,?,?,?,0,NULL)
     ON CONFLICT(path) DO UPDATE SET type=excluded.type, html=NULL, r2_key=excluded.r2_key, size=excluded.size, updated_at=excluded.updated_at, deleted=0, deleted_at=NULL`,
    [path, nodeType(basename(path)), key, Number(size) || 0, now]
  )
}
export async function saveBinary(dir, originalName, buffer, now) {
  const over = await r2over()
  if (!r2.r2CanServe(over)) throw new Error('R2 must be configured to store files (D1 holds no blobs).')
  const name = await uniqueName(dir || '', originalName)
  const path = joinPath(dir || '', name)
  const key = `files/${crypto.randomUUID()}/${name}`
  await r2.r2Put(key, buffer, CONTENT_TYPE[extname(name)] || 'application/octet-stream', over)
  await upsertBinary(path, key, buffer.length, now)
  return path
}
export async function uniqueBinaryTarget(dir, name) {
  const uname = await uniqueName(dir || '', name)
  const path = joinPath(dir || '', uname)
  return { path, key: `files/${crypto.randomUUID()}/${uname}` }
}
export async function commitBinary(path, key, size, now) {
  await upsertBinary(path, key, size, now)
}
export async function getBinary(path) {
  const n = await first('SELECT r2_key FROM nodes WHERE path=?', [path])
  if (!n?.r2_key) return null
  const over = await r2over()
  const pub = r2.r2PublicUrl(n.r2_key, over)
  if (pub) return { redirect: pub }
  const got = await r2.r2Get(n.r2_key, over)
  return got || null
}

// ---- search corpus ----
export async function collectAll() {
  const rows = await q('SELECT path,type,html FROM nodes WHERE deleted=0', [])
  const acc = []
  for (const d of rows) {
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

// ---- settings / auth (app key/value table, JSON values) ----
const DEFAULT_CONFIG = {
  authMode: 'apikey',
  apiKey: '',
  oauthToken: '',
  model: 'claude-sonnet-4-6',
  r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '', publicUrl: '' },
}
async function appGet(id) {
  const row = await first('SELECT value FROM app WHERE id=?', [id])
  if (!row?.value) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}
async function appSet(id, obj) {
  await q(
    `INSERT INTO app(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`,
    [id, JSON.stringify(obj)]
  )
}
export async function getConfig() {
  await ready()
  return { ...DEFAULT_CONFIG, ...((await appGet('config')) || {}) }
}
export async function saveConfig(patch) {
  const cfg = await getConfig()
  if (patch.authMode === 'subscription' || patch.authMode === 'apikey') cfg.authMode = patch.authMode
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) cfg.apiKey = patch.apiKey.trim()
  if (typeof patch.oauthToken === 'string' && patch.oauthToken.trim()) cfg.oauthToken = patch.oauthToken.trim()
  if (patch.r2 && typeof patch.r2 === 'object') {
    cfg.r2 = { ...DEFAULT_CONFIG.r2, ...cfg.r2 }
    for (const k of ['accountId', 'accessKeyId', 'secretAccessKey', 'bucket', 'publicUrl']) {
      if (typeof patch.r2[k] === 'string' && patch.r2[k].trim()) cfg.r2[k] = patch.r2[k].trim()
    }
  }
  if (patch.model) cfg.model = patch.model
  await appSet('config', cfg)
  return cfg
}
export async function getAuth() {
  return appGet('auth')
}
export async function setAuth(doc) {
  await appSet('auth', doc)
}
export async function removeAuth() {
  await q('DELETE FROM app WHERE id=?', ['auth'])
}

// ---- storage usage (approximate: bytes of inline HTML) ----
export async function dbStats() {
  const rows = await q('SELECT COUNT(*) AS objects, COALESCE(SUM(LENGTH(html)),0) AS used FROM nodes WHERE deleted=0', [])
  const used = Number(rows[0]?.used || 0)
  return { used, dataSize: used, indexSize: 0, objects: Number(rows[0]?.objects || 0) }
}
