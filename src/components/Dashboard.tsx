import { useEffect, useState } from 'react'
import { BookOpen, Database, FilePlus2, FolderPlus, MoreHorizontal, Sparkles } from 'lucide-react'
import { api } from '../lib/api'
import type { TreeNode } from '../lib/types'
import { FOLDER_ICONS } from './folderIcons'

function fmtMB(bytes: number) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0) + ' MB'
}

function StorageBar() {
  const [s, setS] = useState<{ connected: boolean; used?: number; limit?: number } | null>(null)
  useEffect(() => {
    api.storage().then(setS).catch(() => setS({ connected: false }))
  }, [])
  if (!s || !s.connected || !s.limit) return null
  const used = s.used || 0
  const pct = Math.min(100, (used / s.limit) * 100)
  const level = pct > 90 ? 'crit' : pct > 70 ? 'warn' : 'ok'
  return (
    <div className="storage-card">
      <div className="storage-head">
        <Database size={15} />
        <span>Cloud storage</span>
        <span className="storage-figures">
          {fmtMB(used)} <span className="storage-of">of {fmtMB(s.limit)}</span>
        </span>
      </div>
      <div className="storage-track">
        <div className={`storage-fill ${level}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="storage-note">{(100 - pct).toFixed(pct > 99 ? 1 : 0)}% free · MongoDB Atlas</div>
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
  return (
    <div className="dash">
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
  )
}
