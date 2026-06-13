import type { AuthMode, ChatMessage, SearchResult, SyncMode, SyncSummary, TreeNode } from './types'

async function j<T>(p: Promise<Response>): Promise<T> {
  const res = await p
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = (await res.json()).error || msg
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// PUT one file straight to a presigned R2 URL (bypasses the server body-size limit).
function putToR2(url: string, file: File, onProgress?: (frac: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2 upload failed (${xhr.status})`))
    xhr.onerror = () => reject(new Error('R2 upload failed'))
    xhr.send(file)
  })
}

// Legacy multipart upload through the server (disk locally, GridFS/R2 on the cloud).
function multipartUpload(dir: string, files: File[], onProgress?: (pct: number) => void) {
  return new Promise<{ saved: string[] }>((resolve, reject) => {
    const fd = new FormData()
    fd.append('dir', dir)
    for (const f of files) fd.append('files', f)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Bad server response'))
        }
      } else {
        let msg = 'Upload failed'
        try {
          msg = JSON.parse(xhr.responseText).error || msg
        } catch {}
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.send(fd)
  })
}

export const api = {
  tree: () => j<{ tree: TreeNode[] }>(fetch('/api/tree')).then((r) => r.tree),

  createProject: (name: string) => j<{ path: string }>(fetch('/api/project', json('POST', { name }))),
  createFolder: (parent: string, name: string) =>
    j<{ path: string }>(fetch('/api/folder', json('POST', { parent, name }))),
  rename: (path: string, newName: string) =>
    j<{ path: string }>(fetch('/api/rename', json('POST', { path, newName }))),
  move: (path: string, destDir: string) =>
    j<{ path: string }>(fetch('/api/move', json('POST', { path, destDir }))),
  remove: (path: string) => j<{ ok: boolean }>(fetch('/api/node', json('DELETE', { path }))),
  setColor: (path: string, color: string | null) =>
    j<{ ok: boolean }>(fetch('/api/meta', json('POST', { path, color }))),
  setIcon: (path: string, icon: string | null) =>
    j<{ ok: boolean }>(fetch('/api/meta', json('POST', { path, icon }))),

  newDoc: (dir: string, name: string) =>
    j<{ path: string }>(fetch('/api/doc/new', json('POST', { dir, name }))),
  loadDoc: (path: string) =>
    j<{ path: string; title: string; html: string }>(
      fetch('/api/doc?path=' + encodeURIComponent(path))
    ),
  saveDoc: (path: string, html: string) =>
    j<{ ok: boolean }>(fetch('/api/doc', json('PUT', { path, html }))),

  // Uploads files to the workspace. Uses direct browser→R2 uploads when the cloud
  // backend has R2 configured (no 4.5MB cap); otherwise falls back to a server upload.
  upload: async (dir: string, files: FileList | File[], onProgress?: (pct: number) => void) => {
    const list = Array.from(files)
    if (!list.length) return { saved: [] as string[] }
    // Probe direct-upload availability with the first file.
    let first: { enabled?: boolean; url?: string; key?: string; path?: string } | null = null
    try {
      const r = await fetch(
        '/api/upload/presign',
        json('POST', { dir, name: list[0].name, contentType: list[0].type || 'application/octet-stream' })
      )
      if (r.ok) first = await r.json()
    } catch {}
    if (!first || !first.enabled) return multipartUpload(dir, list, onProgress)
    const saved: string[] = []
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      const pres =
        i === 0
          ? first
          : await j<{ url: string; key: string; path: string }>(
              fetch('/api/upload/presign', json('POST', { dir, name: f.name, contentType: f.type || 'application/octet-stream' }))
            )
      await putToR2(pres.url!, f, (frac) => onProgress?.((i + frac) / list.length))
      await j(fetch('/api/upload/commit', json('POST', { path: pres.path, key: pres.key, size: f.size })))
      saved.push(pres.path!)
    }
    return { saved }
  },
  import: async (file: File, dir?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (dir !== undefined) fd.append('dir', dir)
    return j<{ html: string; path?: string }>(fetch('/api/import', { method: 'POST', body: fd }))
  },
  convert: (path: string, save = false) =>
    j<{ html: string; path?: string }>(fetch('/api/convert', json('POST', { path, save }))),

  // Upload an inline editor image to R2 and get back a public URL.
  // Returns null when R2 isn't configured (caller falls back to a base64 data URL).
  uploadImage: async (file: File): Promise<string | null> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/image', { method: 'POST', body: fd })
    if (!res.ok) return null
    const data = (await res.json()) as { enabled?: boolean; url?: string }
    return data.enabled && data.url ? data.url : null
  },

  getSettings: () =>
    j<{ authMode: AuthMode; connected: boolean; hasKey: boolean; model: string; mode: SyncMode; online: boolean; hasMongo: boolean }>(
      fetch('/api/settings')
    ),
  saveSettings: (payload: { authMode: AuthMode; apiKey?: string; oauthToken?: string; mongoUri?: string; model: string }) =>
    j<{ authMode: AuthMode; connected: boolean; hasKey: boolean; model: string; mode: SyncMode; online: boolean; hasMongo: boolean }>(
      fetch('/api/settings', json('PUT', payload))
    ),

  authStatus: () => j<{ configured: boolean; username: string }>(fetch('/api/auth/status')),
  authUnlock: (passcode: string) => j<{ ok: boolean }>(fetch('/api/auth/unlock', json('POST', { passcode }))),
  authSet: (username: string, passcode: string, current?: string) =>
    j<{ ok: boolean }>(fetch('/api/auth/set', json('POST', { username, passcode, current }))),
  authRemove: (passcode: string) => j<{ ok: boolean }>(fetch('/api/auth/remove', json('POST', { passcode }))),

  syncStatus: () => j<{ mode: SyncMode; online: boolean; hasMongo: boolean }>(fetch('/api/sync/status')),
  setMode: (mode: SyncMode) =>
    j<{ mode: SyncMode; online: boolean; summary?: SyncSummary }>(fetch('/api/mode', json('PUT', { mode }))),
  syncNow: () => j<{ summary: SyncSummary }>(fetch('/api/sync', json('POST', {}))),
  storage: () =>
    j<{
      connected: boolean
      provider?: string
      limit?: number
      used?: number
      objects?: number
      r2?: { used: number; objects: number; limit: number; error?: string }
    }>(fetch('/api/storage')),

  storageReclaim: (target: 'r2' | 'd1' | 'all' = 'all') =>
    j<{ orphansDeleted: number; bytesFreed: number; tombstonesPurged: number }>(fetch('/api/storage/reclaim', json('POST', { target }))),
  storageWipe: (target: 'r2' | 'd1' | 'all') =>
    j<{ filesDeleted: number; nodesDeleted: number }>(fetch('/api/storage/wipe', json('POST', { target }))),

  usage: () =>
    j<{ tokens: number; requests: number; weekStart: number; resetsAt: number; budget: number }>(fetch('/api/usage')),

  chat: (messages: ChatMessage[], context?: string) =>
    j<{ text: string }>(fetch('/api/ai/chat', json('POST', { messages, context }))),
  // Streaming chat: calls onChunk for each text delta. Falls back to a whole-text
  // response if the backend doesn't stream (e.g. the cloud app).
  chatStream: async (messages: ChatMessage[], context: string, onChunk: (t: string) => void) => {
    const res = await fetch('/api/ai/chat', json('POST', { messages, context, stream: true }))
    if (!res.ok) {
      let msg = res.statusText
      try { msg = (await res.json()).error || msg } catch {}
      throw new Error(msg)
    }
    if (!res.body || !(res.headers.get('content-type') || '').includes('text/event-stream')) {
      const data = await res.json()
      onChunk(data.text || '')
      return
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        try {
          const ev = JSON.parse(payload)
          if (ev.text) onChunk(ev.text)
          else if (ev.error) throw new Error(ev.error)
        } catch (e: any) {
          if (e?.message && !/JSON/.test(e.message)) throw e
        }
      }
    }
  },
  search: (query: string) =>
    j<{ answer: string; results: SearchResult[] }>(fetch('/api/ai/search', json('POST', { query }))),
}

export const fileUrl = (path: string) => '/files/' + path.split('/').map(encodeURIComponent).join('/')
