import { useEffect, useState } from 'react'
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
import Placeholder from '@tiptap/extension-placeholder'
import { KitTable, KitTableRow, KitTableHeader, KitTableCell } from './tableKit'
import { Toolbar } from './Toolbar'
import { TableFloatingToolbar, TableContextMenu } from './TableControls'
import { ImageToolbar } from './ImageToolbar'

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
              if (file) {
                const reader = new FileReader()
                reader.onload = () => editor?.chain().focus().setImage({ src: reader.result as string }).run()
                reader.readAsDataURL(file)
                return true
              }
            }
          }
          return false
        },
        handleDrop(view, event) {
          const files = (event as DragEvent).dataTransfer?.files
          if (files && files.length && files[0].type.startsWith('image/')) {
            const reader = new FileReader()
            reader.onload = () => editor?.chain().focus().setImage({ src: reader.result as string }).run()
            reader.readAsDataURL(files[0])
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
      const pageEl = document.querySelector('.page') as HTMLElement | null
      const scroller = document.querySelector('.doc-scroll') as HTMLElement | null
      const pages = pageEl ? Math.max(1, Math.ceil((pageEl.offsetHeight - 16) / PAGE_PX)) : 1
      const page = scroller ? Math.min(pages, Math.floor(scroller.scrollTop / PAGE_PX) + 1) : 1
      setStats({ words, chars: text.length, pages, page })
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
          <PageBreaks pages={stats.pages} />
        </div>
      </div>
      {editor && <TableFloatingToolbar editor={editor} />}
      {editor && <ImageToolbar editor={editor} onCrop={onCropImage} />}
      {editor && tableCtx && (
        <TableContextMenu editor={editor} x={tableCtx.x} y={tableCtx.y} onClose={() => setTableCtx(null)} />
      )}
      <StatusBar stats={stats} />
    </div>
  )
}

// Dashed dividers overlaid where each new page begins.
function PageBreaks({ pages }: { pages: number }) {
  if (pages <= 1) return null
  return (
    <div className="page-breaks">
      {Array.from({ length: pages - 1 }, (_, i) => (
        <div key={i} className="page-break" style={{ top: (i + 1) * PAGE_PX }}>
          <span className="pb-label">Page {i + 2}</span>
        </div>
      ))}
    </div>
  )
}

// Bottom status bar: current/total pages + word & character counts.
function StatusBar({ stats }: { stats: { words: number; chars: number; pages: number; page: number } }) {
  return (
    <div className="status-bar">
      <span className="sb-pages">
        Page {stats.page} of {stats.pages}
      </span>
      <span className="sb-spacer" />
      <span>{stats.words.toLocaleString()} words</span>
      <span className="sb-dot">·</span>
      <span>{stats.chars.toLocaleString()} characters</span>
    </div>
  )
}
