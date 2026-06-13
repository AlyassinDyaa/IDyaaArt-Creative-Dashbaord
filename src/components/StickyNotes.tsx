import { useCallback, useEffect, useRef, useState } from 'react'
import { GripVertical, Minus, Plus, Trash2, X } from 'lucide-react'

// Free-floating sticky notes (MS-Word-comment style): add many, drag anywhere, resize,
// recolor, collapse, delete. State lives here via useStickyNotes() and is rendered by
// <StickyLayer>; the toolbar drives "Add note" / "Show / hide" so the controls stay in
// one place. Notes are scoped to a document and persisted in localStorage — they never
// touch the saved document HTML.

export type StickyNote = {
  id: string
  text: string
  x: number
  y: number
  w: number
  h: number
  color: string
  collapsed: boolean
}

// classic sticky palette (used as the note background; text stays dark for contrast)
const COLORS = ['#fff7a8', '#ffd6a5', '#caffbf', '#a5e8ff', '#ffadad', '#e0c3fc']

const NOTE_W = 240
const NOTE_H = 180

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

const keyFor = (docPath: string) => `entropy-sticky:${docPath}`
const visKey = (docPath: string) => `entropy-sticky-visible:${docPath}`

function load(docPath: string): StickyNote[] {
  try {
    const arr = JSON.parse(localStorage.getItem(keyFor(docPath)) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export type StickyApi = {
  notes: StickyNote[]
  visible: boolean
  addNote: () => void
  toggleVisible: () => void
  update: (id: string, patch: Partial<StickyNote>) => void
  remove: (id: string) => void
  bringToFront: (id: string) => void
}

// Hook the editor uses to own note state; the toolbar calls addNote / toggleVisible.
export function useStickyNotes(docPath: string): StickyApi {
  const [notes, setNotes] = useState<StickyNote[]>(() => load(docPath))
  const [visible, setVisible] = useState(() => localStorage.getItem(visKey(docPath)) !== '0')

  // reload when switching documents
  useEffect(() => {
    setNotes(load(docPath))
    setVisible(localStorage.getItem(visKey(docPath)) !== '0')
  }, [docPath])

  // persist on every change
  useEffect(() => {
    try {
      localStorage.setItem(keyFor(docPath), JSON.stringify(notes))
    } catch {}
  }, [docPath, notes])

  const toggleVisible = useCallback(() => {
    setVisible((v) => {
      localStorage.setItem(visKey(docPath), v ? '0' : '1')
      return !v
    })
  }, [docPath])

  const addNote = useCallback(() => {
    setVisible(true)
    localStorage.setItem(visKey(docPath), '1')
    setNotes((ns) => {
      // cascade new notes near the top-left of the editor area (coords are relative
      // to the editor overlay, so clamping on drag keeps them inside the editor)
      const offset = (ns.length % 6) * 26
      return [
        ...ns,
        {
          id: uid(),
          text: '',
          x: 40 + offset,
          y: 28 + offset,
          w: NOTE_W,
          h: NOTE_H,
          color: COLORS[ns.length % COLORS.length],
          collapsed: false,
        },
      ]
    })
  }, [docPath])

  const update = useCallback((id: string, patch: Partial<StickyNote>) => {
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)))
  }, [])

  const remove = useCallback((id: string) => {
    setNotes((ns) => ns.filter((n) => n.id !== id))
  }, [])

  // bring a note to the front by moving it to the end of the array (last = top z-order)
  const bringToFront = useCallback((id: string) => {
    setNotes((ns) => {
      const i = ns.findIndex((n) => n.id === id)
      if (i < 0 || i === ns.length - 1) return ns
      const copy = ns.slice()
      const [n] = copy.splice(i, 1)
      copy.push(n)
      return copy
    })
  }, [])

  return { notes, visible, addNote, toggleVisible, update, remove, bringToFront }
}

