import type { Tree } from './model'
import type { Renderer } from './render'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

/** Unit panel for the selected element: identity, path, description and clickable relations. */
export function renderDetails(panel: HTMLElement, tree: Tree, renderer: Renderer, i: number, go: (i: number) => void) {
  if (i <= 0) { panel.hidden = true; return }
  const e = tree.els[i]
  const path: number[] = []
  for (let a = tree.parent[i]; a > 0; a = tree.parent[a]) path.unshift(a)
  const head = el('div', 'd-head')
  head.append(el('span', 'd-kind', e.kind), el('h2', '', e.title))
  const crumbs = el('div', 'd-path')
  for (const a of path) {
    const b = el('button', '', tree.els[a].title)
    b.onclick = () => go(a)
    crumbs.append(b)
  }
  const tags = el('div', 'd-tags')
  for (const t of [e.technology, ...e.tags.map(t => '#' + t)].filter(Boolean)) tags.append(el('span', '', t))
  if (tree.children[i].length) tags.append(el('span', '', `${tree.children[i].length} inside`))

  const { out, inn } = renderer.relationsOf(i)
  const list = (title: string, cls: string, rows: { other: number; title: string }[], arrow: string) => {
    if (!rows.length) return []
    const box = el('div', `d-rels ${cls}`)
    box.append(el('h3', '', `${title} · ${rows.length}`))
    for (const r of rows.slice(0, 40)) {
      const b = el('button')
      b.append(el('i', '', arrow), el('b', '', tree.els[r.other].title), el('span', '', r.title))
      b.onclick = () => go(r.other)
      box.append(b)
    }
    return [box]
  }
  panel.replaceChildren(
    head,
    ...(path.length ? [crumbs] : []),
    tags,
    ...(e.description ? [el('p', '', e.description.replace(/\s+/g, ' ').trim())] : []),
    ...list('Outgoing', 'out', out, '→'),
    ...list('Incoming', 'in', inn, '←'),
    el('div', 'd-hint', 'Esc clears the selection'),
  )
  panel.hidden = false
}
