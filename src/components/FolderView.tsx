import { useState } from 'react'
import { FilePlus2, FolderPlus, Grid2x2, LayoutGrid, List, MoreHorizontal, Table2, Upload } from 'lucide-react'
import type { NodeType, TreeNode } from '../lib/types'
import { fileUrl } from '../lib/api'
import { NodeIcon } from './nodeIcon'
import { FolderGlyph } from './folderIcons'

type ViewMode = 'large' | 'medium' | 'list' | 'details'

function fmtSize(bytes?: number) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
function fmtDate(ms?: number) {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
const typeLabel: Record<NodeType, string> = {
  folder: 'Folder',
  doc: 'Document',
  image: 'Image',
  pdf: 'PDF',
  sheet: 'Spreadsheet',
  word: 'Word',
  archive: 'Archive',
  file: 'File',
}
const displayName = (n: TreeNode) => (n.type === 'doc' ? n.name.replace(/\.html$/, '') : n.name)

// thumbnail: real image preview for images, icon otherwise
function Thumb({ node, size }: { node: TreeNode; size: number }) {
  if (node.type === 'image') {
    return <img className="fv-thumb-img" src={fileUrl(node.path)} alt={node.name} loading="lazy" />
  }
  return (
    <span className="fv-thumb-icon">
      {node.type === 'folder' ? (
        <FolderGlyph name={node.icon} color={node.color} size={size} />
      ) : (
        <NodeIcon type={node.type} size={size} color={node.color} />
      )}
    </span>
  )
}

export function FolderView({
  node,
  onOpen,
  onContext,
  onNewDoc,
  onNewFolder,
  onUpload,
}: {
  node: TreeNode
  onOpen: (n: TreeNode) => void
  onContext: (e: React.MouseEvent, n: TreeNode) => void
  onNewDoc: () => void
  onNewFolder: () => void
  onUpload: () => void
}) {
  const More = ({ c }: { c: TreeNode }) => (
    <button className="fv-more" onClick={(e) => { e.stopPropagation(); onContext(e, c) }} title="Options">
      <MoreHorizontal size={15} />
    </button>
  )
  const [mode, setMode] = useState<ViewMode>(
    () => (localStorage.getItem('entropy-folder-view') as ViewMode) || 'medium'
  )
  const setView = (m: ViewMode) => {
    localStorage.setItem('entropy-folder-view', m)
    setMode(m)
  }
  const children = node.children ?? []

  const modeBtn = (m: ViewMode, icon: React.ReactNode, label: string) => (
    <button className={`fv-mode ${mode === m ? 'on' : ''}`} onClick={() => setView(m)} title={label}>
      {icon}
    </button>
  )

  return (
    <div className="dash">
      <div className="folder-head">
        <h1>{node.name}</h1>
        <div className="folder-actions">
          <button className="cta" onClick={onNewDoc}>
            <FilePlus2 size={16} /> Document
          </button>
          <button className="cta" onClick={onNewFolder}>
            <FolderPlus size={16} /> Folder
          </button>
          <button className="cta" onClick={onUpload}>
            <Upload size={16} /> Import
          </button>
          <div className="fv-modes">
            {modeBtn('large', <LayoutGrid size={16} />, 'Large')}
            {modeBtn('medium', <Grid2x2 size={16} />, 'Medium')}
            {modeBtn('list', <List size={16} />, 'List')}
            {modeBtn('details', <Table2 size={16} />, 'Details')}
          </div>
        </div>
      </div>

      {children.length === 0 ? (
        <div className="dash-empty">
          <p>This folder is empty — add a document, subfolder, or import files.</p>
        </div>
      ) : mode === 'details' ? (
        <div className="fv-details">
          <div className="fv-row fv-header">
            <span>Name</span>
            <span>Type</span>
            <span>Size</span>
            <span>Modified</span>
          </div>
          {children.map((c) => (
            <div key={c.path} className="fv-row" onClick={() => onOpen(c)} onContextMenu={(e) => onContext(e, c)}>
              <span className="fv-namecell">
                <Thumb node={c} size={16} />
                {displayName(c)}
              </span>
              <span>{typeLabel[c.type]}</span>
              <span>{c.type === 'folder' ? `${(c.children ?? []).length} items` : fmtSize(c.size)}</span>
              <span className="fv-modcell">
                {fmtDate(c.updatedAt)}
                <More c={c} />
              </span>
            </div>
          ))}
        </div>
      ) : mode === 'list' ? (
        <div className="fv-list">
          {children.map((c) => (
            <div key={c.path} className="fv-list-item" onClick={() => onOpen(c)} onContextMenu={(e) => onContext(e, c)}>
              <Thumb node={c} size={16} />
              <span className="fi-name">{displayName(c)}</span>
              <More c={c} />
            </div>
          ))}
        </div>
      ) : (
        <div className={mode === 'large' ? 'fv-grid-large' : 'fv-grid-medium'}>
          {children.map((c) => (
            <div key={c.path} className="fv-card" onClick={() => onOpen(c)} onContextMenu={(e) => onContext(e, c)}>
              <More c={c} />
              <div className="fv-thumb">
                <Thumb node={c} size={mode === 'large' ? 40 : 28} />
              </div>
              <span className="fi-name">{displayName(c)}</span>
              {c.type === 'folder' ? (
                <span className="fi-meta">{(c.children ?? []).length} items</span>
              ) : (
                <span className="fi-meta">{typeLabel[c.type]}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
