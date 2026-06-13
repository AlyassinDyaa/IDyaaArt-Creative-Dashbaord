import { useEffect, useState } from 'react'
import { AlertTriangle, Cloud, Database, HardDrive, KeyRound, Lock, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import { api } from '../lib/api'
import type { AuthMode, SyncMode } from '../lib/types'

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — balanced (recommended)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest' },
]

type Tab = 'claude' | 'storage' | 'security'

function fmtSize(bytes: number) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 2 : 1) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0) + ' MB'
  return (bytes / 1024).toFixed(0) + ' KB'
}

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
  const [tab, setTab] = useState<Tab>('claude')
  const [mode, setMode] = useState<AuthMode>(authMode)
  const [token, setToken] = useState('')
  const [apiKey, setApiKey] = useState('')
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
      const r = await api.saveSettings({ authMode: mode, oauthToken: token, apiKey, model: sel })
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

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'claude', label: 'Claude', icon: <Sparkles size={14} /> },
    { id: 'storage', label: 'Storage', icon: <Database size={14} /> },
    { id: 'security', label: 'Security', icon: <Lock size={14} /> },
  ]

  return (
    <Modal
      title="Settings"
      subtitle="Connect Claude, manage your storage, and lock the app."
      onClose={onClose}
      footer={
        tab === 'claude' ? (
          <>
            <button className="btn" onClick={onClose}>Close</button>
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <button className="btn" onClick={onClose}>Close</button>
        )
      }
    >
      <div className="settings-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`settings-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'claude' && (
        <>
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
                  <li>Install the CLI: <code>npm i -g @anthropic-ai/claude-code</code></li>
                  <li>Run <code>claude setup-token</code> and sign in with your Max account</li>
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
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <ClaudeUsage />
        </>
      )}

      {tab === 'storage' && <StorageTab hasMongo={hasMongo} />}

      {tab === 'security' && (
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={13} /> Project lock {lockCfg.configured && <span style={{ color: 'var(--good)' }}>· enabled</span>}
          </label>
          <input placeholder="Admin name (optional)" value={lUser} onChange={(e) => setLUser(e.target.value)} />
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
            Locks IDyaaArt behind a passcode. Stored hashed locally and in the cloud. This is an access lock, not file encryption.
          </p>
        </div>
      )}
    </Modal>
  )
}

// ---- Claude usage gauge (mimics Claude's own usage display) ----
function fmtTokens(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}
function ClaudeUsage() {
  const [u, setU] = useState<{ tokens: number; requests: number; resetsAt: number; budget: number } | null>(null)
  useEffect(() => { api.usage().then(setU).catch(() => {}) }, [])
  if (!u || !u.budget) return null
  const pct = Math.min(100, (u.tokens / u.budget) * 100)
  const level = pct > 90 ? 'crit' : pct > 70 ? 'warn' : 'ok'
  const reset = u.resetsAt ? new Date(u.resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null
  return (
    <div className="field">
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={13} /> Usage this week</label>
      <div className="storage-row" style={{ marginTop: 0 }}>
        <div className="storage-head">
          <span>{fmtTokens(u.tokens)} tokens</span>
          <span className="storage-figures">{pct.toFixed(0)}% <span className="storage-of">of {fmtTokens(u.budget)}</span></span>
        </div>
        <div className="storage-track"><div className={`storage-fill ${level}`} style={{ width: `${Math.max(2, pct)}%` }} /></div>
        <div className="storage-note">{u.requests} request{u.requests === 1 ? '' : 's'}{reset ? ` · resets ${reset}` : ''}</div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '8px 0 0' }}>
        Tracks the tokens this app has used. Anthropic doesn’t expose your plan’s exact limit, so this is an in-app estimate against a {fmtTokens(u.budget)}/week budget.
      </p>
    </div>
  )
}

// ---- Storage management tab ----
type StoreInfo = {
  connected: boolean
  provider?: string
  limit?: number
  used?: number
  objects?: number
  r2?: { used: number; objects: number; limit: number; error?: string }
}

function Meter({ label, used, limit, sub }: { label: string; used: number; limit: number; sub: string }) {
  const pct = Math.min(100, (used / limit) * 100)
  const level = pct > 90 ? 'crit' : pct > 70 ? 'warn' : 'ok'
  return (
    <div className="storage-row" style={{ marginTop: 0 }}>
      <div className="storage-head">
        <span>{label}</span>
        <span className="storage-figures">{fmtSize(used)} <span className="storage-of">of {fmtSize(limit)}</span></span>
      </div>
      <div className="storage-track"><div className={`storage-fill ${level}`} style={{ width: `${Math.max(2, pct)}%` }} /></div>
      <div className="storage-note">{sub}</div>
    </div>
  )
}

