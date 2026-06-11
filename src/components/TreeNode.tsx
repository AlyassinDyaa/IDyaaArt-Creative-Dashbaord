import { useState } from 'react'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import type { TreeNode as TNode } from '../lib/types'
import { NodeIcon } from './nodeIcon'
import { FolderGlyph } from './folderIcons'

export interface TreeProps {
  node: TNode
  depth: number
  activePath: string | null
  expanded: Set<string>
  renaming: string | null
  selectMode: boolean
  selected: Set<string>
  onToggleSelect: (path: string) => void
  onToggle: (path: string) => void
  onOpen: (node: TNode) => void
  onContext: (e: React.MouseEvent, node: TNode) => void
  onRenameSubmit: (node: TNode, name: string) => void
  onRenameCancel: () => void
  onDropNode: (srcPath: string, destFolder: string) => void
}

export function TreeNode(props: TreeProps) {
  const { node, depth, activePath, expanded, renaming, selectMode, selected, onToggleSelect, onToggle, onOpen, onContext } = props
  const isFolder = node.type === 'folder'
  const isOpen = expanded.has(node.path)
  const isActive = activePath === node.path
  const isRenaming = renaming === node.path
  const isChecked = selected.has(node.path)
  const [dropTarget, setDropTarget] = useState(false)

  const handleClick = () => {
    if (selectMode) {
      onToggleSelect(node.path)
      return
    }
    if (isFolder) {
      onToggle(node.path)
      onOpen(node) // also show the folder's contents in the main area
    } else {
      onOpen(node)
    }
  }

  return (
    <div>
      <div
        className={`node-row ${isActive ? 'active' : ''} ${dropTarget ? 'drop' : ''} ${isChecked ? 'checked' : ''}`}
        style={{ paddingLeft: 6 + depth * 4 }}
        onClick={handleClick}
        onContextMenu={(e) => onContext(e, node)}
        draggable={!isRenaming && !selectMode}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/entropy-path', node.path)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          if (isFolder) {
            e.preventDefault()
            setDropTarget(true)
          }
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(e) => {
          setDropTarget(false)
          if (!isFolder) return
          const src = e.dataTransfer.getData('text/entropy-path')
          if (src && src !== node.path) props.onDropNode(src, node.path)
        }}
      >
        {selectMode && (
          <input
            type="checkbox"
            className="node-check"
            checked={isChecked}
            onChange={() => onToggleSelect(node.path)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <span
          className={`caret ${isFolder ? '' : 'placeholder'}`}
          onClick={(e) => {
            e.stopPropagation()
            if (!selectMode) onToggle(node.path)
          }}
        >
          <ChevronRight size={13} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
        </span>
        <span className="ico">
          {isFolder ? (
            <FolderGlyph name={node.icon} color={node.color} />
          ) : (
            <NodeIcon type={node.type} color={node.color} />
          )}
        </span>
        {isRenaming ? (
          <input
            className="rename-input"
            autoFocus
            defaultValue={node.name.replace(/\.html$/, '')}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => props.onRenameSubmit(node, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onRenameSubmit(node, (e.target as HTMLInputElement).value)
              if (e.key === 'Escape') props.onRenameCancel()
            }}
          />
        ) : (
          <span className="label">{node.type === 'doc' ? node.name.replace(/\.html$/, '') : node.name}</span>
        )}
        <button
          className="row-act"
          onClick={(e) => {
            e.stopPropagation()
            onContext(e, node)
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {isFolder && isOpen && node.children && (
        <div className="node-children">
          {node.children.length === 0 && (
            <div className="node-row" style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              <span className="caret placeholder" />
              empty
            </div>
          )}
          {node.children.map((c) => (
            <TreeNode key={c.path} {...props} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
