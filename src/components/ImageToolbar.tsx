import { useEffect, useReducer, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import {
  AlignCenter, AlignLeft, AlignRight, Crop, Maximize2, MoveDown, MoveUp, RotateCcw, WrapText,
} from 'lucide-react'
import type { CropPayload } from './ResizableImage'

function moveImage(editor: Editor, pos: number, dir: -1 | 1) {
  const { state, view } = editor
  const me = state.doc.nodeAt(pos)
  if (!me) return
  const $pos = state.doc.resolve(pos)
  const index = $pos.index()
  const parent = $pos.parent
  const target = dir < 0 ? index - 1 : index + 1
  if (target < 0 || target >= parent.childCount) return
  let tr = state.tr
  let newPos: number
  if (dir < 0) {
    const prev = parent.child(index - 1)
    newPos = pos - prev.nodeSize
    tr = tr.delete(pos, pos + me.nodeSize).insert(newPos, me)
  } else {
    const next = parent.child(index + 1)
    tr = tr.delete(pos, pos + me.nodeSize)
    newPos = pos + next.nodeSize
    tr = tr.insert(newPos, me)
  }
  try {
    tr = tr.setSelection(NodeSelection.create(tr.doc, newPos))
  } catch {}
  view.dispatch(tr.scrollIntoView())
}

/**
 * Stable, external image toolbar. Appears when you click an image and stays open until you
 * click something that isn't an image or this toolbar — so it can't "auto-unselect".
 * It tracks the image by DOM + document position, independent of the live selection.
 */
export function ImageToolbar({ editor, onCrop }: { editor: Editor; onCrop: (p: CropPayload) => void }) {
  const wrapRef = useRef<HTMLElement | null>(null)
  const posRef = useRef<number | null>(null)
  const [, force] = useReducer((x) => x + 1, 0)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest?.('.image-toolbar')) return // keep open while using the toolbar
      const wrap = t.closest?.('.rimg') as HTMLElement | null
      if (wrap) {
        wrapRef.current = wrap
        const cx = e.clientX
        const cy = e.clientY
        // capture the image's position once ProseMirror has handled the click
        setTimeout(() => {
          const sel: any = editor.state.selection
          if (sel?.node?.type?.name === 'image') {
            posRef.current = sel.from
          } else {
            const hit = editor.view.posAtCoords({ left: cx, top: cy })
            posRef.current = hit ? hit.pos : null
          }
          force()
        }, 0)
        force()
      } else {
        wrapRef.current = null
        posRef.current = null
        force()
      }
    }
    const onUpd = () => force()
    document.addEventListener('mousedown', onDown, true)
    editor.on('transaction', onUpd)
    const scroller = document.querySelector('.doc-scroll')
    scroller?.addEventListener('scroll', onUpd, { passive: true })
    window.addEventListener('resize', onUpd)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      editor.off('transaction', onUpd)
      scroller?.removeEventListener('scroll', onUpd)
      window.removeEventListener('resize', onUpd)
    }
  }, [editor])

  // outline the active image (persists independently of the selection)
  useEffect(() => {
    document.querySelectorAll('.rimg img').forEach((im) => {
      ;(im as HTMLElement).style.outline = ''
      ;(im as HTMLElement).style.boxShadow = ''
    })
    const img = wrapRef.current?.querySelector('img') as HTMLElement | null
    if (img) {
      img.style.outline = '2.5px solid #7c3aed'
      img.style.outlineOffset = '2px'
      img.style.boxShadow = '0 0 0 5px rgba(124,58,237,0.16)'
    }
  })

  const wrap = wrapRef.current
  const scroller = document.querySelector('.doc-scroll') as HTMLElement | null
  if (!wrap || !document.body.contains(wrap) || !scroller || posRef.current == null) return null

  // resolve the image node; if the captured pos isn't an image, find the one matching the DOM
  let pos = posRef.current
  let node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'image') {
    let found: number | null = null
    editor.state.doc.descendants((n, p) => {
      if (found != null) return false
      if (n.type.name === 'image' && editor.view.nodeDOM(p) === wrap) found = p
    })
    if (found == null) return null
    pos = found
    posRef.current = found
    node = editor.state.doc.nodeAt(pos)
  }
  if (!node) return null
  const attrs = node.attrs
  const align = attrs.align
  const imgPos = pos

  const r = wrap.getBoundingClientRect()
  const s = scroller.getBoundingClientRect()
  const left = r.left - s.left + scroller.scrollLeft
  const top = r.top - s.top + scroller.scrollTop

  const apply = (fn: () => void) => {
    try {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imgPos)))
    } catch {}
    fn()
    const sel: any = editor.state.selection
    if (sel?.node?.type?.name === 'image') posRef.current = sel.from
    force()
  }
  const setAttr = (a: object) => apply(() => editor.chain().focus().updateAttributes('image', a).run())
  const setWidth = (w: string | null) => setAttr({ width: w })
  const setAlign = (a: string) => setAttr({ align: align === a ? null : a, wrapShift: null })
  const crop = () => {
    const original = attrs.originalSrc || attrs.src
    onCrop({ src: attrs.src, setSrc: (d: string) => setAttr({ src: d, width: null, originalSrc: original }) })
  }
  const revert = () => setAttr({ src: attrs.originalSrc, originalSrc: null, width: null })

  const stop = (e: React.MouseEvent) => e.preventDefault()
  const b = (on: boolean, fn: () => void, icon: React.ReactNode, title: string) => (
    <button className={on ? 'on' : ''} onMouseDown={stop} onClick={fn} title={title}>
      {icon}
    </button>
  )

  return createPortal(
    <div className="image-toolbar" style={{ left, top: top - 8, transform: 'translateY(-100%)' }}>
      {b(false, () => setWidth('25%'), 'S', 'Small')}
      {b(false, () => setWidth('50%'), 'M', 'Medium')}
      {b(false, () => setWidth('100%'), 'L', 'Large')}
      {b(false, () => setWidth(null), <Maximize2 size={14} />, 'Original size')}
      <span className="it-sep" />
      {b(align === 'left', () => setAlign('left'), <AlignLeft size={14} />, 'Align left')}
      {b(align === 'center', () => setAlign('center'), <AlignCenter size={14} />, 'Align center')}
      {b(align === 'right', () => setAlign('right'), <AlignRight size={14} />, 'Align right')}
      {b(align === 'wrap-left', () => setAlign('wrap-left'), <WrapText size={14} />, 'Wrap text — image left')}
      {b(align === 'wrap-right', () => setAlign('wrap-right'), <WrapText size={14} style={{ transform: 'scaleX(-1)' }} />, 'Wrap text — image right')}
      <span className="it-sep" />
      {b(false, () => apply(() => moveImage(editor, imgPos, -1)), <MoveUp size={14} />, 'Move up')}
      {b(false, () => apply(() => moveImage(editor, imgPos, 1)), <MoveDown size={14} />, 'Move down')}
      <span className="it-sep" />
      {b(false, crop, <Crop size={14} />, 'Crop')}
      {attrs.originalSrc && b(false, revert, <RotateCcw size={14} />, 'Revert crop')}
    </div>,
    scroller
  )
}
