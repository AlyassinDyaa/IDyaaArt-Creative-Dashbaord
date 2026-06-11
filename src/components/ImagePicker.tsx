import { useState } from 'react'
import { ChevronRight, Folder, ImageOff, X } from 'lucide-react'
import { fileUrl } from '../lib/api'
import type { TreeNode } from '../lib/types'

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) {
      const f = findNode(n.children, path)
      if (f) return f
    }
  }
  return null
}

export function ImagePicker({
  tree,
  onPick,
  onClose,
}: {
  tree: TreeNode[]
  onPick: (path: string) => void
  onClose: () => void
}) {
  const [path, setPath] = useState('') // '' = workspace root

  const current = path ? findNode(tree, path)?.children ?? [] : tree
  const folders = current.filter((n) => n.type === 'folder')
  const images = current.filter((n) => n.type === 'image')

  const crumbs = path ? path.split('/') : []

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal img-picker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2>Insert image from your projects</h2>
            <p>Browse your folders and click an image to insert it.</p>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {/* breadcrumb */}
        <div className="ip-crumbs">
          <button onClick={() => setPath('')}>Workspace</button>
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join('/')
            return (
              <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ChevronRight size={13} className="ip-sep" />
                <button onClick={() => setPath(p)}>{c}</button>
              </span>
            )
          })}
        </div>

        <div className="ip-body">
          {folders.length === 0 && images.length === 0 && (
            <div className="ip-empty">
              <ImageOff size={22} style={{ opacity: 0.5 }} />
              <p>No images or subfolders here.</p>
            </div>
          )}

          {folders.map((f) => (
            <button key={f.path} className="ip-folder" onClick={() => setPath(f.path)}>
              <Folder size={18} className="ico folder" />
              <span>{f.name}</span>
            </button>
          ))}

          <div className="ip-grid">
            {images.map((img) => (
              <button key={img.path} className="ip-img" onClick={() => onPick(img.path)} title={img.name}>
                <img src={fileUrl(img.path)} alt={img.name} loading="lazy" />
                <span>{img.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
