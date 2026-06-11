// Entropy backend — Express server.
// Responsibilities:
//   • Real file/folder management inside a workspace directory on disk
//   • Document load/save (stored as portable .html files)
//   • Uploads + import/convert of Word (.docx), Excel (.xlsx/.csv) and PDF
//   • Serving raw files (images, pdfs) to the client
//   • Proxying the Anthropic (Claude) API so the key never lives in the browser
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import Anthropic from '@anthropic-ai/sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import * as mongo from './mongo.js'
import * as sync from './sync.js'
import { promises as fs } from 'node:fs'
import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const WORKSPACE = process.env.ENTROPY_WORKSPACE || path.join(ROOT, 'entropy-workspace')
const CONFIG_DIR = path.join(ROOT, '.entropy')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const PORT = process.env.PORT || 5174

mkdirSync(WORKSPACE, { recursive: true })
mkdirSync(CONFIG_DIR, { recursive: true })
sync.init(WORKSPACE, CONFIG_DIR)

// Whether live cloud mirroring is active this session.
let SYNC_ON = false
// Fire-and-forget mirror of a local change to Mongo (never breaks the local op).
async function mirror(fn) {
  if (!SYNC_ON || !mongo.connected()) return
  try {
    await fn()
  } catch (e) {
    console.error('[sync mirror]', e.message)
  }
}

// ---------- config (auth + model) ----------
// authMode 'subscription' → Claude Agent SDK billed against the user's Max/Pro plan
//          'apikey'       → raw Anthropic API billed per-token
const DEFAULT_CONFIG = {
  authMode: 'subscription',
  oauthToken: '',
  apiKey: '',
  model: 'claude-sonnet-4-6',
  mode: 'offline', // 'offline' = disk only, 'online' = mirror to MongoDB
  mongoUri: '',
}
async function readConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}
// is the configured auth method actually usable?
function isConnected(cfg) {
  return cfg.authMode === 'apikey' ? !!cfg.apiKey : !!cfg.oauthToken
}
async function writeConfig(cfg) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

// ---------- safe path handling (prevent escaping the workspace) ----------
function safe(rel) {
  const clean = path.normalize(rel || '').replace(/^(\.\.(\/|\\|$))+/, '')
  const abs = path.join(WORKSPACE, clean)
  if (!abs.startsWith(WORKSPACE)) throw new Error('Invalid path')
  return abs
}
function relOf(abs) {
  return path.relative(WORKSPACE, abs).split(path.sep).join('/')
}

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'])
function nodeType(name) {
  const e = path.extname(name).toLowerCase()
  if (e === '.html') return 'doc'
  if (IMAGE.has(e)) return 'image'
  if (e === '.pdf') return 'pdf'
  if (['.xlsx', '.xls', '.csv'].includes(e)) return 'sheet'
  if (['.docx', '.doc'].includes(e)) return 'word'
  if (['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'].includes(e)) return 'archive'
  return 'file'
}

// ---------- node metadata (colors) ----------
const META_FILE = path.join(CONFIG_DIR, 'meta.json')
async function readMeta() {
  try {
    return JSON.parse(await fs.readFile(META_FILE, 'utf8'))
  } catch {
    return {}
  }
}
async function writeMeta(m) {
  await fs.writeFile(META_FILE, JSON.stringify(m, null, 2))
}
// move metadata when a node is renamed/moved (covers descendants)
async function migrateMeta(oldPath, newPath) {
  const meta = await readMeta()
  let changed = false
  for (const k of Object.keys(meta)) {
    if (k === oldPath || k.startsWith(oldPath + '/')) {
      meta[newPath + k.slice(oldPath.length)] = meta[k]
      delete meta[k]
      changed = true
    }
  }
  if (changed) await writeMeta(meta)
}
async function removeMeta(p) {
  const meta = await readMeta()
  let changed = false
  for (const k of Object.keys(meta)) if (k === p || k.startsWith(p + '/')) { delete meta[k]; changed = true }
  if (changed) await writeMeta(meta)
}

