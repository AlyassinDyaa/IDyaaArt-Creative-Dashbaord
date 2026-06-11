import { useEffect, useState } from 'react'
import { Cloud, KeyRound, Lock, Sparkles } from 'lucide-react'
import { Modal } from './Modal'
import { api } from '../lib/api'
import type { AuthMode, SyncMode } from '../lib/types'

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — balanced (recommended)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest' },
]

export function Settings({
  authMode,
  connected,
  model,
  hasMongo,
  onSaved,
  onClose,
}: {
  authMode: AuthMode
  connected: boolean
  model: string
  hasMongo: boolean
  onSaved: (s: {
    authMode: AuthMode
    connected: boolean
    model: string
    mode: SyncMode
    online: boolean
    hasMongo: boolean
  }) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<AuthMode>(authMode)
  const [token, setToken] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [mongoUri, setMongoUri] = useState('')
  const [sel, setSel] = useState(model)
  const [busy, setBusy] = useState(false)

  // ---- project lock ----
  const [lockCfg, setLockCfg] = useState({ configured: false, username: '' })
  const [lUser, setLUser] = useState('')
  const [lPass, setLPass] = useState('')
  const [lCurrent, setLCurrent] = useState('')
  const [lockMsg, setLockMsg] = useState('')
  const [lockBusy, setLockBusy] = useState(false)
  useEffect(() => {
    api.authStatus().then((s) => { setLockCfg(s); setLUser(s.username) }).catch(() => {})
  }, [])
  const saveLock = async () => {
    setLockBusy(true)
    setLockMsg('')
    try {
      await api.authSet(lUser, lPass, lCurrent || undefined)
      setLPass('')
      setLCurrent('')
      const s = await api.authStatus()
      setLockCfg(s)
      setLockMsg('✓ Passcode saved — locks on next reload.')
    } catch (e: any) {
      setLockMsg(e.message)
    } finally {
      setLockBusy(false)
    }
  }
  const removeLock = async () => {
    setLockBusy(true)
    setLockMsg('')
    try {
      await api.authRemove(lCurrent)
      setLCurrent('')
      setLPass('')
      setLockCfg({ configured: false, username: '' })
      setLockMsg('✓ Lock removed.')
    } catch (e: any) {
      setLockMsg(e.message)
    } finally {
      setLockBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      const r = await api.saveSettings({ authMode: mode, oauthToken: token, apiKey, mongoUri, model: sel })
      onSaved({
        authMode: r.authMode,
        connected: r.connected,
        model: r.model,
        mode: r.mode,
        online: r.online,
        hasMongo: r.hasMongo,
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Settings"
      subtitle="Connect Claude to power AI writing help, document Q&A and search."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>How should Claude be powered?</label>
        <div className="seg">
          <button className={mode === 'subscription' ? 'on' : ''} onClick={() => setMode('subscription')}>
            <Sparkles size={14} /> Claude Max / Pro
          </button>
          <button className={mode === 'apikey' ? 'on' : ''} onClick={() => setMode('apikey')}>
            <KeyRound size={14} /> API key
          </button>
        </div>
      </div>

      {mode === 'subscription' ? (
        <div className="field">
          <label>
            Subscription token {connected && authMode === 'subscription' && <span style={{ color: 'var(--good)' }}>· connected</span>}
          </label>
          <input
            type="password"
            placeholder={connected && authMode === 'subscription' ? '•••••••••• (leave blank to keep)' : 'paste your CLAUDE_CODE_OAUTH_TOKEN'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="hint-box">
            Uses your existing Claude subscription — no per-token API charges. Generate the token once on your PC:
            <ol>
              <li>
                Install the CLI: <code>npm i -g @anthropic-ai/claude-code</code>
              </li>
              <li>
                Run <code>claude setup-token</code> and sign in with your Max account
              </li>
              <li>Copy the token it prints and paste it above</li>
            </ol>
          </div>
        </div>
      ) : (
        <div className="field">
          <label>
            Anthropic API key {connected && authMode === 'apikey' && <span style={{ color: 'var(--good)' }}>· connected</span>}
          </label>
          <input
            type="password"
            placeholder={connected && authMode === 'apikey' ? '•••••••••• (leave blank to keep)' : 'sk-ant-…'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '6px 0 0' }}>
            Pay-as-you-go, billed per token. Requires credits at console.anthropic.com.
          </p>
        </div>
      )}

      <div className="field">
        <label>Model</label>
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Cloud size={13} /> Cloud sync — MongoDB {hasMongo && <span style={{ color: 'var(--good)' }}>· configured</span>}
        </label>
        <input
          type="password"
          placeholder={hasMongo ? '•••••••••• (leave blank to keep)' : 'mongodb+srv://…'}
          value={mongoUri}
          onChange={(e) => setMongoUri(e.target.value)}
        />
        <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '6px 0 0' }}>
          Paste your MongoDB Atlas connection string, then use the <strong>Online</strong> toggle in the top bar to
          sync this device with the cloud. Stored locally in <code>.entropy/config.json</code>.
        </p>
      </div>

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock size={13} /> Project lock {lockCfg.configured && <span style={{ color: 'var(--good)' }}>· enabled</span>}
        </label>
        <input
          placeholder="Admin name (optional)"
          value={lUser}
          onChange={(e) => setLUser(e.target.value)}
        />
        <input
          type="password"
          placeholder={lockCfg.configured ? 'New passcode (min 4)' : 'Passcode (min 4 characters)'}
          value={lPass}
          onChange={(e) => setLPass(e.target.value)}
          style={{ marginTop: 8 }}
        />
        {lockCfg.configured && (
          <input
            type="password"
            placeholder="Current passcode"
            value={lCurrent}
            onChange={(e) => setLCurrent(e.target.value)}
            style={{ marginTop: 8 }}
          />
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn primary" onClick={saveLock} disabled={lockBusy || !lPass}>
            {lockCfg.configured ? 'Update passcode' : 'Set passcode'}
          </button>
          {lockCfg.configured && (
            <button className="btn danger" onClick={removeLock} disabled={lockBusy || !lCurrent}>
              Remove lock
            </button>
          )}
        </div>
        {lockMsg && <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '8px 0 0' }}>{lockMsg}</p>}
        <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '6px 0 0' }}>
          Locks IDyaaArt behind a passcode. Stored hashed locally (offline) and in MongoDB when online. This is an
          access lock, not file encryption.
        </p>
      </div>
    </Modal>
  )
}
