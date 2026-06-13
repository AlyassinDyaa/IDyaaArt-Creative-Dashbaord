// Serverless backend for Vercel — the same API as server/index.js, but backed entirely
// by MongoDB (Vercel has no persistent disk). Exported as an Express app; Vercel invokes it
// for every /api/* and /files/* request (see vercel.json rewrites).
//
// Differences from the local disk server, all forced by the serverless platform:
//   • Storage is MongoDB + GridFS (no filesystem).
//   • Claude runs through the raw Anthropic API (an API key) — the Max/Pro subscription path
//     uses the Agent SDK, which spawns a CLI subprocess and cannot run on Vercel.
//   • Uploads are limited by Vercel's request body cap (~4.5 MB on the Hobby plan).
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import Anthropic from '@anthropic-ai/sdk'
import crypto from 'node:crypto'
import * as store from '../server/d1Store.js'
import * as r2 from '../server/r2.js'
import * as d1 from '../server/d1.js'

const app = express()
app.use(cors())

// Body handling that works both under Vercel (which may pre-parse JSON onto req.body)
// and standalone. Multipart is left for multer; JSON is parsed if not already present.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  const ct = String(req.headers['content-type'] || '')
  if (ct.includes('multipart/form-data')) return next()
  if (req.body && typeof req.body === 'object') return next() // already parsed by the platform
  let data = ''
  req.setEncoding('utf8')
  req.on('data', (c) => (data += c))
  req.on('end', () => {
    try {
      req.body = data ? JSON.parse(data) : {}
    } catch {
      req.body = {}
    }
    next()
  })
  req.on('error', () => {
    req.body = {}
    next()
  })
})

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024 } })
const now = () => Date.now()
const fail = (res, e) => res.status(500).json({ error: e?.message || String(e) })

// ---------- tree / meta ----------
app.get('/api/tree', async (_req, res) => {
  try {
    res.json({ tree: await store.getTree() })
  } catch (e) {
    fail(res, e)
  }
})
app.post('/api/meta', async (req, res) => {
  try {
    await store.setMeta(req.body.path, req.body)
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
})

// ---------- folders ----------
app.post('/api/project', async (req, res) => {
  try {
    res.json({ path: await store.createFolder('', req.body.name || 'Untitled Project', now()) })
  } catch (e) {
    fail(res, e)
  }
})
app.post('/api/folder', async (req, res) => {
  try {
    res.json({ path: await store.createFolder(req.body.parent || '', req.body.name, now()) })
  } catch (e) {
    fail(res, e)
  }
})
app.post('/api/rename', async (req, res) => {
  try {
    res.json({ path: await store.renameNode(req.body.path, req.body.newName, now()) })
  } catch (e) {
    fail(res, e)
  }
})
app.post('/api/move', async (req, res) => {
  try {
    res.json({ path: await store.moveNode(req.body.path, req.body.destDir || '', now()) })
  } catch (e) {
    fail(res, e)
  }
})
app.delete('/api/node', async (req, res) => {
  try {
    await store.removeNode(req.body.path)
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
})

// ---------- documents ----------
app.post('/api/doc/new', async (req, res) => {
  try {
    res.json({ path: await store.newDoc(req.body.dir || '', req.body.name, now()) })
  } catch (e) {
    fail(res, e)
  }
})
app.get('/api/doc', async (req, res) => {
  try {
    res.json(await store.getDoc(req.query.path))
  } catch (e) {
    fail(res, e)
  }
})
app.put('/api/doc', async (req, res) => {
  try {
    await store.saveDoc(req.body.path, req.body.html ?? '', now())
    res.json({ ok: true, updatedAt: now() })
  } catch (e) {
    fail(res, e)
  }
})

// ---------- uploads ----------
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const dir = req.body.dir || ''
    const saved = []
    for (const f of req.files || []) {
      const original = Buffer.from(f.originalname, 'latin1').toString('utf8')
      saved.push(await store.saveBinary(dir, original, f.buffer, now()))
    }
    res.json({ saved })
  } catch (e) {
    fail(res, e)
  }
})

