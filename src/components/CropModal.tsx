import { useEffect, useRef, useState } from 'react'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function CropModal({
  src,
  onApply,
  onClose,
}: {
  src: string
  onApply: (dataUrl: string) => void
  onClose: () => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [disp, setDisp] = useState({ w: 0, h: 0 })
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 })

  // initialize crop box once the image's displayed size is known
  const onLoad = () => {
    const el = imgRef.current!
    const w = el.clientWidth
    const h = el.clientHeight
    setDisp({ w, h })
    setRect({ x: w * 0.1, y: h * 0.1, w: w * 0.8, h: h * 0.8 })
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

  const startMove = (e: React.PointerEvent) => {
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const r0 = { ...rect }
    const onMove = (ev: PointerEvent) => {
      setRect((r) => ({
        ...r,
        x: clamp(r0.x + (ev.clientX - sx), 0, disp.w - r.w),
        y: clamp(r0.y + (ev.clientY - sy), 0, disp.h - r.h),
      }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const r0 = { ...rect }
    const onMove = (ev: PointerEvent) => {
      setRect((r) => ({
        ...r,
        w: clamp(r0.w + (ev.clientX - sx), 30, disp.w - r.x),
        h: clamp(r0.h + (ev.clientY - sy), 30, disp.h - r.y),
      }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const apply = () => {
    const el = imgRef.current!
    const scale = el.naturalWidth / disp.w
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(rect.w * scale)
    canvas.height = Math.round(rect.h * scale)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(
      el,
      rect.x * scale,
      rect.y * scale,
      rect.w * scale,
      rect.h * scale,
      0,
      0,
      canvas.width,
      canvas.height
    )
    onApply(canvas.toDataURL('image/png'))
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal crop-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Crop image</h2>
          <p>Drag the box to move it, drag the corner to resize, then apply.</p>
        </div>
        <div className="crop-stage">
          <div className="crop-img-wrap" style={{ position: 'relative', display: 'inline-block' }}>
            <img ref={imgRef} src={src} alt="" onLoad={onLoad} className="crop-img" draggable={false} />
            {disp.w > 0 && (
              <div
                className="crop-box"
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                onPointerDown={startMove}
              >
                <span className="crop-handle" onPointerDown={startResize} />
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={apply}>
            Apply crop
          </button>
        </div>
      </div>
    </div>
  )
}
