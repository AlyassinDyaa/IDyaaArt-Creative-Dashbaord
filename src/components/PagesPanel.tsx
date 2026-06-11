import { useEffect, useRef, useState } from 'react'
import { BookMarked, X } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { PAGE_PX } from './Editor'

const THUMB_W = 152
const MAX_THUMBS = 40 // cap live thumbnails for performance

export function PagesPanel({
  editor,
  docPath,
  onClose,
}: {
  editor: Editor | null
  docPath: string | null
  onClose: () => void
}) {
  const [html, setHtml] = useState('')
  const [pages, setPages] = useState(1)
  const [pageWidth, setPageWidth] = useState(760)
  const [bookmarks, setBookmarks] = useState<Record<number, string>>({})
  const timer = useRef<number | undefined>(undefined)

  const bmKey = `entropy-bm:${docPath || ''}`
  useEffect(() => {
    try {
      setBookmarks(JSON.parse(localStorage.getItem(bmKey) || '{}'))
    } catch {
      setBookmarks({})
    }
  }, [bmKey])

  useEffect(() => {
    if (!editor) return
    const refresh = () => {
      setHtml(editor.getHTML())
      const pageEl = document.querySelector('.page') as HTMLElement | null
      if (pageEl) {
        setPageWidth(pageEl.clientWidth)
        setPages(Math.max(1, Math.ceil((pageEl.offsetHeight - 16) / PAGE_PX)))
      }
    }
    refresh()
    const onUpdate = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = window.setTimeout(refresh, 500)
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [editor])

  const setBm = (i: number, title: string) => {
    setBookmarks((prev) => {
      const next = { ...prev }
      if (title.trim()) next[i] = title
      else delete next[i]
      localStorage.setItem(bmKey, JSON.stringify(next))
      return next
    })
  }

  const jump = (i: number) => {
    const sc = document.querySelector('.doc-scroll') as HTMLElement | null
    sc?.scrollTo({ top: i * PAGE_PX, behavior: 'smooth' })
  }

  const scale = THUMB_W / pageWidth
  const shown = Math.min(pages, MAX_THUMBS)

  return (
    <div className="pages-panel">
      <div className="pp-head">
        <BookMarked size={15} />
        <h3>Pages</h3>
        <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>
      <div className="pp-list">
        {Array.from({ length: shown }, (_, i) => (
          <div key={i} className={`pp-card ${bookmarks[i] ? 'bookmarked' : ''}`}>
            <div className="pp-thumb" style={{ width: THUMB_W, height: PAGE_PX * scale }} onClick={() => jump(i)} title={`Go to page ${i + 1}`}>
              <div
                className="pp-inner"
                style={{ width: pageWidth, transform: `scale(${scale}) translateY(${-i * PAGE_PX}px)`, transformOrigin: 'top left' }}
              >
                <div className="ProseMirror" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            </div>
            <div className="pp-meta">
              <span className="pp-num">Page {i + 1}</span>
              <input
                className="pp-bm"
                placeholder="Add a note…"
                value={bookmarks[i] || ''}
                onChange={(e) => setBm(i, e.target.value)}
              />
            </div>
          </div>
        ))}
        {pages > MAX_THUMBS && <div className="pp-more">+{pages - MAX_THUMBS} more pages</div>}
      </div>
    </div>
  )
}
