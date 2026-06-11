import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import {
  AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine,
  Baseline, ClipboardPaste, Combine, Columns3, Copy, Heading, MoveDown, MoveUp, PaintBucket, Rows3,
  Scissors, Split, Trash2, X,
} from 'lucide-react'
import { CellSelection } from '@tiptap/pm/tables'
import { copyTable, cutTable, hasTableClip, moveTable, pasteTable } from './tableOps'

// Remember the most recent multi-cell selection so Merge still works even if the
// live selection collapsed (e.g. the cursor moved). Re-applied right before merging.
let lastCellSel: { anchor: number; head: number } | null = null
function rememberCellSel(editor: Editor) {
  const sel = editor.state.selection as any
  if (sel.$anchorCell && sel.$headCell) lastCellSel = { anchor: sel.$anchorCell.pos, head: sel.$headCell.pos }
}
function restoreCellSel(editor: Editor): boolean {
  const sel = editor.state.selection as any
  if (sel.$anchorCell) return true // already a cell selection
  if (!lastCellSel) return false
  try {
    const cs = CellSelection.create(editor.state.doc, lastCellSel.anchor, lastCellSel.head)
    editor.view.dispatch(editor.state.tr.setSelection(cs as any))
    return true
  } catch {
    return false
  }
}
function robustMerge(editor: Editor) {
  restoreCellSel(editor)
  editor.chain().focus().mergeCells().run()
  lastCellSel = null // consumed
}

// ---- helpers ----
export function isCellSelection(editor: Editor) {
  return !!(editor.state.selection as any).$anchorCell
}

// Stable anchor = top-left of the active TABLE, in the scroller's CONTENT coordinates.
// (Anchoring to the selection made the bar chase the drag and sit over the cells.)
function tablePos(editor: Editor): { top: number; left: number; scroller: HTMLElement } | null {
  if (!editor.isActive('table')) return null
  const scroller = document.querySelector('.doc-scroll') as HTMLElement | null
  if (!scroller) return null
  try {
    const { from } = editor.state.selection
    const dom = editor.view.domAtPos(from).node as Node
    let el: HTMLElement | null = dom.nodeType === 3 ? dom.parentElement : (dom as HTMLElement)
    while (el && el.tagName !== 'TABLE') el = el.parentElement
    if (!el) return null
    const t = el.getBoundingClientRect()
    const s = scroller.getBoundingClientRect()
    return { top: t.top - s.top + scroller.scrollTop, left: t.left - s.left + scroller.scrollLeft, scroller }
  } catch {
    return null
  }
}

const chain = (editor: Editor) => editor.chain().focus()

const FILL_PALETTE = ['#fde2e2', '#fde8cd', '#fff3bf', '#d3f9d8', '#d0ebff', '#e5dbff', '#f1f3f5', '#ced4da', '#ffffff']
const TEXT_PALETTE = ['#000000', '#495057', '#e03131', '#e8590c', '#f08c00', '#2f9e44', '#1971c2', '#6741d9', '#c2255c']

