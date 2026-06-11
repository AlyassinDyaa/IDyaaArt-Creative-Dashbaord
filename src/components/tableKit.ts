// MS Word-like table extensions for TipTap.
// - Cells carry a background color (shading) and vertical alignment.
// - Tab / Shift-Tab move between cells; Tab in the last cell adds a new row (Word behaviour).
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'

const cellAttributes = {
  backgroundColor: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
    renderHTML: (attrs: Record<string, any>) =>
      attrs.backgroundColor ? { style: `background-color:${attrs.backgroundColor}` } : {},
  },
  verticalAlign: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.style.verticalAlign || null,
    renderHTML: (attrs: Record<string, any>) =>
      attrs.verticalAlign ? { style: `vertical-align:${attrs.verticalAlign}` } : {},
  },
}

export const KitTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes }
  },
})

export const KitTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes }
  },
})

export const KitTableRow = TableRow

export const KitTable = Table.extend({
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (!this.editor.isActive('table')) return false
        if (this.editor.commands.goToNextCell()) return true
        // last cell → add a row and move into it
        return this.editor.chain().addRowAfter().goToNextCell().run()
      },
      'Shift-Tab': () => {
        if (!this.editor.isActive('table')) return false
        return this.editor.commands.goToPreviousCell()
      },
      // merge selected cells / split a merged cell — works the instant cells are selected
      'Mod-Alt-m': () => {
        if (!this.editor.isActive('table')) return false
        return this.editor.chain().focus().mergeOrSplit().run()
      },
    }
  },
})