// ---------- presigned direct uploads (browser -> R2, bypasses Vercel's ~4.5MB body cap) ----------
app.post('/api/upload/presign', async (req, res) => {
  try {
    const cfg = await store.getConfig()
    if (!r2.r2CanServe(cfg.r2)) return res.json({ enabled: false })
    const { dir = '', name = 'file', contentType = 'application/octet-stream' } = req.body || {}
    const { path, key } = await store.uniqueBinaryTarget(dir, name)
    const url = await r2.r2PresignPut(key, contentType, cfg.r2)
    res.json({ enabled: true, url, key, path })
  } catch (e) {
    fail(res, e)
  }
})
// Register the node after the browser finished PUTting the bytes to R2.
app.post('/api/upload/commit', async (req, res) => {
  try {
    const { path, key, size = 0 } = req.body || {}
    if (!path || !key) return res.status(400).json({ error: 'Missing path or key' })
    await store.commitBinary(path, key, size, now())
    res.json({ ok: true, path })
  } catch (e) {
    fail(res, e)
  }
})

// ---------- inline editor image -> R2 (avoids base64-bloated documents) ----------
app.post('/api/image', upload.single('file'), async (req, res) => {
  try {
    const cfg = await store.getConfig()
    if (!r2.r2CanServe(cfg.r2)) return res.json({ enabled: false })
    if (!req.file) return res.status(400).json({ error: 'No file' })
    const ext = (req.file.originalname.match(/\.[a-z0-9]+$/i)?.[0] || '.png').toLowerCase()
    const key = `images/${crypto.randomUUID()}${ext}`
    const url = await r2.r2Put(key, req.file.buffer, req.file.mimetype || 'image/png', cfg.r2)
    res.json({ enabled: true, url, key })
  } catch (e) {
    fail(res, e)
  }
})

// ---------- import / convert (docx/xlsx/csv/txt/md -> editor HTML) ----------
function bufferToHtml(buffer, ext, name) {
  if (ext === '.docx') return mammoth.convertToHtml({ buffer }).then((r) => r.value)
  if (['.xlsx', '.xls', '.csv'].includes(ext)) {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    return Promise.resolve(wb.SheetNames.map((n) => `<h3>${n}</h3>${XLSX.utils.sheet_to_html(wb.Sheets[n])}`).join('<hr/>'))
  }
  if (['.html', '.htm'].includes(ext)) return Promise.resolve(buffer.toString('utf8'))
  if (['.txt', '.md'].includes(ext)) {
    return Promise.resolve(
      buffer.toString('utf8').split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('')
    )
  }
  return Promise.reject(new Error(`Cannot convert ${ext} to a document`))
}
const extOf = (n) => {
  const i = n.lastIndexOf('.')
  return i < 0 ? '' : n.slice(i).toLowerCase()
}
app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    const f = req.file
    const ext = extOf(f.originalname)
    const html = await bufferToHtml(f.buffer, ext, f.originalname)
    if (req.body.dir !== undefined) {
      const base = f.originalname.slice(0, f.originalname.length - ext.length) + '.html'
      const path = await store.newDoc(req.body.dir || '', base, now())
      await store.saveDoc(path, html, now())
      return res.json({ html, path })
    }
    res.json({ html })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})