// recursively build the tree
async function buildTree(absDir, meta) {
  const entries = await fs.readdir(absDir, { withFileTypes: true })
  const nodes = []
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const abs = path.join(absDir, ent.name)
    const rel = relOf(abs)
    if (ent.isDirectory()) {
      nodes.push({
        name: ent.name,
        path: rel,
        type: 'folder',
        color: meta[rel]?.color,
        icon: meta[rel]?.icon,
        children: await buildTree(abs, meta),
      })
    } else {
      const stat = await fs.stat(abs)
      nodes.push({
        name: ent.name,
        path: rel,
        type: nodeType(ent.name),
        color: meta[rel]?.color,
        size: stat.size,
        updatedAt: stat.mtimeMs,
      })
    }
  }
  // folders first, then alphabetical
  nodes.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1
  )
  return nodes
}

// ---------- app ----------
const app = express()
app.use(cors())
app.use(express.json({ limit: '64mb' }))

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 128 * 1024 * 1024 } })

// helper: ensure unique filename in a dir
async function uniqueName(absDir, name) {
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  let candidate = name
  let i = 1
  while (existsSync(path.join(absDir, candidate))) candidate = `${base} (${i++})${ext}`
  return candidate
}

// === TREE ===
app.get('/api/tree', async (_req, res) => {
  try {
    const meta = await readMeta()
    res.json({ tree: await buildTree(WORKSPACE, meta) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// set/clear a node's color and/or icon (only fields present in the body are changed)
app.post('/api/meta', async (req, res) => {
  try {
    const p = req.body.path
    const meta = await readMeta()
    if (!meta[p]) meta[p] = {}
    for (const key of ['color', 'icon']) {
      if (key in req.body) {
        if (req.body[key]) meta[p][key] = req.body[key]
        else delete meta[p][key]
      }
    }
    if (Object.keys(meta[p]).length === 0) delete meta[p]
    await writeMeta(meta)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === CREATE PROJECT (top-level folder) ===
app.post('/api/project', async (req, res) => {
  try {
    const name = (req.body.name || 'Untitled Project').trim()
    const abs = safe(await uniqueName(WORKSPACE, name))
    await fs.mkdir(abs, { recursive: true })
    await mirror(() => sync.mirrorUpsert(relOf(abs)))
    res.json({ path: relOf(abs) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === CREATE FOLDER ===
app.post('/api/folder', async (req, res) => {
  try {
    const parent = safe(req.body.parent || '')
    const name = await uniqueName(parent, (req.body.name || 'New Folder').trim())
    const abs = path.join(parent, name)
    await fs.mkdir(abs, { recursive: true })
    await mirror(() => sync.mirrorUpsert(relOf(abs)))
    res.json({ path: relOf(abs) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === RENAME ===
app.post('/api/rename', async (req, res) => {
  try {
    const abs = safe(req.body.path)
    const dir = path.dirname(abs)
    let newName = req.body.newName.trim()
    // preserve .html extension for docs
    if (nodeType(abs) === 'doc' && !newName.toLowerCase().endsWith('.html')) newName += '.html'
    const dest = path.join(dir, newName)
    const oldRel = relOf(abs)
    await fs.rename(abs, dest)
    await migrateMeta(oldRel, relOf(dest))
    await mirror(async () => {
      await sync.mirrorDelete(oldRel)
      await sync.mirrorUpsert(relOf(dest))
    })
    res.json({ path: relOf(dest) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === MOVE ===
app.post('/api/move', async (req, res) => {
  try {
    const abs = safe(req.body.path)
    const destDir = safe(req.body.destDir || '')
    const name = await uniqueName(destDir, path.basename(abs))
    const dest = path.join(destDir, name)
    const oldRel = relOf(abs)
    await fs.rename(abs, dest)
    await migrateMeta(oldRel, relOf(dest))
    await mirror(async () => {
      await sync.mirrorDelete(oldRel)
      await sync.mirrorUpsert(relOf(dest))
    })
    res.json({ path: relOf(dest) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === DELETE ===
app.delete('/api/node', async (req, res) => {
  try {
    const abs = safe(req.body.path)
    const rel = relOf(abs)
    await fs.rm(abs, { recursive: true, force: true })
    await removeMeta(rel)
    await mirror(() => sync.mirrorDelete(rel))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === DOCUMENTS ===
// create new empty document
app.post('/api/doc/new', async (req, res) => {
  try {
    const dir = safe(req.body.dir || '')
    let name = (req.body.name || 'Untitled Document').trim()
    if (!name.toLowerCase().endsWith('.html')) name += '.html'
    name = await uniqueName(dir, name)
    const abs = path.join(dir, name)
    await fs.writeFile(abs, '<p></p>')
    await mirror(() => sync.mirrorUpsert(relOf(abs)))
    res.json({ path: relOf(abs) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// load document html
app.get('/api/doc', async (req, res) => {
  try {
    const abs = safe(req.query.path)
    const html = await fs.readFile(abs, 'utf8')
    res.json({ path: relOf(abs), title: path.basename(abs, '.html'), html })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// save document html
app.put('/api/doc', async (req, res) => {
  try {
    const abs = safe(req.body.path)
    await fs.writeFile(abs, req.body.html ?? '')
    await mirror(() => sync.mirrorUpsert(relOf(abs)))
    res.json({ ok: true, updatedAt: Date.now() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === UPLOAD (store file as-is anywhere in the tree) ===
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const dir = safe(req.body.dir || '')
    await fs.mkdir(dir, { recursive: true })
    const saved = []
    for (const f of req.files) {
      const original = Buffer.from(f.originalname, 'latin1').toString('utf8')
      const name = await uniqueName(dir, original)
      await fs.writeFile(path.join(dir, name), f.buffer)
      saved.push(relOf(path.join(dir, name)))
    }
    await mirror(async () => {
      for (const p of saved) await sync.mirrorUpsert(p)
    })
    res.json({ saved })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === IMPORT (convert docx/xlsx/csv to editor HTML; returns html, optionally saves a doc) ===
app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    const f = req.file
    const ext = path.extname(f.originalname).toLowerCase()
    let html = ''
    if (ext === '.docx') {
      const result = await mammoth.convertToHtml({ buffer: f.buffer })
      html = result.value
    } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      const wb = XLSX.read(f.buffer, { type: 'buffer' })
      html = wb.SheetNames.map((n) => {
        const sheetHtml = XLSX.utils.sheet_to_html(wb.Sheets[n])
        return `<h3>${n}</h3>${sheetHtml}`
      }).join('<hr/>')
    } else if (ext === '.html' || ext === '.htm') {
      html = f.buffer.toString('utf8')
    } else if (ext === '.txt' || ext === '.md') {
      html = f.buffer
        .toString('utf8')
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
        .join('')
    } else {
      return res.status(400).json({ error: `Cannot convert ${ext} to a document` })
    }

    // optionally persist as a new doc in a target dir
    if (req.body.dir !== undefined) {
      const dir = safe(req.body.dir || '')
      let name = path.basename(f.originalname, ext) + '.html'
      name = await uniqueName(dir, name)
      const abs = path.join(dir, name)
      await fs.writeFile(abs, html)
      await mirror(() => sync.mirrorUpsert(relOf(abs)))
      return res.json({ html, path: relOf(abs) })
    }
    res.json({ html })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === CONVERT an existing workspace file (docx/xlsx/csv/txt/md) to editor HTML ===
app.post('/api/convert', async (req, res) => {
  try {
    const abs = safe(req.body.path)
    const ext = path.extname(abs).toLowerCase()
    const buffer = await fs.readFile(abs)
    let html = ''
    if (ext === '.docx') {
      html = (await mammoth.convertToHtml({ buffer })).value
    } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      const wb = XLSX.read(buffer, { type: 'buffer' })
      html = wb.SheetNames.map((n) => `<h3>${n}</h3>${XLSX.utils.sheet_to_html(wb.Sheets[n])}`).join('<hr/>')
    } else if (['.txt', '.md'].includes(ext)) {
      html = buffer
        .toString('utf8')
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
        .join('')
    } else {
      return res.status(400).json({ error: `Cannot convert ${ext}` })
    }
    if (req.body.save) {
      const dir = path.dirname(abs)
      let name = await uniqueName(dir, path.basename(abs, ext) + '.html')
      const dest = path.join(dir, name)
      await fs.writeFile(dest, html)
      await mirror(() => sync.mirrorUpsert(relOf(dest)))
      return res.json({ html, path: relOf(dest) })
    }
    res.json({ html })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === SERVE RAW FILES (images, pdfs, etc.) ===
app.get(/^\/files\/(.+)/, (req, res) => {
  try {
    const abs = safe(decodeURIComponent(req.params[0]))
    if (!existsSync(abs)) return res.status(404).end()
    createReadStream(abs).pipe(res)
  } catch (e) {
    res.status(400).end()
  }
})

// === SETTINGS ===
function settingsView(cfg) {
  return {
    authMode: cfg.authMode,
    connected: isConnected(cfg),
    hasKey: isConnected(cfg), // kept for backwards-compat with the client
    model: cfg.model || 'claude-sonnet-4-6',
    mode: cfg.mode || 'offline',
    online: SYNC_ON && mongo.connected(),
    hasMongo: !!(cfg.mongoUri || process.env.MONGODB_URI),
  }
}
app.get('/api/settings', async (_req, res) => {
  res.json(settingsView(await readConfig()))
})
app.put('/api/settings', async (req, res) => {
  const cfg = await readConfig()
  if (req.body.authMode === 'subscription' || req.body.authMode === 'apikey') cfg.authMode = req.body.authMode
  if (typeof req.body.apiKey === 'string' && req.body.apiKey.trim()) cfg.apiKey = req.body.apiKey.trim()
  if (typeof req.body.oauthToken === 'string' && req.body.oauthToken.trim()) cfg.oauthToken = req.body.oauthToken.trim()
  if (typeof req.body.mongoUri === 'string' && req.body.mongoUri.trim()) cfg.mongoUri = req.body.mongoUri.trim()
  if (req.body.model) cfg.model = req.body.model
  await writeConfig(cfg)
  res.json(settingsView(cfg))
})

// === APP LOCK (admin passcode) ===
// Stored hashed locally (offline) and mirrored to MongoDB (online). Never stores plaintext.
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json')
function makeHash(passcode) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(passcode, salt, 64).toString('hex')
  return { salt, hash }
}
function verifyHash(passcode, salt, hash) {
  try {
    const h = crypto.scryptSync(String(passcode), salt, 64).toString('hex')
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash))
  } catch {
    return false
  }
}
async function readLocalAuth() {
  try {
    return JSON.parse(await fs.readFile(AUTH_FILE, 'utf8'))
  } catch {
    return null
  }
}
// the active credential: local file, or pulled from Mongo (and cached locally) when online
async function currentAuth() {
  let a = await readLocalAuth()
  if (!a && SYNC_ON && mongo.connected()) {
    const m = await mongo.getAuth().catch(() => null)
    if (m) {
      a = { username: m.username || '', salt: m.salt, hash: m.hash }
      await fs.writeFile(AUTH_FILE, JSON.stringify(a))
    }
  }
  return a
}

app.get('/api/auth/status', async (_req, res) => {
  const a = await currentAuth()
  res.json({ configured: !!a, username: a?.username || '' })
})

app.post('/api/auth/set', async (req, res) => {
  const { username = '', passcode, current } = req.body
  if (!passcode || String(passcode).length < 4)
    return res.status(400).json({ error: 'Passcode must be at least 4 characters.' })
  const existing = await currentAuth()
  if (existing && !verifyHash(current, existing.salt, existing.hash))
    return res.status(403).json({ error: 'Current passcode is incorrect.' })
  const { salt, hash } = makeHash(String(passcode))
  const doc = { username: String(username).slice(0, 60), salt, hash }
  await fs.writeFile(AUTH_FILE, JSON.stringify(doc))
  if (SYNC_ON && mongo.connected()) await mongo.setAuth(doc).catch(() => {})
  res.json({ ok: true })
})

app.post('/api/auth/unlock', async (req, res) => {
  const a = await currentAuth()
  if (!a) return res.json({ ok: true }) // no lock configured
  if (verifyHash(req.body.passcode, a.salt, a.hash)) return res.json({ ok: true })
  res.status(401).json({ error: 'Incorrect passcode.' })
})

app.post('/api/auth/remove', async (req, res) => {
  const a = await currentAuth()
  if (a && !verifyHash(req.body.passcode, a.salt, a.hash))
    return res.status(403).json({ error: 'Passcode is incorrect.' })
  await fs.rm(AUTH_FILE, { force: true }).catch(() => {})
  if (SYNC_ON && mongo.connected()) await mongo.removeAuth().catch(() => {})
  res.json({ ok: true })
})

// === SYNC / ONLINE-OFFLINE MODE ===
app.get('/api/sync/status', async (_req, res) => {
  const cfg = await readConfig()
  res.json({
    mode: cfg.mode || 'offline',
    online: SYNC_ON && mongo.connected(),
    hasMongo: !!(cfg.mongoUri || process.env.MONGODB_URI),
  })
})

app.put('/api/mode', async (req, res) => {
  const cfg = await readConfig()
  if (req.body.mode === 'offline') {
    cfg.mode = 'offline'
    await writeConfig(cfg)
    SYNC_ON = false
    await mongo.disconnect()
    return res.json({ mode: 'offline', online: false })
  }
  if (req.body.mode === 'online') {
    const uri = cfg.mongoUri || process.env.MONGODB_URI
    if (!uri) return res.status(400).json({ error: 'Add your MongoDB connection string in Settings first.' })
    if (/[<>]/.test(uri))
      return res.status(400).json({
        error: 'Your connection string still has the <db_password> placeholder — replace it with your real password in Settings.',
      })
    try {
      await mongo.connect(uri)
      SYNC_ON = true
      cfg.mode = 'online'
      await writeConfig(cfg)
      const summary = await sync.reconcile() // two-way reconcile on going online
      return res.json({ mode: 'online', online: true, summary })
    } catch (e) {
      SYNC_ON = false
      await mongo.disconnect()
      return res.status(500).json({ error: 'Could not go online: ' + e.message })
    }
  }
  res.status(400).json({ error: 'Unknown mode' })
})

app.post('/api/sync', async (_req, res) => {
  if (!SYNC_ON || !mongo.connected()) return res.status(400).json({ error: 'Not online' })
  try {
    res.json({ summary: await sync.reconcile() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// cloud storage usage (MongoDB). Limit defaults to the Atlas free-tier 512 MB.
const STORAGE_LIMIT = Number(process.env.ENTROPY_STORAGE_LIMIT || 512 * 1024 * 1024)
app.get('/api/storage', async (_req, res) => {
  if (!SYNC_ON || !mongo.connected()) return res.json({ connected: false })
  try {
    const stats = await mongo.dbStats()
    res.json({ connected: true, limit: STORAGE_LIMIT, ...stats })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === CLAUDE ===
// Unified text generation. Routes to the Agent SDK (subscription) or the raw API.
// `messages` is a [{role, content}] conversation; `system` is the system prompt.
async function generate(cfg, { system, messages }) {
  if (!isConnected(cfg)) {
    throw new Error(
      cfg.authMode === 'apikey'
        ? 'No Anthropic API key set. Add one in Settings.'
        : 'Claude is not connected. Add your Max subscription token in Settings.'
    )
  }

  if (cfg.authMode === 'subscription') {
    // Drive Claude through the user's subscription via the Agent SDK.
    // The SDK spawns a subprocess that reads CLAUDE_CODE_OAUTH_TOKEN from env.
    const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    const prevKey = process.env.ANTHROPIC_API_KEY
    process.env.CLAUDE_CODE_OAUTH_TOKEN = cfg.oauthToken
    delete process.env.ANTHROPIC_API_KEY // ensure the API key path doesn't win precedence
    try {
      // Flatten the conversation into a single prompt (one-shot, no tools).
      const prompt = messages
        .map((m) => (m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`))
        .join('\n\n')
      let text = ''
      for await (const msg of query({
        prompt,
        options: {
          model: cfg.model || 'claude-sonnet-4-6',
          systemPrompt: system,
          maxTurns: 1,
          allowedTools: [], // plain chat: no file/tool access
          permissionMode: 'default',
        },
      })) {
        if (msg.type === 'result') {
          if (msg.subtype === 'success') text = msg.result
          else throw new Error(msg.subtype === 'error_max_turns' ? 'Response was cut off.' : 'Claude could not complete the request.')
        }
      }
      return text
    } finally {
      if (prevToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevToken
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey
    }
  }

  // raw API path
  const client = new Anthropic({ apiKey: cfg.apiKey })
  const msg = await client.messages.create({
    model: cfg.model || 'claude-sonnet-4-6',
    max_tokens: 2048,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  })
  return msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('')
}

// gather searchable items across every project/folder.
// Documents contribute their text; all other files (images, pdfs, …) are searchable by name.
async function collectAll(absDir = WORKSPACE, acc = []) {
  const entries = await fs.readdir(absDir, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const abs = path.join(absDir, ent.name)
    if (ent.isDirectory()) {
      await collectAll(abs, acc)
    } else {
      const type = nodeType(ent.name)
      const rel = relOf(abs)
      const folder = path.dirname(rel) === '.' ? '' : path.dirname(rel)
      if (type === 'doc') {
        const html = await fs.readFile(abs, 'utf8')
        const body = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        const title = path.basename(ent.name, '.html')
        acc.push({ path: rel, title, type, folder, text: title + ' ' + body, body })
      } else {
        acc.push({ path: rel, title: ent.name, type, folder, text: ent.name + ' ' + rel.replace(/[\/_-]/g, ' '), body: '' })
      }
    }
  }
  return acc
}

// chat / Q&A — optionally with selected-document context
app.post('/api/ai/chat', async (req, res) => {
  try {
    const cfg = await readConfig()
    const { messages = [], context = '', system: extraSystem = '' } = req.body
    let system =
      'You are Claude, the writing assistant inside "IDyaaArt", an app for authoring stories and graphic novels. ' +
      'Help with prose, structure, worldbuilding, editing and answering questions. Be concise and concrete. ' +
      extraSystem
    if (context) system += `\n\nThe user is currently working on this document:\n"""\n${context.slice(0, 12000)}\n"""`

    const text = await generate(cfg, { system, messages })
    res.json({ text })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// semantic-ish search across all documents using Claude
app.post('/api/ai/search', async (req, res) => {
  try {
    const cfg = await readConfig()
    const query = req.body.query || ''
    const items = await collectAll()
    // quick local keyword prefilter across names + content
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const scored = items
      .map((d) => {
        const hay = d.text.toLowerCase()
        // title matches weigh more than body matches
        const titleHay = d.title.toLowerCase()
        const score = terms.reduce(
          (s, t) => s + (titleHay.includes(t) ? 3 : 0) + (hay.includes(t) ? 1 : 0),
          0
        )
        return { ...d, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)

    const toResult = (d) => ({
      path: d.path,
      title: d.title,
      type: d.type,
      snippet: d.type === 'doc' && d.body ? d.body.slice(0, 240) : `${d.type} · ${d.folder || 'workspace'}`,
    })

    if (!isConnected(cfg)) {
      return res.json({ results: scored.filter((d) => d.score > 0).map(toResult), answer: '' })
    }

    // build the AI corpus from the matched documents (files appear in results by name)
    const corpus = scored
      .filter((d) => d.type === 'doc' && d.body)
      .slice(0, 8)
      .map((d) => `### ${d.title} (${d.path})\n${d.body.slice(0, 3000)}`)
      .join('\n\n')
    const answer = await generate(cfg, {
      system:
        "You search a writer's document library. Given a query and document excerpts, " +
        'answer the query and cite which documents (by title) are most relevant. Be brief. ' +
        'If no documents are relevant, say so.',
      messages: [{ role: 'user', content: `Query: ${query}\n\nDocuments:\n${corpus || '(no text documents matched)'}` }],
    })
    res.json({
      answer,
      results: scored.filter((d) => d.score > 0).map(toResult),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// === serve built client in production ===
const dist = path.join(ROOT, 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api|\/files).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.listen(PORT, async () => {
  console.log(`IDyaaArt backend → http://localhost:${PORT}`)
  console.log(`Workspace: ${WORKSPACE}`)
  // If the user left the app in Online mode, reconnect + reconcile on boot.
  const cfg = await readConfig()
  const uri = cfg.mongoUri || process.env.MONGODB_URI
  if (cfg.mode === 'online' && uri) {
    try {
      await mongo.connect(uri)
      SYNC_ON = true
      const summary = await sync.reconcile()
      console.log('[sync] online — reconciled', summary)
    } catch (e) {
      SYNC_ON = false
      console.error('[sync] could not go online on boot:', e.message)
    }
  }
})
