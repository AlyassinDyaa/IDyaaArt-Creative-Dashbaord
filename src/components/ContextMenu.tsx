import { useEffect } from 'react'

export interface MenuItem {
  label?: string
  icon?: React.ReactNode
  onClick?: () => void
  danger?: boolean
  sep?: boolean
  custom?: React.ReactNode // render custom content (e.g. a color swatch row) instead of a button
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [onClose])
  // keep on-screen
  const left = Math.min(x, window.innerWidth - 252)
  const top = Math.max(8, Math.min(y, window.innerHeight - items.length * 34 - 130))
  return (
    <div className="ctx-menu" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => (
        <div key={i}>
          {it.sep && <div className="ctx-sep" />}
          {it.custom ? (
            it.custom
          ) : (
            <button
              className={it.danger ? 'danger' : ''}
              onClick={() => {
                it.onClick?.()
                onClose()
              }}
            >
              {it.icon}
              {it.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
