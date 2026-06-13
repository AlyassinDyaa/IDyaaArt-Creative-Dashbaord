// Real pagination for the editor: inserts non-editable spacer widgets at each page
// boundary so content leaves an empty top/bottom margin per page (like MS Word),
// instead of text flowing continuously across the break. Spacers are decorations —
// they never modify the document, so saved HTML stays clean.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Page geometry in px (matches the .page layout: US-Letter-ish at this zoom).
export const PAGE_PX = 1056
const MARGIN = 72 // white top/bottom margin inside each page (matches .page padding)
const GAP = 28 // gap shown between two pages
const CONTENT = PAGE_PX - MARGIN * 2 // usable content height per page

function makeSpacer(total: number, gapTop: number) {
  const wrap = document.createElement('div')
  wrap.className = 'pm-page-spacer'
  wrap.setAttribute('contenteditable', 'false')
  wrap.style.height = `${total}px`
  const gap = document.createElement('div')
  gap.className = 'pm-page-gap'
  gap.style.top = `${gapTop}px`
  gap.style.height = `${GAP}px`
  wrap.appendChild(gap)
  return wrap
}

const key = new PluginKey('pagination')

export const Pagination = Extension.create({
  name: 'pagination',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(key)
            if (meta) return meta as DecorationSet
            return old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)
          },
        },
        view(view) {
          let scheduled = 0

          const compute = () => {
            scheduled = 0
            // real block elements (exclude our own spacers), in document order
            const blocks = Array.from(view.dom.children).filter(
              (el) => !(el as HTMLElement).classList.contains('pm-page-spacer')
            ) as HTMLElement[]
            const decos: Decoration[] = []
            let used = 0
            let i = 0
            view.state.doc.forEach((_node, offset) => {
              const el = blocks[i++]
              if (!el) return
              const cs = getComputedStyle(el)
              const h = el.offsetHeight + parseFloat(cs.marginTop || '0') + parseFloat(cs.marginBottom || '0')
              if (used > 0 && used + h > CONTENT) {
                const remaining = Math.max(0, CONTENT - used)
                const total = remaining + MARGIN + GAP + MARGIN
                decos.push(
                  Decoration.widget(offset, () => makeSpacer(total, remaining + MARGIN), { side: -1, key: `pg-${offset}` })
                )
                used = h
              } else {
                used += h
              }
            })
            const next = DecorationSet.create(view.state.doc, decos)
            // dispatched async (outside the PM update cycle), so it's safe
            view.dispatch(view.state.tr.setMeta(key, next).setMeta('addToHistory', false))
          }

          const schedule = () => {
            if (scheduled) return
            scheduled = window.setTimeout(compute, 80)
          }
          const onResize = () => schedule()
          window.addEventListener('resize', onResize)
          schedule()

          return {
            update(v, prevState) {
              if (v.state.doc !== prevState.doc) schedule()
            },
            destroy() {
              window.removeEventListener('resize', onResize)
              if (scheduled) clearTimeout(scheduled)
            },
          }
        },
      }),
    ]
  },
})