app.post('/api/convert', async (req, res) => {
  try {
    const bin = await store.getBinary(req.body.path)
    if (!bin) throw new Error('File not found')
    const ext = extOf(req.body.path)
    const html = await bufferToHtml(bin.buffer, ext, req.body.path)
    if (req.body.save) {
      const base = req.body.path.slice(req.body.path.lastIndexOf('/') + 1)
      const stem = base.slice(0, base.length - ext.length)
      const dir = req.body.path.includes('/') ? req.body.path.slice(0, req.body.path.lastIndexOf('/')) : ''
      const path = await store.newDoc(dir, stem + '.html', now())
      await store.saveDoc(path, html, now())
      return res.json({ html, path })
    }
    res.json({ html })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ---------- serve raw binaries ----------
app.get(/^\/files\/(.+)/, async (req, res) => {
  try {
    const path = decodeURIComponent(req.params[0])
    const bin = await store.getBinary(path)
    if (!bin) return res.status(404).end()
    if (bin.redirect) return res.redirect(302, bin.redirect) // R2-stored → serve from R2's CDN
    res.setHeader('Content-Type', bin.contentType)
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.send(bin.buffer)
  } catch {
    res.status(400).end()
  }
})

// ---------- settings ----------
const hasSubToken = (cfg) => !!(cfg.oauthToken || process.env.CLAUDE_CODE_OAUTH_TOKEN)
const hasApiKey = (cfg) => !!(cfg.apiKey || process.env.ANTHROPIC_API_KEY)
// "connected" follows the chosen auth mode, like the local server.
const isConnected = (cfg) => (cfg.authMode === 'subscription' ? hasSubToken(cfg) : hasApiKey(cfg))
function settingsView(cfg) {
  return {
    authMode: cfg.authMode,
    connected: isConnected(cfg),
    hasKey: isConnected(cfg),
    model: cfg.model || 'claude-sonnet-4-6',
    mode: 'online',
    online: true,
    hasMongo: !!(process.env.D1_DATABASE_ID || process.env.MONGODB_URI),
    hasR2: r2.r2CanServe(cfg.r2),
  }
}
app.get('/api/settings', async (_req, res) => {
  try {
    res.json(settingsView(await store.getConfig()))
  } catch (e) {
    fail(res, e)
  }
})
app.put('/api/settings', async (req, res) => {
  try {
    res.json(settingsView(await store.saveConfig(req.body)))
  } catch (e) {
    fail(res, e)
  }
})

// ---------- admin lock ----------
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
app.get('/api/auth/status', async (_req, res) => {
  try {
    const a = await store.getAuth()
    res.json({ configured: !!a, username: a?.username || '' })
  } catch (e) {
    fail(res, e)
  }
})
app.post('/api/auth/set', async (req, res) => {
  try {
    const { username = '', passcode, current } = req.body
    if (!passcode || String(passcode).length < 4)
      return res.status(400).json({ error: 'Passcode must be at least 4 characters.' })
    const existing = await store.getAuth()
    if (existing && !verifyHash(current, existing.salt, existing.hash))
      return res.status(403).json({ error: 'Current passcode is incorrect.' })
    const { salt, hash } = makeHash(String(passcode))
    await store.setAuth({ username: String(username).slice(0, 60), salt, hash })
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
})
app.post('/api/auth/unlock', async (req, res) => {
  try {
    const a = await store.getAuth()
    if (!a) return res.json({ ok: true })
    if (verifyHash(req.body.passcode, a.salt, a.hash)) return res.json({ ok: true })
    res.status(401).json({ error: 'Incorrect passcode.' })
  } catch (e) {
    fail(res, e)
  }
})
app.post('/api/auth/remove', async (req, res) => {
  try {
    const a = await store.getAuth()
    if (a && !verifyHash(req.body.passcode, a.salt, a.hash))
      return res.status(403).json({ error: 'Passcode is incorrect.' })
    await store.removeAuth()
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
})

// ---------- sync / storage (online is implicit on the cloud backend) ----------
app.get('/api/sync/status', (_req, res) => res.json({ mode: 'online', online: true, hasMongo: !!(process.env.D1_DATABASE_ID || process.env.MONGODB_URI) }))
app.put('/api/mode', (req, res) => res.json({ mode: 'online', online: true }))
app.post('/api/sync', (_req, res) => res.json({ summary: { pushed: 0, pulled: 0, deleted: 0 } }))
app.get('/api/storage', async (_req, res) => {
  try {
    const cfg = await store.getConfig()
    const out = { connected: true, provider: 'Cloudflare D1', limit: Number(process.env.D1_LIMIT || 5 * 1024 * 1024 * 1024), ...(await store.dbStats()) }
    if (r2.r2Enabled(cfg.r2)) {
      try {
        const u = await r2.r2Usage(cfg.r2)
        out.r2 = { used: u.used, objects: u.objects, limit: Number(process.env.R2_LIMIT || 10 * 1024 * 1024 * 1024) }
      } catch (e) {
        out.r2 = { error: e.message }
      }
    }
    res.json(out)
  } catch (e) {
    fail(res, e)
  }
})

// ---------- storage management ----------
app.post('/api/storage/reclaim', async (req, res) => {
  try {
    const target = req.body.target === 'r2' || req.body.target === 'd1' ? req.body.target : 'all'
    const cfg = await store.getConfig()
    let orphansDeleted = 0
    let bytesFreed = 0
    let tombstonesPurged = 0
    if ((target === 'all' || target === 'r2') && r2.r2CanServe(cfg.r2)) {
      const objs = await r2.r2ListAll(cfg.r2)
      const refs = new Set((await d1.d1Query('SELECT r2_key FROM nodes WHERE r2_key IS NOT NULL', [], cfg.d1)).map((r) => r.r2_key))
      for (const o of objs) {
        if (!refs.has(o.key)) {
          await r2.r2Delete(o.key, cfg.r2)
          orphansDeleted++
          bytesFreed += o.size
        }
      }
    }
    if (target === 'all' || target === 'd1') {
      tombstonesPurged = (await d1.d1Query('SELECT COUNT(*) AS c FROM nodes WHERE deleted=1', [], cfg.d1))[0]?.c || 0
      if (tombstonesPurged) await d1.d1Query('DELETE FROM nodes WHERE deleted=1', [], cfg.d1)
    }
    res.json({ orphansDeleted, bytesFreed, tombstonesPurged })
  } catch (e) {
    fail(res, e)
  }
})
app.post('/api/storage/wipe', async (req, res) => {
  try {
    const target = req.body.target === 'r2' || req.body.target === 'd1' ? req.body.target : 'all'
    const cfg = await store.getConfig()
    let filesDeleted = 0
    let nodesDeleted = 0
    if ((target === 'all' || target === 'r2') && r2.r2CanServe(cfg.r2)) {
      for (const o of await r2.r2ListAll(cfg.r2)) {
        await r2.r2Delete(o.key, cfg.r2)
        filesDeleted++
      }
    }
    if (target === 'r2') {
      await d1.d1Query('DELETE FROM nodes WHERE r2_key IS NOT NULL', [], cfg.d1)
    }
    if (target === 'all' || target === 'd1') {
      nodesDeleted = (await d1.d1Query('SELECT COUNT(*) AS c FROM nodes', [], cfg.d1))[0]?.c || 0
      await d1.d1Query('DELETE FROM nodes', [], cfg.d1)
    }
    res.json({ filesDeleted, nodesDeleted })
  } catch (e) {
    fail(res, e)
  }
})

// ---------- Claude ----------
// Drive the user's Max/Pro subscription on serverless by calling the Anthropic API
// directly with the Claude Code OAuth token (the Agent SDK can't spawn its CLI here).
// The token is presented as a Bearer credential and, as the OAuth surface requires,
// the system prompt leads with the Claude Code identity block.
async function generateSubscription(cfg, { system, messages }) {
  const token = cfg.oauthToken || process.env.CLAUDE_CODE_OAUTH_TOKEN
  if (!token)
    throw new Error('Claude is not connected. Add your Max subscription token in Settings (or set CLAUDE_CODE_OAUTH_TOKEN).')
  const body = {
    model: cfg.model || 'claude-sonnet-4-6',
    max_tokens: 2048,
    // First system block must declare the Claude Code identity for OAuth requests.
    system: [
      { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
      ...(system ? [{ type: 'text', text: system }] : []),
    ],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    if (r.status === 401 || r.status === 403)
      throw new Error('Subscription token was rejected — re-run `claude setup-token` and update it in Settings.')
    throw new Error(`Claude (subscription) error ${r.status}: ${detail.slice(0, 300)}`)
  }
  const data = await r.json()
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
}

async function generate(cfg, { system, messages }) {
  if (cfg.authMode === 'subscription') return generateSubscription(cfg, { system, messages })
  // raw API key path (pay-per-token)
  const apiKey = cfg.apiKey || process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings to use Claude on the hosted app.')
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model: cfg.model || 'claude-sonnet-4-6',
    max_tokens: 2048,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  })
  return msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('')
}
app.post('/api/ai/chat', async (req, res) => {
  try {
    const cfg = await store.getConfig()
    const { messages = [], context = '', system: extraSystem = '' } = req.body
    let system =
      'You are Claude, the writing assistant inside "IDyaaArt", an app for authoring stories and graphic novels. ' +
      'Help with prose, structure, worldbuilding, editing and answering questions. Be concise and concrete. ' +
      extraSystem
    if (context) system += `\n\nThe user is currently working on this document:\n"""\n${context.slice(0, 12000)}\n"""`
    res.json({ text: await generate(cfg, { system, messages }) })
  } catch (e) {
    fail(res, e)
  }
})
app.post('/api/ai/search', async (req, res) => {
  try {
    const cfg = await store.getConfig()
    const query = req.body.query || ''
    const items = await store.collectAll()
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const scored = items
      .map((d) => {
        const hay = d.text.toLowerCase()
        const titleHay = d.title.toLowerCase()
        const score = terms.reduce((s, t) => s + (titleHay.includes(t) ? 3 : 0) + (hay.includes(t) ? 1 : 0), 0)
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
    if (!isConnected(cfg)) return res.json({ results: scored.filter((d) => d.score > 0).map(toResult), answer: '' })
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
    res.json({ answer, results: scored.filter((d) => d.score > 0).map(toResult) })
  } catch (e) {
    fail(res, e)
  }
})

export default app
