import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import {
  BookMarked, Check, Cloud, Dot, FilePlus2, FolderPlus, Loader2, PanelLeft, Pencil, Save, Sparkles, Trash2, Upload, X,
} from 'lucide-react'
import { api, fileUrl } from './lib/api'
import { FOLDER_COLORS } from './lib/types'
import type { AuthMode, SyncMode, TreeNode } from './lib/types'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './components/Dashboard'
import { FolderView } from './components/FolderView'
import { Editor, type SaveState } from './components/Editor'
import { Viewer } from './components/Viewer'
import { AIPanel } from './components/AIPanel'
import { Settings } from './components/Settings'
import { PromptModal } from './components/Modal'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { SyncPill } from './components/SyncPill'
import { FOLDER_ICONS, FOLDER_ICON_NAMES } from './components/folderIcons'
import { ImagePicker } from './components/ImagePicker'
import { PagesPanel } from './components/PagesPanel'
import { LockScreen } from './components/LockScreen'
import { CropModal } from './components/CropModal'
import { FolderPickerModal } from './components/FolderPickerModal'
import type { CropPayload } from './components/ResizableImage'

type View = 'dashboard' | 'doc' | 'viewer' | 'folder'
type Modal =
  | { type: 'project' }
  | { type: 'folder'; parent: string }
  | { type: 'rename'; node: TreeNode }
  | null

function parentDir(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}
function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) {
      const f = findNode(n.children, path)
      if (f) return f
    }
  }
  return null
}

