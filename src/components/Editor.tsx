import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import { ResizableImage, type CropPayload } from './ResizableImage'
import { Pagination } from './pagination'
import { insertImageFromFile } from '../lib/insertImage'
import Placeholder from '@tiptap/extension-placeholder'
import { KitTable, KitTableRow, KitTableHeader, KitTableCell } from './tableKit'
import { Toolbar } from './Toolbar'
import { TableFloatingToolbar, TableContextMenu } from './TableControls'
import { ImageToolbar } from './ImageToolbar'
import { StickyLayer, useStickyNotes } from './StickyNotes'

// Extend TextStyle so it can carry a fontSize (renders + parses inline style).
const TextStyleWithSize = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.fontSize || null,
        renderHTML: (attrs: Record<string, any>) =>
          attrs.fontSize ? { style: `font-size:${attrs.fontSize}` } : {},
      },
    }
  },
})

export type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved'

export const PAGE_PX = 1056 // approx height of one US-Letter page in this layout

export function Editor({
  path,
  initialHtml,
  onChange,
  onSaveState,
  onReady,
  onSave,
  saveState,
  onBrowseImages,
  onCropImage,
}: {
  path: string
  initialHtml: string
  onChange: (html: string) => void
  onSaveState: (s: SaveState) => void
  onReady: (editor: TiptapEditor) => void
  onSave: () => void
  saveState: SaveState
  onBrowseImages: () => void
  onCropImage: (p: CropPayload) => void
}) {
  const [dark, setDark] = useState(() => localStorage.getItem('entropy-editor-dark') === '1')
  const toggleDark = () => {
    setDark((d) => {
      localStorage.setItem('entropy-editor-dark', d ? '0' : '1')
      return !d
    })
  }
  const [lined, setLined] = useState(() => localStorage.getItem('entropy-editor-lined') === '1')
  const [lineGap, setLineGap] = useState(() => Number(localStorage.getItem('entropy-editor-linegap')) || 32)
  const toggleLined = () => {
    setLined((v) => {
      localStorage.setItem('entropy-editor-lined', v ? '0' : '1')
      return !v
    })
  }
  const changeLineGap = (px: number) => {
    localStorage.setItem('entropy-editor-linegap', String(px))
    setLineGap(px)
  }
  const sticky = useStickyNotes(path)
  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Underline,
        TextStyleWithSize,
        Color,
        FontFamily,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Link.configure({ openOnClick: false, autolink: true }),
        ResizableImage.configure({ inline: false, allowBase64: true, onCrop: onCropImage }),
        Placeholder.configure({ placeholder: 'Start writing your story…' }),
        KitTable.configure({ resizable: true, lastColumnResizable: true, allowTableNodeSelection: true }),
        KitTableRow,
        KitTableHeader,
        KitTableCell,
        Pagination,
      ],
      content: initialHtml || '<p></p>',
      onUpdate: ({ editor }) => {
        onSaveState('unsaved')
        onChange(editor.getHTML())
      },
      editorProps: {
        handleDOMEvents: {
          // Don't let a right-click collapse an existing multi-cell selection —
          // so you can select cells, release, then right-click → Merge.
          mousedown: (view, event) => {
            if ((event as MouseEvent).button === 2 && (view.state.selection as any).$anchorCell) {
              event.preventDefault()
              return true
            }
            return false
          },
        },
        handlePaste(view, event) {
          const items = event.clipboardData?.items
          if (!items) return false
          for (const it of items) {
            if (it.type.startsWith('image/')) {
              const file = it.getAsFile()
              if (file && editor) {
                insertImageFromFile(editor, file)
                return true
              }
            }
          }
          return false
        },
        handleDrop(view, event) {
          const files = (event as DragEvent).dataTransfer?.files
          if (files && files.length && files[0].type.startsWith('image/') && editor) {
            insertImageFromFile(editor, files[0])
            return true
          }
          return false
        },
      },
    },
    [path]
  )

  useEffect(() => {
    if (editor) {
      onReady(editor)
      ;(window as any).__editor = editor // diagnostics aid
    }
  }, [editor])

  const [tableCtx, setTableCtx] = useState<{ x: number; y: number } | null>(null)

  // live document stats (pages / words / chars) shared by the status bar and page dividers
  const [stats, setStats] = useState({ words: 0, chars: 0, pages: 1, page: 1 })
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const text = editor.getText()
      const words = (text.match(/\S+/g) || []).length
      const scroller = document.querySelector('.doc-scroll') as HTMLElement | null
      // pages = number of pagination spacers + 1; current page = spacers scrolled past the top
      const spacers = Array.from(document.querySelectorAll('.pm-page-spacer'))
      const pages = spacers.length + 1
      let page = 1
      if (scroller) {
        const top = scroller.getBoundingClientRect().top + 80
        for (const sp of spacers) if (sp.getBoundingClientRect().top < top) page++
      }
      setStats({ words, chars: text.length, pages, page: Math.min(page, pages) })
    }
    update()
    editor.on('update', update)
    editor.on('selectionUpdate', update)
    const scroller = document.querySelector('.doc-scroll')
    scroller?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      editor.off('update', update)
      editor.off('selectionUpdate', update)
      scroller?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [editor])

  // Jump to a page by scrolling the canvas to that page's boundary, so you can page
  // through the document with a button instead of scrolling manually.
  const goToPage = useCallback((p: number) => {
    const scroller = document.querySelector('.doc-scroll') as HTMLElement | null
    if (!scroller) return
    const spacers = Array.from(document.querySelectorAll('.pm-page-spacer')) as HTMLElement[]
    const target = Math.min(Math.max(1, p), spacers.length + 1)
    if (target <= 1) {
      scroller.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const sp = spacers[target - 2] // the spacer that precedes page `target`
    if (!sp) return
    const delta = sp.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollBy({ top: delta - 12, behavior: 'smooth' }) // land just above the new sheet
  }, [])

  return (
    <div className="editor-wrap">
      {editor && (
        <Toolbar
          editor={editor}
          onSave={onSave}
          saveState={saveState}
          dark={dark}
          onToggleDark={toggleDark}
          onBrowseImages={onBrowseImages}
          lined={lined}
          lineGap={lineGap}
          onToggleLined={toggleLined}
          onSetLineGap={changeLineGap}
          onAddNote={sticky.addNote}
          noteCount={sticky.notes.length}
          notesVisible={sticky.visible}
          onToggleNotes={sticky.toggleVisible}
        />
      )}
      <div
        className={`doc-scroll ${dark ? 'dark' : ''}`}
        onContextMenu={(e) => {
          if (!editor) return
          // move the cursor to the right-clicked cell (unless a multi-cell selection is active)
          const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
          const isCellSel = !!(editor.state.selection as any).$anchorCell
          if (hit && !isCellSel) editor.commands.setTextSelection(hit.pos)
          if (editor.isActive('table')) {
            e.preventDefault()
            setTableCtx({ x: e.clientX, y: e.clientY })
          }
        }}
      >
        <div
          className={`page ${dark ? 'dark' : ''} ${lined ? 'lined' : ''}`}
          style={{ ['--rule' as any]: `${lineGap}px` }}
        >
          <EditorContent editor={editor} />
        </div>
        {/* notes live in the scroll content so they stay pinned to a page location */}
        <StickyLayer api={sticky} />
      </div>
      {editor && <TableFloatingToolbar editor={editor} />}
      {editor && <ImageToolbar editor={editor} onCrop={onCropImage} />}
      {editor && tableCtx && (
        <TableContextMenu editor={editor} x={tableCtx.x} y={tableCtx.y} onClose={() => setTableCtx(null)} />
      )}
      <StatusBar stats={stats} onGoToPage={goToPage} />
    </div>
  )
}

// Bottom status bar: current/total pages + word & character counts, plus a pager that
// jumps page-by-page (button instead of scrolling).
function StatusBar({
  stats,
  onGoToPage,
}: {
  stats: { words: number; chars: number; pages: number; page: number }
  onGoToPage: (p: number) => void
}) {
  return (
    <div className="status-bar">
      <span className="sb-pages">
        Page {stats.page} of {stats.pages}
      </span>
      <span className="sb-spacer" />
      <span>{stats.words.toLocaleString()} words</span>
      <span className="sb-dot">·</span>
      <span>{stats.chars.toLocaleString()} characters</span>
      <span className="sb-dot">·</span>
      <div className="sb-pager">
        <button
          className="sb-pager-btn"
          onClick={() => onGoToPage(stats.page - 1)}
          disabled={stats.page <= 1}
          title="Previous page"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="sb-pager-label">
          {stats.page} / {stats.pages}
        </span>
        <button
          className="sb-pager-btn"
          onClick={() => onGoToPage(stats.page + 1)}
          disabled={stats.page >= stats.pages}
          title="Next page"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}
