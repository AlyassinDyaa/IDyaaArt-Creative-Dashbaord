import { useEffect, useReducer, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Check, Code, Eye, EyeOff, Highlighter,
  ImageUp, Images, Italic, Link as LinkIcon, List, ListOrdered, Loader2, Minus, Moon, NotebookPen,
  Quote, Redo2, RemoveFormatting, Save, StickyNote, Strikethrough, Sun, Table as TableIcon,
  Underline as UnderlineIcon, Undo2,
} from 'lucide-react'
import type { SaveState } from './Editor'
import { TablePicker } from './TablePicker'
import { insertImageFromFile } from '../lib/insertImage'

// Editor font choices, grouped. "Display & Comic" mixes the bundled Cyberpunks face
// with Google display fonts loaded in index.html (they fall back gracefully offline).
const FONT_GROUPS: { label: string; fonts: string[] }[] = [
  { label: 'Sans-serif', fonts: ['Inter', 'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS'] },
  { label: 'Serif', fonts: ['Georgia', 'Times New Roman', 'Garamond', 'Palatino Linotype', 'Cinzel'] },
  { label: 'Monospace', fonts: ['Courier New', 'Consolas'] },
  { label: 'Display & Comic', fonts: ['Cyberpunks', 'Bangers', 'Permanent Marker', 'Comic Sans MS', 'Special Elite', 'Creepster', 'Orbitron', 'Caveat'] },
]
const SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '40px']

