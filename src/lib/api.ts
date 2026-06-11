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

  upload: (dir: string, files: FileList | File[], onProgress?: (pct: number) => void) =>
    new Promise<{ saved: string[] }>((resolve, reject) => {
      const fd = new FormData()
      fd.append('dir', dir)
      for (const f of Array.from(files)) fd.append('files', f)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/upload')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
      }
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
    }),
  import: async (file: File, dir?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (dir !== undefined) fd.append('dir', dir)
    return j<{ html: string; path?: string }>(fetch('/api/import', { method: 'POST', body: fd }))
  },
  convert: (path: string, save = false) =>
    j<{ html: string; path?: string }>(fetch('/api/convert', json('POST', { path, save }))),

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
    j<{ connected: boolean; limit?: number; used?: number; objects?: number }>(fetch('/api/storage')),

  chat: (messages: ChatMessage[], context?: string) =>
    j<{ text: string }>(fetch('/api/ai/chat', json('POST', { messages, context }))),
  search: (query: string) =>
    j<{ answer: string; results: SearchResult[] }>(fetch('/api/ai/search', json('POST', { query }))),
}

export const fileUrl = (path: string) => '/files/' + path.split('/').map(encodeURIComponent).join('/')
