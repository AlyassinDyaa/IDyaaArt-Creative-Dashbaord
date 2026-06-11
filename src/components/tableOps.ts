// Whole-table operations: move up/down within the document, and copy/cut/paste.
import type { Editor } from '@tiptap/react'

// internal clipboard (JSON of a table node) — reliable in-app copy/paste
let clipboard: any = null
export const hasTableClip = () => clipboard != null

// locate the table node containing the current selection
function findTable(editor: Editor): { node: any; pos: number } | null {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table') return { node, pos: $from.before(d) }
  }
  return null
}

export function moveTable(editor: Editor, dir: -1 | 1): boolean {
  const found = findTable(editor)
  if (!found) return false
  const { state, view } = editor
  const { node, pos } = found
  const $pos = state.doc.resolve(pos)
  const index = $pos.index()
  const parent = $pos.parent
  const target = dir < 0 ? index - 1 : index + 1
  if (target < 0 || target >= parent.childCount) return false

  let tr = state.tr
  if (dir < 0) {
    const prev = parent.child(index - 1)
    const insertPos = pos - prev.nodeSize
    tr = tr.delete(pos, pos + node.nodeSize).insert(insertPos, node)
  } else {
    const next = parent.child(index + 1)
    tr = tr.delete(pos, pos + node.nodeSize)
    tr = tr.insert(pos + next.nodeSize, node)
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

export function copyTable(editor: Editor): boolean {
  const found = findTable(editor)
  if (!found) return false
  clipboard = found.node.toJSON()
  return true
}

export function cutTable(editor: Editor): boolean {
  const found = findTable(editor)
  if (!found) return false
  clipboard = found.node.toJSON()
  const { state, view } = editor
  view.dispatch(state.tr.delete(found.pos, found.pos + found.node.nodeSize))
  return true
}

export function pasteTable(editor: Editor): boolean {
  if (!clipboard) return false
  const { state, view } = editor
  let node
  try {
    node = state.schema.nodeFromJSON(clipboard)
  } catch {
    return false
  }
  const $from = state.doc.resolve(state.selection.from)
  // insert just after the top-level block (e.g. the current table)
  const insertPos = $from.after(1)
  view.dispatch(state.tr.insert(insertPos, node).scrollIntoView())
  return true
}