// An overlay pinned to the editor area; notes are positioned/clamped within it so they
// can never float outside the editor (e.g. over the sidebar or topbar).
export function StickyLayer({ api }: { api: StickyApi }) {
  const boundsRef = useRef<HTMLDivElement>(null)

  // Rescue any note that sits outside the editor (e.g. created by an older layout with
  // viewport-based coords) by pulling it back into view, so it's always grabbable/deletable.
  useEffect(() => {
    const layer = boundsRef.current
    if (!layer || !api.notes.length) return
    const w = layer.clientWidth
    if (!w) return
    const h = layer.parentElement?.scrollHeight ?? layer.clientHeight
    for (const n of api.notes) {
      const noteW = Math.min(n.w, w) // shrink notes wider than the editor
      const x = Math.min(Math.max(0, n.x), Math.max(0, w - noteW)) // keep the whole note (incl. delete) in view
      const y = Math.min(Math.max(0, n.y), Math.max(0, h - 28))
      if (x !== n.x || y !== n.y || noteW !== n.w) api.update(n.id, { x, y, w: noteW })
    }
    // run when the set of notes changes (mount, doc switch, add) — not on every drag tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.notes.length])

  return (
    <div className="sticky-layer" ref={boundsRef}>
      {api.visible &&
        api.notes.map((n, i) => (
          <NoteCard
            key={n.id}
            note={n}
            front={i === api.notes.length - 1}
            boundsRef={boundsRef}
            onUpdate={api.update}
            onRemove={api.remove}
            onFocus={api.bringToFront}
          />
        ))}
    </div>
  )
}

function NoteCard({
  note,
  front,
  boundsRef,
  onUpdate,
  onRemove,
  onFocus,
}: {
  note: StickyNote
  front: boolean
  boundsRef: React.RefObject<HTMLDivElement>
  onUpdate: (id: string, patch: Partial<StickyNote>) => void
  onRemove: (id: string) => void
  onFocus: (id: string) => void
}) {
  const [palette, setPalette] = useState(false)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const resize = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null)

  // drag via the header — coords are relative to the editor overlay, clamped to it
  const onHeaderDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    onFocus(note.id)
    const rect = boundsRef.current?.getBoundingClientRect()
    if (!rect) return
    drag.current = { dx: e.clientX - rect.left - note.x, dy: e.clientY - rect.top - note.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onHeaderMove = (e: React.PointerEvent) => {
    const layer = boundsRef.current
    if (!drag.current || !layer) return
    const scroller = layer.parentElement // .doc-scroll
    const rect = layer.getBoundingClientRect() // rect.top tracks the scroll origin
    // coords are in the scroll content space, so notes scroll with the page;
    // clamp X to the editor width and Y to the full document height
    const maxX = Math.max(0, layer.clientWidth - note.w)
    const maxY = Math.max(0, (scroller?.scrollHeight ?? layer.clientHeight) - 28)
    const x = Math.min(Math.max(0, e.clientX - rect.left - drag.current.dx), maxX)
    const y = Math.min(Math.max(0, e.clientY - rect.top - drag.current.dy), maxY)
    onUpdate(note.id, { x, y })
  }
  const endDrag = (e: React.PointerEvent) => {
    drag.current = null
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {}
  }

  // resize via the corner handle — capped so the note can't grow past the editor edges
  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    onFocus(note.id)
    resize.current = { sx: e.clientX, sy: e.clientY, sw: note.w, sh: note.h }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: React.PointerEvent) => {
    const layer = boundsRef.current
    if (!resize.current || !layer) return
    const scroller = layer.parentElement // .doc-scroll
    const maxW = Math.max(160, layer.clientWidth - note.x)
    const maxH = Math.max(90, (scroller?.scrollHeight ?? layer.clientHeight) - note.y)
    const w = Math.min(maxW, Math.max(160, resize.current.sw + (e.clientX - resize.current.sx)))
    const h = Math.min(maxH, Math.max(90, resize.current.sh + (e.clientY - resize.current.sy)))
    onUpdate(note.id, { w, h })
  }
  const endResize = (e: React.PointerEvent) => {
    resize.current = null
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {}
  }

  return (
    <div
      className={`sticky-note ${note.collapsed ? 'collapsed' : ''}`}
      style={{
        left: note.x,
        top: note.y,
        width: note.w,
        height: note.collapsed ? undefined : note.h,
        background: note.color,
        zIndex: 20 + (front ? 5 : 0),
      }}
      onPointerDown={() => onFocus(note.id)}
    >
      <div
        className="sticky-head"
        onPointerDown={onHeaderDown}
        onPointerMove={onHeaderMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <GripVertical size={14} className="sticky-grip" />
        <div className="sticky-head-actions">
          <button
            className="sticky-btn"
            title="Color"
            onClick={() => setPalette((p) => !p)}
            style={{ background: note.color, border: '1px solid rgba(0,0,0,.25)' }}
          />
          <button
            className="sticky-btn"
            title={note.collapsed ? 'Expand' : 'Collapse'}
            onClick={() => onUpdate(note.id, { collapsed: !note.collapsed })}
          >
            {note.collapsed ? <Plus size={13} /> : <Minus size={13} />}
          </button>
          <button className="sticky-btn" title="Delete note" onClick={() => onRemove(note.id)}>
            <Trash2 size={13} />
          </button>
        </div>
        {palette && (
          <div className="sticky-palette" onPointerDown={(e) => e.stopPropagation()}>
            {COLORS.map((c) => (
              <button
                key={c}
                className={`sticky-swatch ${c === note.color ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  onUpdate(note.id, { color: c })
                  setPalette(false)
                }}
              >
                {c === note.color && <X size={10} style={{ opacity: 0 }} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {!note.collapsed && (
        <>
          <textarea
            className="sticky-text"
            value={note.text}
            placeholder="Write a note…"
            onChange={(e) => onUpdate(note.id, { text: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
          />
          <div
            className="sticky-resize"
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        </>
      )}
    </div>
  )
}
