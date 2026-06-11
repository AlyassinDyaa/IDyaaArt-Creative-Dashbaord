import { useEffect, useState } from 'react'

const MAX_R = 8
const MAX_C = 10

export function TablePicker({
  onPick,
  onClose,
}: {
  onPick: (rows: number, cols: number, withHeader: boolean) => void
  onClose: () => void
}) {
  const [hr, setHr] = useState(0)
  const [hc, setHc] = useState(0)
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [header, setHeader] = useState(true)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const out = () => onClose() // picker stops its own mousedown, so this only fires for outside clicks
    window.addEventListener('keydown', h)
    window.addEventListener('mousedown', out)
    return () => {
      window.removeEventListener('keydown', h)
      window.removeEventListener('mousedown', out)
    }
  }, [onClose])

  return (
    <div className="table-picker" onMouseDown={(e) => e.stopPropagation()}>
      <div className="tp-grid" onMouseLeave={() => (setHr(0), setHc(0))}>
        {Array.from({ length: MAX_R }).map((_, r) =>
          Array.from({ length: MAX_C }).map((__, c) => (
            <div
              key={`${r}-${c}`}
              className={`tp-cell ${r <= hr && c <= hc ? 'on' : ''}`}
              onMouseEnter={() => (setHr(r), setHc(c))}
              onClick={() => onPick(r + 1, c + 1, header)}
            />
          ))
        )}
      </div>
      <div className="tp-label">{hr + 1} × {hc + 1}</div>

      <div className="tp-custom">
        <label>
          Rows
          <input type="number" min={1} max={50} value={rows} onChange={(e) => setRows(Math.max(1, +e.target.value))} />
        </label>
        <label>
          Cols
          <input type="number" min={1} max={20} value={cols} onChange={(e) => setCols(Math.max(1, +e.target.value))} />
        </label>
        <button className="btn primary" onClick={() => onPick(rows, cols, header)}>
          Insert
        </button>
      </div>
      <label className="tp-header">
        <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Header row
      </label>
    </div>
  )
}