function StorageTab({ hasMongo }: { hasMongo: boolean }) {
  const [info, setInfo] = useState<StoreInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [armed, setArmed] = useState<'r2' | 'd1' | null>(null) // double-confirm, per store

  const load = () => api.storage().then(setInfo).catch(() => setInfo({ connected: false }))
  useEffect(() => { load() }, [])

  const reclaim = async (target: 'r2' | 'd1') => {
    setBusy(true); setMsg('')
    try {
      const r = await api.storageReclaim(target)
      setMsg(
        target === 'r2'
          ? `✓ R2: removed ${r.orphansDeleted} unused file(s) — freed ${fmtSize(r.bytesFreed)}.`
          : `✓ D1: emptied ${r.tombstonesPurged} trashed item(s).`
      )
      await load()
    } catch (e: any) { setMsg('Error: ' + e.message) } finally { setBusy(false) }
  }
  const erase = async (target: 'r2' | 'd1') => {
    setBusy(true); setMsg('')
    try {
      const r = await api.storageWipe(target)
      setMsg(
        target === 'r2'
          ? `✓ Erased ${r.filesDeleted} file(s) from R2. Switched to Offline — your local files are untouched.`
          : `✓ Erased ${r.nodesDeleted} document(s) & folder(s) from D1. Switched to Offline — your local files are untouched.`
      )
      setArmed(null)
      await load()
    } catch (e: any) { setMsg('Error: ' + e.message) } finally { setBusy(false) }
  }

  if (!hasMongo) {
    return <div className="hint-box">Cloud storage isn't configured on this device (no Cloudflare D1/R2 credentials).</div>
  }

  return (
    <div>
      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <HardDrive size={13} /> Cloud storage — reclaim each database
        </label>
        {!info ? (
          <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {info.connected && info.limit && (
              <div>
                <Meter label={`Documents · ${info.provider || 'Database'}`} used={info.used || 0} limit={info.limit}
                  sub={`${info.objects ?? 0} items · ${info.provider || 'database'}`} />
                <button className="btn reclaim-btn" onClick={() => reclaim('d1')} disabled={busy}>
                  <RefreshCw size={13} /> Empty trash
                </button>
              </div>
            )}
            {info.r2 && !info.r2.error && info.r2.limit && (
              <div>
                <Meter label="Images & files · Cloudflare R2" used={info.r2.used} limit={info.r2.limit}
                  sub={`${info.r2.objects} file${info.r2.objects === 1 ? '' : 's'} · Cloudflare R2`} />
                <button className="btn reclaim-btn" onClick={() => reclaim('r2')} disabled={busy}>
                  <RefreshCw size={13} /> Remove unused files
                </button>
              </div>
            )}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '12px 0 0' }}>
          “Empty trash” purges deleted items from the database. “Remove unused files” deletes R2 files no document references. Your documents and visible files are always kept.
        </p>
      </div>

      <div className="danger-zone">
        <div className="danger-title"><AlertTriangle size={14} /> Danger zone</div>
        <p style={{ fontSize: 11.5, color: 'var(--text-dim)', margin: '0 0 10px' }}>
          Permanently erase a store. This switches you to <strong>Offline</strong> so your <strong>local files stay safe</strong> — but the erased cloud copy is gone for good.
        </p>
        {armed ? (
          <div className="danger-confirm">
            <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: '0 0 8px', fontWeight: 600 }}>
              Are you sure? This permanently erases{' '}
              {armed === 'r2'
                ? `${info?.r2?.objects ?? 0} file(s) from Cloudflare R2`
                : `${info?.objects ?? 0} document(s) & folder(s) from Cloudflare D1`}.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setArmed(null)} disabled={busy}>Cancel</button>
              <button className="btn danger" onClick={() => erase(armed)} disabled={busy}>
                {busy ? 'Erasing…' : 'Yes, permanently erase'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn danger" onClick={() => { setArmed('d1'); setMsg('') }} disabled={busy}>
              <Trash2 size={14} /> Erase documents (D1)…
            </button>
            <button className="btn danger" onClick={() => { setArmed('r2'); setMsg('') }} disabled={busy}>
              <Trash2 size={14} /> Erase files (R2)…
            </button>
          </div>
        )}
      </div>

      {msg && <p style={{ fontSize: 12, color: msg.startsWith('Error') ? 'var(--danger)' : 'var(--text-dim)', margin: '12px 0 0' }}>{msg}</p>}
    </div>
  )
}