export function Toolbar({
  editor,
  onSave,
  saveState,
  dark,
  onToggleDark,
  onBrowseImages,
  lined,
  lineGap,
  onToggleLined,
  onSetLineGap,
  onAddNote,
  noteCount,
  notesVisible,
  onToggleNotes,
}: {
  editor: Editor
  onSave: () => void
  saveState: SaveState
  dark: boolean
  onToggleDark: () => void
  onBrowseImages: () => void
  lined: boolean
  lineGap: number
  onToggleLined: () => void
  onSetLineGap: (px: number) => void
  onAddNote: () => void
  noteCount: number
  notesVisible: boolean
  onToggleNotes: () => void
}) {
  const imgInput = useRef<HTMLInputElement>(null)
  const [tableOpen, setTableOpen] = useState(false)
  // re-render the toolbar on every editor change so active states stay in sync
  const [, force] = useReducer((x) => x + 1, 0)
  useEffect(() => {
    if (!editor) return
    const f = () => force()
    editor.on('transaction', f)
    return () => {
      editor.off('transaction', f)
    }
  }, [editor])
  if (!editor) return null
  const inTable = editor.isActive('table')

  const btn = (active: boolean, onClick: () => void, children: React.ReactNode, title: string) => (
    <button className={`tb-btn ${active ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title}>
      {children}
    </button>
  )

  const headingValue = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
    ? 'h2'
    : editor.isActive('heading', { level: 3 })
    ? 'h3'
    : 'p'

  const insertImageFile = (file: File) => insertImageFromFile(editor, file)

  return (
    <div className="toolbar">
      <button className="tb-save" onClick={onSave} title="Save (Ctrl+S)">
        {saveState === 'saving' ? (
          <><Loader2 size={15} className="spin" /> Saving</>
        ) : saveState === 'saved' || saveState === 'idle' ? (
          <><Check size={15} /> Saved</>
        ) : (
          <><Save size={15} /> Save</>
        )}
      </button>
      <span className="tb-sep" />
      {btn(false, () => editor.chain().focus().undo().run(), <Undo2 size={16} />, 'Undo')}
      {btn(false, () => editor.chain().focus().redo().run(), <Redo2 size={16} />, 'Redo')}
      <span className="tb-sep" />

      <select
        className="tb-select"
        value={headingValue}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'p') editor.chain().focus().setParagraph().run()
          else editor.chain().focus().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run()
        }}
        title="Style"
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>

      <select
        className="tb-select"
        onChange={(e) => {
          const f = e.target.value
          if (f === 'Default') editor.chain().focus().unsetFontFamily().run()
          else editor.chain().focus().setFontFamily(f).run()
        }}
        title="Font"
        defaultValue="Default"
      >
        <option value="Default">Default font</option>
        {FONT_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.fonts.map((f) => (
              <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>
                {f}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        className="tb-select"
        onChange={(e) => editor.chain().focus().setMark('textStyle', { fontSize: e.target.value }).run()}
        title="Font size"
        defaultValue="16px"
      >
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {parseInt(s)}
          </option>
        ))}
      </select>

      <span className="tb-sep" />
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold size={16} />, 'Bold')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic size={16} />, 'Italic')}
      {btn(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon size={16} />, 'Underline')}
      {btn(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), <Strikethrough size={16} />, 'Strikethrough')}

      <span className="tb-color" title="Text color">
        <input
          type="color"
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        />
        <span className="tb-btn">A</span>
      </span>
      <span className="tb-color" title="Highlight">
        <input
          type="color"
          onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()}
        />
        <span className="tb-btn"><Highlighter size={16} /></span>
      </span>

      <span className="tb-sep" />
      {btn(editor.isActive({ textAlign: 'left' }), () => editor.chain().focus().setTextAlign('left').run(), <AlignLeft size={16} />, 'Align left')}
      {btn(editor.isActive({ textAlign: 'center' }), () => editor.chain().focus().setTextAlign('center').run(), <AlignCenter size={16} />, 'Center')}
      {btn(editor.isActive({ textAlign: 'right' }), () => editor.chain().focus().setTextAlign('right').run(), <AlignRight size={16} />, 'Align right')}
      {btn(editor.isActive({ textAlign: 'justify' }), () => editor.chain().focus().setTextAlign('justify').run(), <AlignJustify size={16} />, 'Justify')}

      <span className="tb-sep" />
      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List size={16} />, 'Bullet list')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={16} />, 'Numbered list')}
      {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), <Quote size={16} />, 'Quote')}
      {btn(editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run(), <Code size={16} />, 'Code block')}

      <span className="tb-sep" />
      {btn(
        editor.isActive('link'),
        () => {
          const prev = editor.getAttributes('link').href
          const url = window.prompt('Link URL', prev || 'https://')
          if (url === null) return
          if (url === '') editor.chain().focus().unsetLink().run()
          else editor.chain().focus().setLink({ href: url }).run()
        },
        <LinkIcon size={16} />,
        'Link'
      )}
      {btn(false, () => imgInput.current?.click(), <ImageUp size={16} />, 'Upload image from this device')}
      {btn(false, onBrowseImages, <Images size={16} />, 'Insert image from your projects')}
      <span className="tb-pop-wrap">
        {btn(inTable, () => setTableOpen(true), <TableIcon size={16} />, 'Insert table')}
        {tableOpen && (
          <TablePicker
            onClose={() => setTableOpen(false)}
            onPick={(rows, cols, withHeader) => {
              editor.chain().focus().insertTable({ rows, cols, withHeaderRow: withHeader }).run()
              setTableOpen(false)
            }}
          />
        )}
      </span>
      {btn(false, () => editor.chain().focus().setHorizontalRule().run(), <Minus size={16} />, 'Horizontal rule')}
      {btn(false, () => editor.chain().focus().unsetAllMarks().clearNodes().run(), <RemoveFormatting size={16} />, 'Clear formatting')}

      <span className="tb-sep" />
      {btn(false, onAddNote, <StickyNote size={16} />, 'Add sticky note')}
      {noteCount > 0 &&
        btn(
          !notesVisible,
          onToggleNotes,
          notesVisible ? <Eye size={16} /> : <EyeOff size={16} />,
          notesVisible ? `Hide notes (${noteCount})` : `Show notes (${noteCount})`
        )}

      <span style={{ flex: 1 }} />
      {btn(lined, onToggleLined, <NotebookPen size={16} />, 'Notebook lines')}
      {lined && (
        <select
          className="tb-select"
          value={lineGap}
          onChange={(e) => onSetLineGap(Number(e.target.value))}
          title="Line spacing"
        >
          <option value={26}>Compact</option>
          <option value={32}>Normal</option>
          <option value={40}>Wide</option>
          <option value={48}>Extra wide</option>
        </select>
      )}
      {btn(false, onToggleDark, dark ? <Sun size={16} /> : <Moon size={16} />, dark ? 'Light page' : 'Dark page')}

      <input
        ref={imgInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) insertImageFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