// horizontal text alignment (applies to the paragraph inside the cell)
function HAlignButtons({ editor }: { editor: Editor }) {
  const cur = editor.isActive({ textAlign: 'center' })
    ? 'center'
    : editor.isActive({ textAlign: 'right' })
    ? 'right'
    : 'left'
  const set = (a: string) => chain(editor).setTextAlign(a).run()
  const b = (a: string, icon: React.ReactNode, title: string) => (
    <button className={`tc-btn ${cur === a ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => set(a)} title={title}>
      {icon}
    </button>
  )
  return (
    <>
      {b('left', <AlignLeft size={15} />, 'Align left')}
      {b('center', <AlignCenter size={15} />, 'Align center')}
      {b('right', <AlignRight size={15} />, 'Align right')}
    </>
  )
}

// vertical cell alignment
function VAlignButtons({ editor }: { editor: Editor }) {
  const cur =
    editor.getAttributes('tableCell').verticalAlign ||
    editor.getAttributes('tableHeader').verticalAlign ||
    'top'
  const set = (v: string) => chain(editor).setCellAttribute('verticalAlign', v).run()
  const b = (v: string, icon: React.ReactNode, title: string) => (
    <button className={`tc-btn ${cur === v ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => set(v)} title={title}>
      {icon}
    </button>
  )
  return (
    <>
      {b('top', <AlignVerticalJustifyStart size={15} />, 'Align top')}
      {b('middle', <AlignVerticalJustifyCenter size={15} />, 'Align middle')}
      {b('bottom', <AlignVerticalJustifyEnd size={15} />, 'Align bottom')}
    </>
  )
}

// shared swatch row — apply(null) clears
function ColorRow({
  apply,
  palette,
  customIcon,
}: {
  apply: (c: string | null) => void
  palette: string[]
  customIcon: React.ReactNode
}) {
  return (
    <div className="tc-swatches">
      {palette.map((c) => (
        <button
          key={c}
          className="tc-swatch"
          style={{ background: c }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply(c)}
          title={c}
        />
      ))}
      <label className="tc-swatch tc-custom" title="Custom color">
        {customIcon}
        <input type="color" onChange={(e) => apply(e.target.value)} />
      </label>
      <button className="tc-swatch tc-clear" onMouseDown={(e) => e.preventDefault()} onClick={() => apply(null)} title="Remove">
        <X size={13} />
      </button>
    </div>
  )
}

// compact single color button (for the floating toolbar)
function ColorButton({ icon, color, apply, title }: { icon: React.ReactNode; color: string; apply: (c: string) => void; title: string }) {
  return (
    <label className="tc-btn tc-colorbtn" title={title}>
      {icon}
      <span className="tc-colorbar" style={{ background: color }} />
      <input type="color" onChange={(e) => apply(e.target.value)} />
    </label>
  )
}

const applyText = (editor: Editor) => (c: string | null) =>
  c ? chain(editor).setColor(c).run() : chain(editor).unsetColor().run()
const applyFill = (editor: Editor) => (c: string | null) => chain(editor).setCellAttribute('backgroundColor', c).run()

// structural ops shared by both surfaces
function structural(editor: Editor) {
  const can = editor.can()
  return {
    rowAbove: () => chain(editor).addRowBefore().run(),
    rowBelow: () => chain(editor).addRowAfter().run(),
    colLeft: () => chain(editor).addColumnBefore().run(),
    colRight: () => chain(editor).addColumnAfter().run(),
    delRow: () => chain(editor).deleteRow().run(),
    delCol: () => chain(editor).deleteColumn().run(),
    merge: () => robustMerge(editor),
    split: () => chain(editor).splitCell().run(),
    header: () => chain(editor).toggleHeaderRow().run(),
    delTable: () => chain(editor).deleteTable().run(),
    moveUp: () => moveTable(editor, -1),
    moveDown: () => moveTable(editor, 1),
    copy: () => copyTable(editor),
    cut: () => cutTable(editor),
    paste: () => pasteTable(editor),
    canMerge: can.mergeCells() || lastCellSel != null, // also allow merging a remembered selection
    canSplit: can.splitCell(),
    canPaste: hasTableClip(),
  }
}

// =====================================================================
// Floating Word-style toolbar — appears above the active table.
// =====================================================================
export function TableFloatingToolbar({ editor }: { editor: Editor }) {
  const [pos, setPos] = useState<{ top: number; left: number; scroller: HTMLElement } | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    const update = () => {
      setPos(tablePos(editor))
      rememberCellSel(editor)
      force((n) => n + 1)
    }
    update()
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    window.addEventListener('resize', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
      window.removeEventListener('resize', update)
    }
  }, [editor])

  if (!pos) return null
  const s = structural(editor)
  const ic = (fn: () => void, icon: React.ReactNode, title: string, opts: { disabled?: boolean; danger?: boolean } = {}) => (
    <button
      className={`tc-btn ${opts.danger ? 'danger' : ''}`}
      disabled={opts.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        fn()
        force((n) => n + 1) // refresh (e.g. so Paste enables right after Copy, which dispatches no transaction)
      }}
      title={title}
    >
      {icon}
    </button>
  )

  const textColor = editor.getAttributes('textStyle').color || '#000000'
  return createPortal(
    // translateY(-100%) keeps the whole bar (even when it wraps) ABOVE the table, never over the cells
    <div className="table-toolbar" style={{ left: pos.left, top: pos.top - 8, transform: 'translateY(-100%)' }}>
      {ic(s.rowAbove, <ArrowUpToLine size={15} />, 'Insert row above')}
      {ic(s.rowBelow, <ArrowDownToLine size={15} />, 'Insert row below')}
      {ic(s.colLeft, <ArrowLeftToLine size={15} />, 'Insert column left')}
      {ic(s.colRight, <ArrowRightToLine size={15} />, 'Insert column right')}
      <span className="tc-sep" />
      {ic(s.delRow, <Rows3 size={15} />, 'Delete row')}
      {ic(s.delCol, <Columns3 size={15} />, 'Delete column')}
      <span className="tc-sep" />
      {ic(s.merge, <Combine size={15} />, 'Merge cells', { disabled: !s.canMerge })}
      {ic(s.split, <Split size={15} />, 'Split cell', { disabled: !s.canSplit })}
      <span className="tc-sep" />
      <HAlignButtons editor={editor} />
      <span className="tc-sep" />
      <VAlignButtons editor={editor} />
      <span className="tc-sep" />
      <ColorButton icon={<Baseline size={15} />} color={textColor} apply={applyText(editor)} title="Text color" />
      <ColorButton icon={<PaintBucket size={15} />} color={'#d0ebff'} apply={applyFill(editor)} title="Cell shading" />
      <span className="tc-sep" />
      {ic(s.copy, <Copy size={15} />, 'Copy table')}
      {ic(s.cut, <Scissors size={15} />, 'Cut table')}
      {ic(s.paste, <ClipboardPaste size={15} />, 'Paste table', { disabled: !s.canPaste })}
      {ic(s.moveUp, <MoveUp size={15} />, 'Move table up')}
      {ic(s.moveDown, <MoveDown size={15} />, 'Move table down')}
      <span className="tc-sep" />
      {ic(s.header, <Heading size={15} />, 'Toggle header row')}
      {ic(s.delTable, <Trash2 size={15} />, 'Delete table', { danger: true })}
    </div>,
    pos.scroller
  )
}

