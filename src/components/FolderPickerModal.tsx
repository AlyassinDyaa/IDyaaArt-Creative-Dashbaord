import { Folder, FolderRoot } from 'lucide-react'
import { Modal } from './Modal'
import type { TreeNode } from '../lib/types'

function collectFolders(nodes: TreeNode[], depth = 0, acc: { path: string; name: string; depth: number }[] = []) {
  for (const n of nodes) {
    if (n.type === 'folder') {
      acc.push({ path: n.path, name: n.name, depth })
      collectFolders(n.children || [], depth + 1, acc)
    }
  }
  return acc
}

export function FolderPickerModal({
  tree,
  title = 'Move to…',
  disabledPaths = new Set<string>(),
  onPick,
  onClose,
}: {
  tree: TreeNode[]
  title?: string
  disabledPaths?: Set<string>
  onPick: (destDir: string) => void
  onClose: () => void
}) {
  const folders = collectFolders(tree)
  // a destination is invalid if it's one of the moved items or inside one
  const isDisabled = (p: string) =>
    [...disabledPaths].some((d) => p === d || p.startsWith(d + '/'))

  return (
    <Modal title={title} subtitle="Choose a destination folder." onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Cancel</button>}>
      <div className="fp-list">
        <button className="fp-item" onClick={() => onPick('')}>
          <FolderRoot size={16} className="ico folder" />
          Workspace (root)
        </button>
        {folders.map((f) => (
          <button
            key={f.path}
            className="fp-item"
            style={{ paddingLeft: 12 + f.depth * 16 }}
            disabled={isDisabled(f.path)}
            onClick={() => onPick(f.path)}
          >
            <Folder size={16} className="ico folder" />
            {f.name}
          </button>
        ))}
      </div>
    </Modal>
  )
}
