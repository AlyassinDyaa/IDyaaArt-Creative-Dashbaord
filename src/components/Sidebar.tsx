import { CheckSquare, FilePlus2, FolderInput, FolderPlus, KeyRound, LogOut, Settings as SettingsIcon, Trash2, Upload, X } from 'lucide-react'
import type { TreeNode as TNode } from '../lib/types'
import { TreeNode, type TreeProps } from './TreeNode'

interface SidebarProps extends Omit<TreeProps, 'node' | 'depth'> {
  tree: TNode[]
  hasKey: boolean
  selectMode: boolean
  selectedCount: number
  onToggleSelectMode: () => void
  onBulkMove: () => void
  onBulkDelete: () => void
  onNewProject: () => void
  onNewDoc: () => void
  onUpload: () => void
  onSettings: () => void
  onLogout: () => void
  onClose: () => void
  onRootDrop: (srcPath: string) => void
}

export function Sidebar(props: SidebarProps) {
  const { tree, selectMode } = props
  return (
    <div className="sidebar-inner">
      <div className="brand">
        <span className="logo">I</span>
        <span className="brand-name">IDyaaArt</span>
        <span className="spark">writer</span>
        <button
          className={`brand-select ${selectMode ? 'on' : ''}`}
          onClick={props.onToggleSelectMode}
          title={selectMode ? 'Exit selection' : 'Select multiple items'}
        >
          {selectMode ? <X size={15} /> : <CheckSquare size={15} />}
        </button>
        <button className="sidebar-close" onClick={props.onClose} title="Close sidebar">
          <X size={17} />
        </button>
      </div>

      {!selectMode && (
        <div className="sidebar-actions">
          <button className="primary" onClick={props.onNewProject}>
            <FolderPlus size={15} /> Project
          </button>
          <button onClick={props.onNewDoc} title="New document">
            <FilePlus2 size={15} /> Doc
          </button>
          <button onClick={props.onUpload} title="Import / upload files">
            <Upload size={15} />
          </button>
        </div>
      )}

      {selectMode && (
        <div className="bulk-bar">
          <span className="bulk-count">{props.selectedCount} selected</span>
          <button onClick={props.onBulkMove} disabled={props.selectedCount === 0} title="Move selected">
            <FolderInput size={15} /> Move
          </button>
          <button className="danger" onClick={props.onBulkDelete} disabled={props.selectedCount === 0} title="Delete selected">
            <Trash2 size={15} /> Delete
          </button>
        </div>
      )}

      <div
        className="tree"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const src = e.dataTransfer.getData('text/entropy-path')
          if (src) props.onRootDrop(src)
        }}
      >
        {tree.length === 0 ? (
          <div className="tree-empty">
            No projects yet.
            <br />
            Create your first project to begin.
          </div>
        ) : (
          tree.map((n) => <TreeNode key={n.path} {...props} node={n} depth={0} />)
        )}
      </div>

      <div className="sidebar-foot">
        <button onClick={props.onSettings}>
          <SettingsIcon size={15} /> Settings
        </button>
        <button onClick={props.onLogout} title="Log out">
          <LogOut size={15} /> Log out
        </button>
        <span title={props.hasKey ? 'Claude connected' : 'No API key'} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={13} color="var(--text-faint)" />
          <span className={`key-dot ${props.hasKey ? 'on' : 'off'}`} />
        </span>
      </div>
    </div>
  )
}
