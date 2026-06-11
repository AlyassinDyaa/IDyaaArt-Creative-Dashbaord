import { useRef } from 'react'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'

export interface CropPayload {
  src: string
  setSrc: (dataUrl: string) => void
}
export interface ResizableImageOptions extends ImageOptions {
  onCrop?: (p: CropPayload) => void
}

type Align = 'left' | 'center' | 'right' | 'wrap-left' | 'wrap-right' | null

// Minimal NodeView: renders the image, a selection outline, and a corner resize handle.
// All other controls (size/align/wrap/move/crop) live in the external ImageToolbar,
// which stays open until you click away — so it can never "auto-unselect".
function ImageNodeView(props: any) {
  const { node, updateAttributes, selected } = props
  const imgRef = useRef<HTMLImageElement>(null)
  const align: Align = node.attrs.align ?? null
  const isWrap = align === 'wrap-left' || align === 'wrap-right'

  // pointer-capture drag so resize never gets "stuck"
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const pid = e.pointerId
    const startX = e.clientX
    const startW = imgRef.current?.clientWidth ?? 300
    try {
      el.setPointerCapture(pid)
    } catch {}
    const move = (ev: PointerEvent) => updateAttributes({ width: `${Math.max(60, Math.round(startW + (ev.clientX - startX)))}px` })
    const up = () => {
      try {
        el.releasePointerCapture(pid)
      } catch {}
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const style: React.CSSProperties = { width: node.attrs.width || 'fit-content' }
  if (isWrap && node.attrs.wrapShift) style.marginTop = node.attrs.wrapShift

  return (
    <NodeViewWrapper
      className={`rimg ${align ? 'align-' + align : ''}`}
      data-selected={selected ? 'true' : 'false'}
      style={style}
    >
      <img ref={imgRef} src={node.attrs.src} alt={node.attrs.alt || ''} draggable={false} />
      {selected && <span className="rimg-handle" onPointerDown={startResize} title="Drag to resize" />}
    </NodeViewWrapper>
  )
}

export const ResizableImage = Image.extend<ResizableImageOptions>({
  draggable: true,
  addOptions() {
    return { ...this.parent?.(), onCrop: undefined }
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.width || el.getAttribute('width') || null,
        renderHTML: (attrs: Record<string, any>) => (attrs.width ? { style: `width:${attrs.width}` } : {}),
      },
      align: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-align') || null,
        renderHTML: (attrs: Record<string, any>) => (attrs.align ? { 'data-align': attrs.align } : {}),
      },
      wrapShift: {
        default: null,
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-wrapshift') ? Number(el.getAttribute('data-wrapshift')) : null),
        renderHTML: (attrs: Record<string, any>) => (attrs.wrapShift != null ? { 'data-wrapshift': attrs.wrapShift } : {}),
      },
      originalSrc: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },
})
