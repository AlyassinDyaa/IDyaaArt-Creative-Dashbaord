import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Loader2, Lock, UserPlus } from 'lucide-react'
import { api } from '../lib/api'

export function LockScreen({
  configured,
  username,
  onUnlock,
}: {
  configured: boolean
  username: string
  onUnlock: () => void
}) {
  const setup = !configured // first run → create the admin login
  const [user, setUser] = useState(username || '')
  const [passcode, setPasscode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const submit = async () => {
    if (busy) return
    setError('')
    if (setup) {
      if (passcode.length < 4) return setError('Passcode must be at least 4 characters')
      if (passcode !== confirm) return setError('Passcodes do not match')
      setBusy(true)
      try {
        await api.authSet(user, passcode)
        onUnlock()
      } catch (e: any) {
        setError(e.message || 'Could not create login')
      } finally {
        setBusy(false)
      }
    } else {
      if (!passcode) return
      setBusy(true)
      try {
        await api.authUnlock(passcode)
        onUnlock()
      } catch (e: any) {
        setError(e.message || 'Incorrect passcode')
        setPasscode('')
        ref.current?.focus()
      } finally {
        setBusy(false)
      }
    }
  }

  const onEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && submit()

  return (
    <div className="lock-screen">
      <div className="lock-box">
        <div className="lock-logo">{setup ? <UserPlus size={26} /> : <Lock size={26} />}</div>
        <h1>{setup ? 'Create your admin login' : <><span className="brand-name">IDyaaArt</span> is locked</>}</h1>
        <p>
          {setup
            ? 'Set up an admin passcode to protect your workspace. You’ll need it every time you open IDyaaArt.'
            : username
            ? `Signed in as ${username} — enter your passcode`
            : 'Enter your passcode to continue'}
        </p>

        {setup && (
          <input
            className="lock-name"
            placeholder="Admin name (optional)"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            onKeyDown={onEnter}
          />
        )}
        <div className="lock-input-wrap">
          <input
            ref={ref}
            type={reveal ? 'text' : 'password'}
            className="lock-input"
            placeholder={setup ? 'Choose a passcode' : 'Passcode'}
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={onEnter}
          />
          <button className="lock-eye" type="button" onClick={() => setReveal((r) => !r)} title={reveal ? 'Hide' : 'Show passcode'}>
            {reveal ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        {setup && (
          <input
            type={reveal ? 'text' : 'password'}
            className="lock-input"
            placeholder="Confirm passcode"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={onEnter}
            style={{ marginTop: 10 }}
          />
        )}
        {error && <div className="lock-error">{error}</div>}
        <button className="btn primary lock-btn" onClick={submit} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : setup ? 'Create & enter' : 'Unlock'}
        </button>
      </div>
    </div>
  )
}
