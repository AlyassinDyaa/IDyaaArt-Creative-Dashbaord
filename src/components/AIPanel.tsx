import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Search, Send, Sparkles, SquarePen, X } from 'lucide-react'
import { api, fileUrl } from '../lib/api'
import type { ChatMessage, SearchResult } from '../lib/types'
import { NodeIcon } from './nodeIcon'

// The assistant chat is persisted so closing the panel (or reloading) never loses a
// conversation in progress — it only clears when the admin starts a new chat.
const CHAT_KEY = 'entropy-ai-chat'
function loadChat(): ChatMessage[] {
  try {
    const arr = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function AIPanel({
  hasKey,
  contextTitle,
  getContext,
  onOpenResult,
  onOpenSettings,
  onClose,
}: {
  hasKey: boolean
  contextTitle: string | null
  getContext: () => string
  onOpenResult: (path: string) => void
  onOpenSettings: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'chat' | 'search'>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat())
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [useContext, setUseContext] = useState(true)

  // keep the saved chat in sync with what's on screen
  useEffect(() => {
    try {
      if (messages.length) localStorage.setItem(CHAT_KEY, JSON.stringify(messages))
      else localStorage.removeItem(CHAT_KEY)
    } catch {}
  }, [messages])

  const newChat = () => {
    if (busy) return
    if (messages.length && !confirm('Start a new chat? The current conversation will be cleared.')) return
    setMessages([])
    setInput('')
  }

  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)

  const scroll = () => setTimeout(() => bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight), 30)

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    if (!hasKey) {
      onOpenSettings()
      return
    }
    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    scroll()
    try {
      const ctx = useContext && contextTitle ? getContext() : ''
      let acc = ''
      await api.chatStream(next, ctx, (chunk) => {
        acc += chunk
        setMessages([...next, { role: 'assistant', content: acc }])
        scroll()
      })
      if (!acc) setMessages([...next, { role: 'assistant', content: '' }])
    } catch (e: any) {
      setMessages([...next, { role: 'assistant', content: '⚠️ ' + e.message }])
    } finally {
      setBusy(false)
      scroll()
    }
  }

  const runSearch = async () => {
    if (!query.trim() || busy) return
    setBusy(true)
    setAnswer('')
    setResults([])
    try {
      const r = await api.search(query.trim())
      setAnswer(r.answer)
      setResults(r.results)
    } catch (e: any) {
      setAnswer('⚠️ ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <span className="logo">
          <Sparkles size={14} color="white" />
        </span>
        <h3>Claude</h3>
        <span style={{ flex: 1 }} />
        {!hasKey && (
          <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onOpenSettings}>
            Connect
          </button>
        )}
        {tab === 'chat' && messages.length > 0 && (
          <button className="panel-close" onClick={newChat} title="New chat" disabled={busy}>
            <SquarePen size={16} />
          </button>
        )}
        <button className="panel-close" onClick={onClose} title="Close">
          <X size={17} />
        </button>
      </div>

      <div className="ai-tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
          Assistant
        </button>
        <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
          Search docs
        </button>
      </div>

      {tab === 'chat' ? (
        <>
          <div className="ai-body" ref={bodyRef}>
            {messages.length === 0 && (
              <div className="ai-hint">
                Ask Claude to brainstorm plot, rewrite a passage, name a character, or summarize your draft.
                {contextTitle && <><br /><br />It can see the open document.</>}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="msg assistant thinking">Thinking…</div>
            )}
          </div>
          <div className="ai-foot">
            {contextTitle && (
              <label className="ctx-chip" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={useContext} onChange={(e) => setUseContext(e.target.checked)} />
                <FileText size={12} /> Use “{contextTitle}” as context
              </label>
            )}
            <div className="ai-input-row">
              <textarea
                className="ai-input"
                rows={1}
                placeholder="Ask Claude…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
              />
              <button className="ai-send" onClick={send} disabled={busy}>
                {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="ai-body" ref={bodyRef}>
            {answer && <div className="msg assistant">{answer}</div>}
            {results.map((r) => (
              <div key={r.path} className="search-result" onClick={() => onOpenResult(r.path)}>
                <div className="sr-head">
                  <span className="sr-icon">
                    {r.type === 'image' ? (
                      <img className="sr-thumb" src={fileUrl(r.path)} alt="" loading="lazy" />
                    ) : (
                      <NodeIcon type={r.type} size={15} />
                    )}
                  </span>
                  <h4>{r.title}</h4>
                </div>
                <p>{r.snippet}</p>
              </div>
            ))}
            {!answer && results.length === 0 && (
              <div className="ai-hint">Search across every document in your workspace. Claude summarizes and points you to the right files.</div>
            )}
          </div>
          <div className="ai-foot">
            <div className="ai-input-row">
              <textarea
                className="ai-input"
                rows={1}
                placeholder="Search your documents…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    runSearch()
                  }
                }}
              />
              <button className="ai-send" onClick={runSearch} disabled={busy}>
                {busy ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
