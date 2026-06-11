import { Cloud, CloudOff, Loader2, RefreshCw } from 'lucide-react'
import type { SyncMode } from '../lib/types'

export function SyncPill({
  mode,
  online,
  busy,
  onToggle,
  onSyncNow,
}: {
  mode: SyncMode
  online: boolean
  busy: boolean
  onToggle: () => void
  onSyncNow: () => void
}) {
  const isOnline = mode === 'online' && online
  return (
    <div className={`sync-pill ${isOnline ? 'online' : 'offline'}`}>
      <button className="sync-toggle" onClick={onToggle} title={isOnline ? 'Go offline' : 'Go online & sync'}>
        {busy ? (
          <Loader2 size={14} className="spin" />
        ) : isOnline ? (
          <Cloud size={14} />
        ) : (
          <CloudOff size={14} />
        )}
        {busy ? 'Syncing…' : isOnline ? 'Online' : 'Offline'}
      </button>
      {isOnline && !busy && (
        <button className="sync-now" onClick={onSyncNow} title="Sync now">
          <RefreshCw size={13} />
        </button>
      )}
    </div>
  )
}