// =====================================================================
// Right-click context menu (Word-style).
// =====================================================================
export function TableContextMenu({ editor, x, y, onClose }: { editor: Editor; x: number; y: number; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('click', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const s = structural(editor)
  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }
  const row = (icon: React.ReactNode, label: string, fn: () => void, opts: { disabled?: boolean; danger?: boolean } = {}) => (
    <button className={opts.danger ? 'danger' : ''} disabled={opts.disabled} onMouseDown={(e) => e.preventDefault()} onClick={run(fn)}>
      {icon}
      {label}
    </button>
  )

  const left = Math.min(x, window.innerWidth - 240)
  const top = Math.min(y, window.innerHeight - 430)

  return (
    <div className="table-ctx" style={{ left, top }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {row(<ArrowUpToLine size={14} />, 'Insert row above', s.rowAbove)}
      {row(<ArrowDownToLine size={14} />, 'Insert row below', s.rowBelow)}
      {row(<ArrowLeftToLine size={14} />, 'Insert column left', s.colLeft)}
      {row(<ArrowRightToLine size={14} />, 'Insert column right', s.colRight)}
      <div className="ctx-sep" />
      {row(<Rows3 size={14} />, 'Delete row', s.delRow)}
      {row(<Columns3 size={14} />, 'Delete column', s.delCol)}
      <div className="ctx-sep" />
      {row(<Combine size={14} />, 'Merge cells', s.merge, { disabled: !s.canMerge })}
      {row(<Split size={14} />, 'Split cell', s.split, { disabled: !s.canSplit })}
      <div className="ctx-sep" />
      <div className="tc-ctx-group">
        <span className="tc-ctx-label">Align</span>
        <div className="tc-ctx-row">
          <HAlignButtons editor={editor} />
          <span className="tc-sep" />
          <VAlignButtons editor={editor} />
        </div>
      </div>
      <div className="tc-ctx-group">
        <span className="tc-ctx-label">Text color</span>
        <ColorRow apply={applyText(editor)} palette={TEXT_PALETTE} customIcon={<Baseline size={13} />} />
      </div>
      <div className="tc-ctx-group">
        <span className="tc-ctx-label">Cell shading</span>
        <ColorRow apply={applyFill(editor)} palette={FILL_PALETTE} customIcon={<PaintBucket size={13} />} />
      </div>
      <div className="ctx-sep" />
      {row(<Copy size={14} />, 'Copy table', s.copy)}
      {row(<Scissors size={14} />, 'Cut table', s.cut)}
      {row(<ClipboardPaste size={14} />, 'Paste table below', s.paste, { disabled: !s.canPaste })}
      {row(<MoveUp size={14} />, 'Move table up', s.moveUp)}
      {row(<MoveDown size={14} />, 'Move table down', s.moveDown)}
      <div className="ctx-sep" />
      {row(<Heading size={14} />, 'Toggle header row', s.header)}
      {row(<Trash2 size={14} />, 'Delete table', s.delTable, { danger: true })}
    </div>
  )
}
