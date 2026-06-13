// Two-way reconcile engine (newest-wins) between the local workspace and MongoDB.
// A local manifest (.entropy/sync-manifest.json) records what was last synced so that
// deletions can be told apart from "never uploaded yet".
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { nodeType, isBinaryType, sha1 } from './util.js'
import * as mongo from './d1Mirror.js'

let WORKSPACE = ''
let MANIFEST_FILE = ''
export function init(workspace, configDir) {
  WORKSPACE = workspace
  MANIFEST_FILE = path.join(configDir, 'sync-manifest.json')
}

function absOf(rel) {
  return path.join(WORKSPACE, rel.split('/').join(path.sep))
}
function relOf(abs) {
  return path.relative(WORKSPACE, abs).split(path.sep).join('/')
}

async function loadManifest() {
  try {
    return JSON.parse(await fs.readFile(MANIFEST_FILE, 'utf8'))
  } catch {
    return {}
  }
}
async function saveManifest(m) {
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(m, null, 2))
}

// Walk the local workspace into a map: path -> { type, mtime, hash, content }
async function localState(dir = WORKSPACE, acc = new Map()) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const abs = path.join(dir, ent.name)
    const rel = relOf(abs)
    const stat = await fs.stat(abs)
    if (ent.isDirectory()) {
      acc.set(rel, { type: 'folder', mtime: stat.mtimeMs, hash: 'folder' })
      await localState(abs, acc)
    } else {
      const type = nodeType(ent.name)
      if (isBinaryType(type)) {
        const buffer = await fs.readFile(abs)
        acc.set(rel, { type, mtime: stat.mtimeMs, hash: sha1(buffer), content: buffer })
      } else {
        const html = await fs.readFile(abs, 'utf8')
        acc.set(rel, { type, mtime: stat.mtimeMs, hash: sha1(html), content: html })
      }
    }
  }
  return acc
}

// Push one local node up to Mongo.
async function pushNode(rel, L) {
  if (L.type === 'folder') return mongo.upsertFolder(rel, Math.floor(L.mtime))
  if (isBinaryType(L.type)) return mongo.upsertBinary(rel, L.type, L.content, L.hash, Math.floor(L.mtime))
  return mongo.upsertDoc(rel, L.content, L.hash, Math.floor(L.mtime))
}

// Pull one remote node down to disk and align its mtime to the remote timestamp.
async function pullNode(rel, R) {
  const abs = absOf(rel)
  if (R.type === 'folder') {
    await fs.mkdir(abs, { recursive: true })
  } else {
    await fs.mkdir(path.dirname(abs), { recursive: true })
    if (isBinaryType(R.type)) {
      const buf = await mongo.getBinary(rel)
      await fs.writeFile(abs, buf ?? Buffer.alloc(0))
    } else {
      await fs.writeFile(abs, await mongo.getDocHtml(rel))
    }
  }
  const t = new Date(R.updatedAt)
  await fs.utimes(abs, t, t).catch(() => {})
}

/**
 * Reconcile local disk and Mongo. Returns a summary of what moved.
 */
