import React, { useEffect, useRef, useState } from 'react'
import { FOLDER_ICONS } from './folderIcons'

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  footer,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
  onClose: () => void
  footer?: React.ReactNode
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Single-text-field prompt modal. */
export function PromptModal({
  title,
  subtitle,
  label,
  initial = '',
  confirmText = 'Create',
  colorPalette,
  iconNames,
  onConfirm,
  onClose,
}: {
  title: string
  subtitle?: string
  label: string
  initial?: string
  confirmText?: string
  colorPalette?: string[]
  iconNames?: string[]
  onConfirm: (value: string, color?: string | null, icon?: string | null) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const [color, setColor] = useState<string | null>(null)
  const [icon, setIcon] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const submit = () => {
    if (value.trim()) onConfirm(value.trim(), color, icon)
  }
  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            {confirmText}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{label}</label>
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      {colorPalette && (
        <div className="field">
          <label>Color (optional)</label>
          <div className="ctx-colors" style={{ padding: 0 }}>
            {colorPalette.map((c) => (
              <button
                key={c}
                type="button"
                className={`ctx-swatch ${color === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor((cur) => (cur === c ? null : c))}
                title="Color"
              />
            ))}
          </div>
        </div>
      )}
      {iconNames && (
        <div className="field">
          <label>Icon (optional)</label>
          <div className="ctx-icons" style={{ padding: 0, width: '100%' }}>
            {iconNames.map((n) => {
              const Glyph = FOLDER_ICONS[n]
              return (
                <button
                  key={n}
                  type="button"
                  className={`ctx-iconbtn ${icon === n ? 'on' : ''}`}
                  style={color ? { color: icon === n ? undefined : color } : undefined}
                  onClick={() => setIcon((cur) => (cur === n ? null : n))}
                  title={n}
                >
                  <Glyph size={16} />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}
