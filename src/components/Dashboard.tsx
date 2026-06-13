import { useEffect, useRef, useState } from 'react'
import { BookOpen, Database, FilePlus2, FolderPlus, ImageIcon, MoreHorizontal, Sparkles, X } from 'lucide-react'
import { api } from '../lib/api'
import type { TreeNode } from '../lib/types'
import { FOLDER_ICONS } from './folderIcons'

// Where the user's custom dashboard background lives (per-device).
const BG_KEY = 'idyaa-dash-bg'

// Decode a picked image and re-encode it downscaled, so a big photo doesn't blow the
// ~5 MB localStorage quota. Returns a JPEG data URL.
function scaleImage(file: File, maxDim = 1920, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas not available'))
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image'))
    }
    img.src = url
  })
}

function fmtSize(bytes: number) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 2 : 1) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0) + ' MB'
  return (bytes / 1024).toFixed(0) + ' KB'
}

function StorageMeter({ label, provider, used, limit, objects }: { label: string; provider: string; used: number; limit: number; objects?: number }) {
  const pct = Math.min(100, (used / limit) * 100)
  const level = pct > 90 ? 'crit' : pct > 70 ? 'warn' : 'ok'
  return (
    <div className="storage-row">
      <div className="storage-head">
        <span>{label}</span>
        <span className="storage-figures">
          {fmtSize(used)} <span className="storage-of">of {fmtSize(limit)}</span>
        </span>
      </div>
      <div className="storage-track">
        <div className={`storage-fill ${level}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="storage-note">
        {(100 - pct).toFixed(pct > 99 ? 1 : 0)}% free · {provider}
        {objects !== undefined ? ` · ${objects} file${objects === 1 ? '' : 's'}` : ''}
      </div>
    </div>
  )
}

function StorageBar() {
  const [s, setS] = useState<Awaited<ReturnType<typeof api.storage>> | null>(null)
  useEffect(() => {
    api.storage().then(setS).catch(() => setS({ connected: false }))
  }, [])
  if (!s) return null
  const showMongo = s.connected && !!s.limit
  const showR2 = !!s.r2 && !s.r2.error && !!s.r2.limit
  if (!showMongo && !showR2) return null
  return (
    <div className="storage-card">
      <div className="storage-card-head">
        <Database size={15} />
        <span>Storage</span>
      </div>
      {showMongo && (
        <StorageMeter label={`Documents · ${s.provider || 'Database'}`} provider={s.provider || 'Database'} used={s.used || 0} limit={s.limit!} />
      )}
      {showR2 && (
        <StorageMeter label="Images & files · Cloudflare R2" provider="Cloudflare R2" used={s.r2!.used} limit={s.r2!.limit} objects={s.r2!.objects} />
      )}
    </div>
  )
}

function countDocs(node: TreeNode): number {
  if (node.type === 'doc') return 1
  return (node.children || []).reduce((s, c) => s + countDocs(c), 0)
}
function countAll(node: TreeNode): number {
  return (node.children || []).reduce((s, c) => s + 1 + countAll(c), 0)
}

export function Dashboard({
  tree,
  onOpenProject,
  onContext,
  onNewProject,
  onNewDoc,
}: {
  tree: TreeNode[]
  onOpenProject: (node: TreeNode) => void
  onContext: (e: React.MouseEvent, node: TreeNode) => void
  onNewProject: () => void
  onNewDoc: () => void
}) {
  const projects = tree.filter((n) => n.type === 'folder')

  // ---- custom dashboard background (stored per-device in localStorage) ----
  const [bg, setBg] = useState<string | null>(() => {
    try {
      return localStorage.getItem(BG_KEY)
    } catch {
      return null
    }
  })
  const [bgErr, setBgErr] = useState('')
  const bgInput = useRef<HTMLInputElement>(null)
  const pickBg = async (file: File) => {
    setBgErr('')
    try {
      const dataUrl = await scaleImage(file)
      localStorage.setItem(BG_KEY, dataUrl)
      setBg(dataUrl)
    } catch (e: any) {
      // Most likely the data URL exceeded the localStorage quota.
      setBgErr(/quota/i.test(e?.message || '') ? 'Image is too large to save — try a smaller one.' : e?.message || 'Could not set background')
    }
  }
  const clearBg = () => {
    try {
      localStorage.removeItem(BG_KEY)
    } catch {}
    setBg(null)
    setBgErr('')
  }

  return (
    <div className={`dash-wrap ${bg ? 'has-bg' : ''}`}>
      {bg && (
        <>
          <div className="dash-bg" style={{ backgroundImage: `url(${bg})` }} />
          <div className="dash-bg-veil" />
        </>
      )}
      <div className="dash">
      <div className="dash-bg-controls">
        <button className="dash-bg-btn" onClick={() => bgInput.current?.click()} title="Set a dashboard background image">
          <ImageIcon size={14} /> {bg ? 'Change background' : 'Background'}
        </button>
        {bg && (
          <button className="dash-bg-btn" onClick={clearBg} title="Remove background">
            <X size={14} />
          </button>
        )}
        <input
          ref={bgInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) pickBg(f)
            e.target.value = ''
          }}
        />
      </div>
      {bgErr && <div className="dash-bg-err">{bgErr}</div>}
      <div className="dash-hero">
        <h1>Welcome to <span className="brand-name">IDyaaArt</span></h1>
        <p>Your workspace for stories, scripts and graphic novels.</p>
      </div>

      <div className="dash-cta">
        <button className="cta primary" onClick={onNewDoc}>
          <span className="cta-ico">
            <FilePlus2 size={18} />
          </span>
          Create Document
        </button>
        <button className="cta" onClick={onNewProject}>
          <span className="cta-ico">
            <FolderPlus size={18} />
          </span>
          New Project
        </button>
      </div>

      <StorageBar />

      <div className="section-title">Projects</div>
      {projects.length === 0 ? (
        <div className="dash-empty">
          <Sparkles size={20} style={{ opacity: 0.5 }} />
          <p>No projects yet — create one to start writing.</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => {
            const Icon = p.icon && FOLDER_ICONS[p.icon] ? FOLDER_ICONS[p.icon] : BookOpen
            return (
            <div
              key={p.path}
              className="project-card"
              onClick={() => onOpenProject(p)}
              onContextMenu={(e) => onContext(e, p)}
              style={p.color ? { borderTopColor: p.color, borderTopWidth: 3 } : undefined}
            >
              <div className="pc-glow" />
              <button className="pc-more" onClick={(e) => { e.stopPropagation(); onContext(e, p) }} title="Options">
                <MoreHorizontal size={16} />
              </button>
              <div className="pc-ico" style={p.color ? { background: p.color + '2e', color: p.color } : undefined}>
                <Icon size={22} />
              </div>
              <h3>{p.name}</h3>
              <div className="pc-meta">
                {countDocs(p)} doc{countDocs(p) === 1 ? '' : 's'} · {countAll(p)} item{countAll(p) === 1 ? '' : 's'}
              </div>
            </div>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}