export async function reconcile() {
  const now = Date.now()
  const local = await localState()
  const remote = await mongo.remoteIndex()
  const manifest = await loadManifest()

  const paths = new Set([...local.keys(), ...remote.keys(), ...Object.keys(manifest)])
  const pushes = []
  const pulls = []
  const localDeletes = []
  const remoteDeletes = []

  for (const p of paths) {
    const L = local.get(p)
    const R = remote.get(p)
    const M = manifest[p]
    const remoteAlive = R && !R.deleted

    if (L && remoteAlive) {
      if (L.hash === R.hash) {
        manifest[p] = { hash: L.hash, updatedAt: R.updatedAt, type: L.type }
      } else if (L.mtime >= R.updatedAt) {
        pushes.push(p)
      } else {
        pulls.push(p)
      }
    } else if (L && !remoteAlive) {
      if (R && R.deleted) {
        // remote tombstone: honor delete unless local changed more recently
        if (M && L.hash !== M.hash && L.mtime >= (R.deletedAt || 0)) pushes.push(p)
        else localDeletes.push(p)
      } else if (M && L.hash === M.hash) {
        // existed & synced before, now absent remotely, unchanged locally → deleted remotely
        localDeletes.push(p)
      } else {
        pushes.push(p) // brand-new local, or changed locally → upload
      }
    } else if (!L && remoteAlive) {
      if (M && R.hash === M.hash) {
        // existed before locally, gone now, remote unchanged → deleted locally
        remoteDeletes.push(p)
      } else {
        pulls.push(p) // new remote, or remote changed after our local delete → pull
      }
    } else {
      delete manifest[p] // neither side alive
    }
  }

  // apply: creates/updates parents-first, deletes children-first
  const byDepthAsc = (a, b) => a.split('/').length - b.split('/').length
  const byDepthDesc = (a, b) => b.split('/').length - a.split('/').length

  for (const p of [...pushes, ...pulls].sort(byDepthAsc)) {
    if (pushes.includes(p)) {
      const L = local.get(p)
      await pushNode(p, L)
      manifest[p] = { hash: L.hash, updatedAt: Math.floor(L.mtime), type: L.type }
    } else {
      const R = remote.get(p)
      await pullNode(p, R)
      manifest[p] = { hash: R.hash, updatedAt: R.updatedAt, type: R.type }
    }
  }
  for (const p of localDeletes.sort(byDepthDesc)) {
    await fs.rm(absOf(p), { recursive: true, force: true })
    delete manifest[p]
  }
  for (const p of remoteDeletes.sort(byDepthDesc)) {
    await mongo.markDeleted(p, now)
    delete manifest[p]
  }

  await saveManifest(manifest)
  return {
    pushed: pushes.length,
    pulled: pulls.length,
    deletedLocal: localDeletes.length,
    deletedRemote: remoteDeletes.length,
  }
}

// ---- live mirror helpers (used while Online, after each local change) ----

export async function mirrorUpsert(rel) {
  const abs = absOf(rel)
  if (!existsSync(abs)) return
  const stat = await fs.stat(abs)
  const manifest = await loadManifest()
  if (stat.isDirectory()) {
    await mongo.upsertFolder(rel, Math.floor(stat.mtimeMs))
    manifest[rel] = { hash: 'folder', updatedAt: Math.floor(stat.mtimeMs), type: 'folder' }
  } else {
    const type = nodeType(path.basename(abs))
    if (isBinaryType(type)) {
      const buf = await fs.readFile(abs)
      const h = sha1(buf)
      await mongo.upsertBinary(rel, type, buf, h, Math.floor(stat.mtimeMs))
      manifest[rel] = { hash: h, updatedAt: Math.floor(stat.mtimeMs), type }
    } else {
      const html = await fs.readFile(abs, 'utf8')
      const h = sha1(html)
      await mongo.upsertDoc(rel, html, h, Math.floor(stat.mtimeMs))
      manifest[rel] = { hash: h, updatedAt: Math.floor(stat.mtimeMs), type }
    }
  }
  await saveManifest(manifest)
}

export async function mirrorDelete(rel) {
  const manifest = await loadManifest()
  const remote = await mongo.remoteIndex()
  const now = Date.now()
  // tombstone the path and every descendant (so a deleted folder can't be resurrected)
  let touched = false
  for (const p of remote.keys()) {
    if (p === rel || p.startsWith(rel + '/')) {
      await mongo.markDeleted(p, now)
      touched = true
    }
  }
  if (!touched) await mongo.markDeleted(rel, now)
  for (const key of Object.keys(manifest)) {
    if (key === rel || key.startsWith(rel + '/')) delete manifest[key]
  }
  await saveManifest(manifest)
}
