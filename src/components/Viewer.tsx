import { useEffect, useState } from 'react'
import { FileDown, FileText, X } from 'lucide-react'
import { api, fileUrl } from '../lib/api'
import type { TreeNode } from '../lib/types'

export function Viewer({
  node,
  onConvertedToDoc,
  onClose,
}: {
  node: TreeNode
  onConvertedToDoc: (path: string) => void
  onClose: () => void
}) {
  const [sheetHtml, setSheetHtml] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setSheetHtml('')
    if (node.type === 'sheet' || node.type === 'word') {
      api.convert(node.path).then((r) => setSheetHtml(r.html)).catch(() => {})
    }
  }, [node.path])

  // Esc closes the viewer
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

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
      {body}
    </div>
  )
}