export default function App() {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [view, setView] = useState<View>('dashboard')
  const [active, setActive] = useState<TreeNode | null>(null)
  const [docHtml, setDocHtml] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024)
  const [aiOpen, setAiOpen] = useState(() => window.innerWidth >= 1100)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [editorInst, setEditorInst] = useState<TiptapEditor | null>(null)
  // responsive breakpoints — below these, panels become overlay drawers
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1024) // right panels overlay
  const [mobile, setMobile] = useState(() => window.innerWidth < 640) // sidebar overlays too
  useEffect(() => {
    const onResize = () => {
      setNarrow(window.innerWidth < 1024)
      setMobile(window.innerWidth < 640)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // toggles that keep only one drawer open on small screens (no overlaps)
  const toggleSidebar = () =>
    setSidebarOpen((s) => {
      const n = !s
      if (n && narrow) { setAiOpen(false); setPagesOpen(false) } // sidebar overlays on narrow → one drawer at a time
      return n
    })
  const toggleAi = () =>
    setAiOpen((s) => {
      const n = !s
      if (n && narrow) { setPagesOpen(false); setSidebarOpen(false) }
      return n
    })
  const togglePages = () =>
    setPagesOpen((s) => {
      const n = !s
      if (n && narrow) { setAiOpen(false); setSidebarOpen(false) }
      return n
    })
  const closeDrawers = () => {
    setAiOpen(false)
    setPagesOpen(false)
    if (narrow) setSidebarOpen(false)
  }
  // After the sidebar finishes animating, nudge the editor to recompute page-break /
  // toolbar positions for the new width (no window resize fires from a flex reflow).
  useEffect(() => {
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 260)
    return () => clearTimeout(id)
  }, [sidebarOpen])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)

  const [ctx, setCtx] = useState<{ x: number; y: number; node: TreeNode; modalRename?: boolean } | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<{
    authMode: AuthMode
    connected: boolean
    model: string
    mode: SyncMode
    online: boolean
    hasMongo: boolean
  }>({
    authMode: 'subscription',
    connected: false,
    model: 'claude-sonnet-4-6',
    mode: 'offline',
    online: false,
    hasMongo: false,
  })
  const [syncBusy, setSyncBusy] = useState(false)
  const [upload, setUpload] = useState<{ label: string; pct: number } | null>(null)
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [cropTarget, setCropTarget] = useState<CropPayload | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [lock, setLock] = useState<{ configured: boolean; username: string } | null>(null)
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('entropy-unlocked') === '1')
  useEffect(() => {
    api.authStatus().then(setLock).catch(() => setLock({ configured: false, username: '' }))
  }, [])
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)

  const editorRef = useRef<TiptapEditor | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadDir = useRef<string>('')
  const dirty = useRef(false)
  const docHtmlRef = useRef('') // latest editor HTML snapshot for the active doc
  const activeRef = useRef<TreeNode | null>(null)
  const idleTimer = useRef<number | undefined>(undefined)
  // keep activeRef in sync as a safety net (also set synchronously on every switch)
  useEffect(() => { activeRef.current = active }, [active])

  const targetDir = active
    ? active.type === 'folder'
      ? active.path
      : parentDir(active.path)
    : ''

  const flash = (msg: string, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 2600)
  }

  const refresh = useCallback(async () => {
    try {
      setTree(await api.tree())
    } catch (e: any) {
      flash(e.message, true)
    }
  }, [])

  useEffect(() => {
    refresh()
    api
      .getSettings()
      .then((s) =>
        setSettings({
          authMode: s.authMode,
          connected: s.connected,
          model: s.model,
          mode: s.mode,
          online: s.online,
          hasMongo: s.hasMongo,
        })
      )
      .catch(() => {})
  }, [refresh])

  // ---- online/offline sync ----
  const summaryMsg = (s?: { pushed: number; pulled: number; deletedLocal: number; deletedRemote: number }) =>
    !s
      ? 'Synced'
      : `Synced · ↑${s.pushed} ↓${s.pulled}` +
        (s.deletedLocal || s.deletedRemote ? ` · removed ${s.deletedLocal + s.deletedRemote}` : '')

  const toggleMode = async () => {
    const target: SyncMode = settings.online ? 'offline' : 'online'
    if (target === 'online' && !settings.hasMongo) {
      flash('Add your MongoDB connection string in Settings first', true)
      setShowSettings(true)
      return
    }
    setSyncBusy(true)
    try {
      await saveNow() // flush current doc before reconciling
      const r = await api.setMode(target)
      setSettings((p) => ({ ...p, mode: r.mode, online: r.online }))
      if (r.mode === 'online') {
        await refresh()
        flash(summaryMsg(r.summary))
      } else {
        flash('Offline — changes save to this device')
      }
    } catch (e: any) {
      flash(e.message, true)
    } finally {
      setSyncBusy(false)
    }
  }

  const doSyncNow = async () => {
    setSyncBusy(true)
    try {
      await saveNow()
      const { summary } = await api.syncNow()
      await refresh()
      flash(summaryMsg(summary))
    } catch (e: any) {
      flash(e.message, true)
    } finally {
      setSyncBusy(false)
    }
  }

  // Save the open document if it has unsaved changes. Reads the live editor content
  // and pairs it with THAT document's path, so a save can never land in another file.
  // Used by the Save button, Ctrl/Cmd+S, the idle debounce, the periodic timer, and tab-hide.
  const saveNow = useCallback(async () => {
    const node = activeRef.current
    if (!dirty.current || !node || node.type !== 'doc') return
    const ed = editorRef.current
    // Don't save (and trigger a re-render) while a table cell-selection is active —
    // it would risk disturbing an in-progress merge. It'll save right after.
    if (ed && (ed.state.selection as any).$anchorCell) return
    const html = ed && !ed.isDestroyed ? ed.getHTML() : docHtmlRef.current
    dirty.current = false // claim the edits now so concurrent typing re-flags cleanly
    setSaveState('saving')
    try {
      await api.saveDoc(node.path, html)
      setSaveState((s) => (dirty.current ? s : 'saved'))
    } catch (e: any) {
      dirty.current = true
      setSaveState('unsaved')
      flash(e.message, true)
    }
  }, [])

  // gentle idle autosave (~2.5s after you stop typing), scheduled on each edit
  const scheduleIdleSave = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => saveNow(), 2500)
  }, [saveNow])

  // periodic safety autosave every 90s
  useEffect(() => {
    const id = setInterval(saveNow, 90_000)
    return () => clearInterval(id)
  }, [saveNow])

  // Ctrl/Cmd+S — explicit save
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveNow()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [saveNow])

  // save when the tab is hidden / app is backgrounded (e.g. closing on iPad)
  useEffect(() => {
    const h = () => document.visibilityState === 'hidden' && saveNow()
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [saveNow])

  const openDoc = async (path: string) => {
    await saveNow() // flush the currently-open doc before switching away from it
    try {
      const d = await api.loadDoc(path)
      const node: TreeNode = { name: d.title + '.html', path: d.path, type: 'doc' }
      activeRef.current = node // sync immediately so any save targets the right file
      docHtmlRef.current = d.html
      dirty.current = false
      setActive(node)
      setDocTitle(d.title)
      setDocHtml(d.html)
      setSaveState('idle')
      setView('doc')
    } catch (e: any) {
      flash(e.message, true)
    }
  }

  const openFolder = async (node: TreeNode) => {
    await saveNow()
    activeRef.current = node
    setActive(node)
    setView('folder')
  }

  const openNode = async (node: TreeNode) => {
    if (node.type === 'doc') return openDoc(node.path)
    if (node.type === 'folder') return openFolder(node)
    await saveNow() // flush open doc before leaving the editor
    activeRef.current = node
    setActive(node)
    setView('viewer')
  }

  const goDashboard = async () => {
    await saveNow() // flush before the editor unmounts
    setView('dashboard')
  }

  // open a search result, routing to the right view (doc → editor, image/pdf → viewer)
  const openResult = (path: string) => {
    const node = findNode(tree, path)
    if (node) openNode(node)
    else openDoc(path)
  }

  // X / Esc in the viewer → back to the file's parent folder (or dashboard)
  const closeViewer = () => {
    const parent = active ? parentDir(active.path) : ''
    const pnode = parent ? findNode(tree, parent) : null
    if (pnode) openFolder(pnode)
    else goDashboard()
  }

  // Insert a workspace image by reference (resolves to R2 on the cloud, disk locally)
  // instead of embedding base64 — keeps the document small.
  const insertWorkspaceImage = (path: string) => {
    setShowImagePicker(false)
    editorRef.current?.chain().focus().setImage({ src: fileUrl(path) }).run()
  }

  const toggle = (path: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      n.has(path) ? n.delete(path) : n.add(path)
      return n
    })

  // ---- create / mutate ----
  const createProject = async (name: string, color?: string | null, icon?: string | null) => {
    const { path } = await api.createProject(name)
    if (color) await api.setColor(path, color)
    if (icon) await api.setIcon(path, icon)
    setModal(null)
    await refresh()
    setExpanded((s) => new Set(s).add(path))
    flash('Project created')
  }
  const createFolder = async (parent: string, name: string) => {
    const { path } = await api.createFolder(parent, name)
    setModal(null)
    await refresh()
    setExpanded((s) => new Set(s).add(parent).add(path))
  }
  const createDoc = async () => {
    const dir = uploadDir.current ?? targetDir
    const { path } = await api.newDoc(dir, 'Untitled Document')
    await refresh()
    if (dir) setExpanded((s) => new Set(s).add(dir))
    openDoc(path)
    setRenaming(path)
  }

  const doRename = async (node: TreeNode, name: string) => {
    setRenaming(null)
    if (!name.trim() || name === node.name) return
    try {
      if (activeRef.current?.path === node.path) await saveNow() // save before the path changes
      const { path } = await api.rename(node.path, name)
      await refresh()
      if (active?.path === node.path) {
        if (node.type === 'doc') openDoc(path)
        else setActive({ ...node, path, name })
      }
    } catch (e: any) {
      flash(e.message, true)
    }
  }

  const doDelete = async (node: TreeNode) => {
    if (!confirm(`Delete “${node.name}”${node.type === 'folder' ? ' and everything inside it' : ''}? This cannot be undone.`)) return
    try {
      // If we're deleting the open doc, drop its unsaved state first so no pending
      // autosave resurrects the file after it's gone.
      if (active?.path === node.path || active?.path.startsWith(node.path + '/')) {
        dirty.current = false
        if (idleTimer.current) clearTimeout(idleTimer.current)
        activeRef.current = null
        setActive(null)
        setView('dashboard')
      }
      await api.remove(node.path)
      await refresh()
      flash('Deleted')
    } catch (e: any) {
      flash(e.message, true)
    }
  }

  const setNodeColor = async (path: string, color: string | null) => {
    setCtx(null)
    try {
      await api.setColor(path, color)
      await refresh()
    } catch (e: any) {
      flash(e.message, true)
    }
  }
  const setNodeIcon = async (path: string, icon: string | null) => {
    setCtx(null)
    try {
      await api.setIcon(path, icon)
      await refresh()
    } catch (e: any) {
      flash(e.message, true)
    }
  }

  const doMove = async (src: string, destFolder: string) => {
    if (src === destFolder || destFolder.startsWith(src + '/')) return
    try {
      const movingActive = activeRef.current?.path === src
      if (movingActive) await saveNow() // save to the old path before it moves
      const { path } = await api.move(src, destFolder)
      if (movingActive && activeRef.current) {
        const node = { ...activeRef.current, path }
        activeRef.current = node
        dirty.current = false
        setActive(node)
      }
      await refresh()
      if (destFolder) setExpanded((s) => new Set(s).add(destFolder))
    } catch (e: any) {
      flash(e.message, true)
    }
  }

  // ---- multi-select (bulk move / delete) ----
  const logout = async () => {
    await saveNow()
    sessionStorage.removeItem('entropy-unlocked')
    setUnlocked(false)
  }

  const toggleSelectMode = () => {
    setSelectMode((m) => !m)
    setSelected(new Set())
  }
  const toggleSelect = (path: string) =>
    setSelected((s) => {
      const n = new Set(s)
      n.has(path) ? n.delete(path) : n.add(path)
      return n
    })
  // keep only top-most items (a folder already covers its descendants)
  const topMost = (paths: string[]) => paths.filter((p) => !paths.some((o) => o !== p && p.startsWith(o + '/')))

  const bulkDelete = async () => {
    const items = topMost([...selected])
    if (!items.length) return
    if (!confirm(`Delete ${items.length} item${items.length === 1 ? '' : 's'} and everything inside? This cannot be undone.`)) return
    for (const p of items) {
      try {
        if (active && (active.path === p || active.path.startsWith(p + '/'))) {
          dirty.current = false
          activeRef.current = null
          setActive(null)
          setView('dashboard')
        }
        await api.remove(p)
      } catch (e: any) {
        flash(e.message, true)
      }
    }
    await refresh()
    setSelected(new Set())
    setSelectMode(false)
    flash(`Deleted ${items.length} item${items.length === 1 ? '' : 's'}`)
  }

  const doBulkMove = async (destDir: string) => {
    setBulkMoveOpen(false)
    const items = topMost([...selected])
    let moved = 0
    for (const p of items) {
      if (destDir === p || destDir.startsWith(p + '/') || parentDir(p) === destDir) continue
      try {
        await api.move(p, destDir)
        moved++
      } catch (e: any) {
        flash(e.message, true)
      }
    }
    await refresh()
    if (destDir) setExpanded((s) => new Set(s).add(destDir))
    setSelected(new Set())
    setSelectMode(false)
    flash(`Moved ${moved} item${moved === 1 ? '' : 's'}`)
  }

  const triggerUpload = (dir: string) => {
    uploadDir.current = dir
    uploadRef.current?.click()
  }
  const handleUpload = async (files: FileList) => {
    const label = files.length === 1 ? files[0].name : `${files.length} files`
    setUpload({ label, pct: 0 })
    try {
      await api.upload(uploadDir.current, files, (pct) => setUpload({ label, pct }))
      setUpload({ label, pct: 1 })
      await refresh()
      if (uploadDir.current) setExpanded((s) => new Set(s).add(uploadDir.current))
      flash(`Imported ${files.length} file${files.length === 1 ? '' : 's'}`)
    } catch (e: any) {
      flash(e.message, true)
    } finally {
      setTimeout(() => setUpload(null), 600)
    }
  }

  // ---- context menu ----
  const openCtx = (e: React.MouseEvent, node: TreeNode, modalRename = false) => {
    e.preventDefault()
    e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, node, modalRename })
  }
  const ctxItems = (node: TreeNode, modalRename = false): MenuItem[] => {
    const items: MenuItem[] = []
    if (node.type === 'folder') {
      items.push(
        { label: 'New document', icon: <FilePlus2 size={15} />, onClick: async () => {
          uploadDir.current = node.path
          await createDoc()
        } },
        { label: 'New subfolder', icon: <FolderPlus size={15} />, onClick: () => setModal({ type: 'folder', parent: node.path }) },
        { label: 'Import files here', icon: <Upload size={15} />, onClick: () => triggerUpload(node.path) }
      )
    }
    items.push({
      label: 'Rename',
      icon: <Pencil size={15} />,
      onClick: () => (modalRename ? setModal({ type: 'rename', node }) : setRenaming(node.path)),
      sep: node.type === 'folder',
    })
    if (node.type === 'folder') {
      items.push({
        sep: true,
        custom: (
          <div className="ctx-colors">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                className={`ctx-swatch ${node.color === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setNodeColor(node.path, c)}
                title="Set color"
              />
            ))}
            <button className="ctx-swatch ctx-clear" onClick={() => setNodeColor(node.path, null)} title="No color">
              <X size={12} />
            </button>
          </div>
        ),
      })
      items.push({
        custom: (
          <div className="ctx-icons">
            {FOLDER_ICON_NAMES.map((n) => {
              const Glyph = FOLDER_ICONS[n]
              return (
                <button
                  key={n}
                  className={`ctx-iconbtn ${node.icon === n || (!node.icon && n === 'folder') ? 'on' : ''}`}
                  onClick={() => setNodeIcon(node.path, n === 'folder' ? null : n)}
                  title={n}
                >
                  <Glyph size={16} />
                </button>
              )
            })}
          </div>
        ),
      })
    }
    items.push({ label: 'Delete', icon: <Trash2 size={15} />, onClick: () => doDelete(node), danger: true, sep: true })
    return items
  }

  const crumbs = useMemo(() => {
    if (view === 'dashboard' || !active) return []
    return active.path.split('/')
  }, [view, active])

  // sibling images in the active image's folder, for prev/next navigation in the viewer
  const viewerSiblings = useMemo(() => {
    if (view !== 'viewer' || !active || active.type !== 'image') return [] as TreeNode[]
    const parent = parentDir(active.path)
    const kids = parent ? findNode(tree, parent)?.children : tree
    return (kids || []).filter((n) => n.type === 'image')
  }, [view, active, tree])

  // The app is never shown unless the admin is logged in.
  // First run (no admin yet) → setup screen; otherwise → login screen.
  if (lock === null) return <div className="lock-screen" />
  if (!unlocked)
    return (
      <LockScreen
        configured={lock.configured}
        username={lock.username}
        onUnlock={() => {
          sessionStorage.setItem('entropy-unlocked', '1')
          setUnlocked(true)
        }}
      />
    )

  return (
    <div className={`app ${narrow ? 'narrow' : ''} ${mobile ? 'mobile' : ''}`}>
      {narrow && (sidebarOpen || aiOpen || pagesOpen) && (
        <div className="drawer-backdrop" onClick={closeDrawers} />
      )}
      <div className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <Sidebar
          tree={tree}
          hasKey={settings.connected}
          activePath={active?.path ?? null}
          expanded={expanded}
          renaming={renaming}
          selectMode={selectMode}
          selected={selected}
          selectedCount={selected.size}
          onToggleSelect={toggleSelect}
          onToggleSelectMode={toggleSelectMode}
          onBulkMove={() => setBulkMoveOpen(true)}
          onBulkDelete={bulkDelete}
          onToggle={toggle}
          onOpen={openNode}
          onContext={openCtx}
          onRenameSubmit={doRename}
          onRenameCancel={() => setRenaming(null)}
          onDropNode={doMove}
          onRootDrop={(src) => doMove(src, '')}
          onNewProject={() => setModal({ type: 'project' })}
          onNewDoc={() => { uploadDir.current = targetDir; createDoc() }}
          onUpload={() => triggerUpload(targetDir)}
          onSettings={() => setShowSettings(true)}
          onLogout={logout}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <div className="main">
        <div className="topbar">
          <button className="icon-btn" onClick={toggleSidebar} title="Toggle sidebar">
            <PanelLeft size={18} />
          </button>
          <button className="icon-btn" onClick={goDashboard} title="Dashboard">
            <Cloud size={18} />
          </button>
          <div className="crumbs">
            {view === 'dashboard' ? (
              <span className="cur">Dashboard</span>
            ) : narrow ? (
              <span className="cur">{(crumbs[crumbs.length - 1] || '').replace(/\.html$/, '')}</span>
            ) : (
              crumbs.map((c, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: i === crumbs.length - 1 ? 0 : undefined }}>
                  {i > 0 && <span className="sep">/</span>}
                  <span className={i === crumbs.length - 1 ? 'cur' : ''}>{c.replace(/\.html$/, '')}</span>
                </span>
              ))
            )}
          </div>
          <div className="spacer" />
          <SyncPill
            mode={settings.mode}
            online={settings.online}
            busy={syncBusy}
            onToggle={toggleMode}
            onSyncNow={doSyncNow}
          />
          {view === 'doc' && (
            <>
              <div className={`save-state ${saveState}`}>
                {saveState === 'saving' ? (
                  <><Loader2 size={13} className="spin" /> Saving…</>
                ) : saveState === 'saved' ? (
                  <><Check size={13} /> Saved</>
                ) : saveState === 'unsaved' ? (
                  <><Dot size={13} /> Unsaved changes</>
                ) : null}
              </div>
              <button
                className="btn-save"
                onClick={saveNow}
                disabled={saveState === 'saving' || saveState === 'saved' || saveState === 'idle'}
                title="Save (Ctrl+S)"
              >
                <Save size={15} /> Save
              </button>
            </>
          )}
          {view === 'doc' && (
            <button className={`icon-btn ${pagesOpen ? 'active' : ''}`} onClick={togglePages} title="Pages & bookmarks">
              <BookMarked size={18} />
            </button>
          )}
          <button className={`icon-btn ${aiOpen ? 'active' : ''}`} onClick={toggleAi} title="Claude">
            <Sparkles size={18} />
          </button>
        </div>

        <div className="content">
          <div className="content-inner">
            {view === 'dashboard' && (
              <Dashboard
                tree={tree}
                onOpenProject={(n) => {
                  setExpanded((s) => new Set(s).add(n.path))
                  setSidebarOpen(true)
                  openFolder(n)
                }}
                onContext={(e, node) => openCtx(e, node, true)}
                onNewProject={() => setModal({ type: 'project' })}
                onNewDoc={() => { uploadDir.current = ''; createDoc() }}
              />
            )}
            {view === 'doc' && active && (
              <Editor
                key={active.path}
                path={active.path}
                initialHtml={docHtml}
                onChange={(html) => {
                  dirty.current = true
                  docHtmlRef.current = html
                  scheduleIdleSave()
                }}
                onSaveState={setSaveState}
                onReady={(ed) => {
                  editorRef.current = ed
                  setEditorInst(ed)
                }}
                onSave={saveNow}
                saveState={saveState}
                onBrowseImages={() => setShowImagePicker(true)}
                onCropImage={(p) => setCropTarget(p)}
              />
            )}
            {view === 'folder' && active && (
              <FolderView
                node={findNode(tree, active.path) ?? active}
                onOpen={openNode}
                onContext={(e, node) => openCtx(e, node, true)}
                onNewDoc={() => { uploadDir.current = active.path; createDoc() }}
                onNewFolder={() => setModal({ type: 'folder', parent: active.path })}
                onUpload={() => triggerUpload(active.path)}
              />
            )}
            {view === 'viewer' && active && (
              <Viewer
                node={active}
                siblings={viewerSiblings}
                onNavigate={(n) => openNode(n)}
                onConvertedToDoc={(p) => { refresh(); openDoc(p) }}
                onClose={closeViewer}
              />
            )}
          </div>

          {pagesOpen && view === 'doc' && (
            <PagesPanel editor={editorInst} docPath={active?.path ?? null} onClose={() => setPagesOpen(false)} />
          )}

          {aiOpen && (
            <AIPanel
              hasKey={settings.connected}
              contextTitle={view === 'doc' ? docTitle : null}
              getContext={() => editorRef.current?.getText() ?? ''}
              onOpenResult={openResult}
              onOpenSettings={() => setShowSettings(true)}
              onClose={() => setAiOpen(false)}
            />
          )}
        </div>
      </div>

      {/* modals */}
      {modal?.type === 'project' && (
        <PromptModal
          title="New project"
          subtitle="A project is a top-level folder. Add subfolders and documents inside it."
          label="Project name"
          initial="New Project"
          colorPalette={FOLDER_COLORS}
          iconNames={FOLDER_ICON_NAMES}
          onConfirm={(name, color, icon) => createProject(name, color, icon)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'folder' && (
        <PromptModal
          title="New folder"
          label="Folder name"
          initial="New Folder"
          onConfirm={(name) => createFolder(modal.parent, name)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'rename' && (
        <PromptModal
          title="Rename"
          label="Name"
          initial={modal.node.type === 'doc' ? modal.node.name.replace(/\.html$/, '') : modal.node.name}
          confirmText="Rename"
          onConfirm={(name) => {
            doRename(modal.node, name)
            setModal(null)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {showSettings && (
        <Settings
          authMode={settings.authMode}
          connected={settings.connected}
          model={settings.model}
          hasMongo={settings.hasMongo}
          onSaved={(s) => {
            setSettings((p) => ({ ...p, ...s }))
            flash(s.connected ? 'Claude connected' : 'Settings saved')
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems(ctx.node, ctx.modalRename)} onClose={() => setCtx(null)} />}

      {showImagePicker && (
        <ImagePicker tree={tree} onPick={insertWorkspaceImage} onClose={() => setShowImagePicker(false)} />
      )}

      {cropTarget && (
        <CropModal
          src={cropTarget.src}
          onApply={(dataUrl) => {
            cropTarget.setSrc(dataUrl)
            setCropTarget(null)
          }}
          onClose={() => setCropTarget(null)}
        />
      )}

      {bulkMoveOpen && (
        <FolderPickerModal
          tree={tree}
          title={`Move ${topMost([...selected]).length} item(s) to…`}
          disabledPaths={new Set(topMost([...selected]))}
          onPick={doBulkMove}
          onClose={() => setBulkMoveOpen(false)}
        />
      )}

      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) handleUpload(e.target.files)
          e.target.value = ''
        }}
      />

      {upload && (
        <div className="upload-progress">
          <div className="up-row">
            <Upload size={14} />
            <span className="up-label">{upload.label}</span>
            <span className="up-pct">{upload.pct >= 1 ? 'Finishing…' : Math.round(upload.pct * 100) + '%'}</span>
          </div>
          <div className="up-track">
            <div className="up-fill" style={{ width: `${Math.max(4, upload.pct * 100)}%` }} />
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.msg}</div>}
    </div>
  )
}
