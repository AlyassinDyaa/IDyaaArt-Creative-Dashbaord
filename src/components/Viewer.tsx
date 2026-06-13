import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, FileDown, FileText, X } from 'lucide-react'
import { api, fileUrl } from '../lib/api'
import type { TreeNode } from '../lib/types'

export function Viewer({
  node,
  siblings = [],
  onNavigate,
  onConvertedToDoc,
  onClose,
}: {
  node: TreeNode
  siblings?: TreeNode[]
  onNavigate?: (node: TreeNode) => void
  onConvertedToDoc: (path: string) => void
  onClose: () => void
}) {
  const [sheetHtml, setSheetHtml] = useState<string>('')
  const [busy, setBusy] = useState(false)

  // prev/next image in the same folder
  const idx = siblings.findIndex((n) => n.path === node.path)
  const prev = idx > 0 ? siblings[idx - 1] : null
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null
  const canNav = node.type === 'image' && siblings.length > 1

  useEffect(() => {
    setSheetHtml('')
    if (node.type === 'sheet' || node.type === 'word') {
      api.convert(node.path).then((r) => setSheetHtml(r.html)).catch(() => {})
    }
  }, [node.path])

  // Esc closes; ← / → navigate between images
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (canNav && e.key === 'ArrowLeft' && prev) onNavigate?.(prev)
      else if (canNav && e.key === 'ArrowRight' && next) onNavigate?.(next)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, canNav, prev, next, onNavigate])

  const importAsDoc = async () => {
    setBusy(true)
    try {
      const r = await api.convert(node.path, true)
      if (r.path) onConvertedToDoc(r.path)
    } finally {
      setBusy(false)
    }
  }

  let body
  if (node.type === 'image') {
    body = <img src={fileUrl(node.path)} alt={node.name} />
  } else if (node.type === 'pdf') {
    body = <iframe title={node.name} src={fileUrl(node.path)} />
  } else if (node.type === 'sheet' || node.type === 'word') {
    body = (
      <>
        <div className="viewer-bar">
          <button className="btn primary" onClick={importAsDoc} disabled={busy}>
            <FileText size={15} /> {busy ? 'Converting…' : 'Open as editable document'}
          </button>
          <a className="btn" href={fileUrl(node.path)} download>
            <FileDown size={15} /> Download original
          </a>
        </div>
        <div className="sheet-html" dangerouslySetInnerHTML={{ __html: sheetHtml }} />
      </>
    )
  } else {
    body = (
      <div style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
        <p style={{ fontSize: 16 }}>{node.name}</p>
        <a className="btn" href={fileUrl(node.path)} download>
          <FileDown size={15} /> Download
        </a>
      </div>
    )
  }

  return (
    <div className="viewer">
      <button className="viewer-close" onClick={onClose} title="Close (Esc)">
        <X size={18} />
      </button>
      {canNav && (
        <>
          <button className="viewer-nav prev" onClick={() => prev && onNavigate?.(prev)} disabled={!prev} title="Previous image (←)">
            <ChevronLeft size={26} />
          </button>
          <button className="viewer-nav next" onClick={() => next && onNavigate?.(next)} disabled={!next} title="Next image (→)">
            <ChevronRight size={26} />
          </button>
          <div className="viewer-count">{idx + 1} / {siblings.length}</div>
        </>
      )}
      {body}
    </div>
  )
}
