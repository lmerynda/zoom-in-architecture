/** One entry of public/models/index.json, written by scripts/store.mjs. */
export interface ModelEntry { name: string; title: string; source: 'sample' | 'import'; views?: string[] }

/**
 * Fills the model picker: one button naming the open model, and a menu of the rest (mapped
 * projects first, then the samples and the synthetic sizes), so the bar stays one line however
 * many models there are. A model with more than one view (its architecture, its requests) gets a
 * view switch in `views`, beside the lenses: like a lens, it is a way of looking at the open
 * model, not another model. Architecture has two layouts, as mapped and by coupling, in a Layout
 * menu beside it: the same cards, arranged another way.
 */
export async function renderModelTabs(nav: HTMLElement, viewsNav: HTMLElement, current: string, n: string | null, view: string | null, coupling: boolean): Promise<ModelEntry | undefined> {
  let entries: ModelEntry[] = []
  try { entries = await (await fetch(`${import.meta.env.BASE_URL}models/index.json?v=${Date.now()}`)).json() } catch { /* none extracted yet */ }
  const tab = (href: string, label: string, on: boolean, cls = '') => {
    const a = document.createElement('a')
    a.href = href
    a.textContent = label
    a.title = label
    a.className = [on ? 'on' : '', cls].filter(Boolean).join(' ')
    // The open map and view say so in words too, not only in colour.
    if (on) a.setAttribute('aria-current', 'page')
    return a
  }
  const open = entries.find(e => e.name === current)
  // An import with endpoints has its Requests beside its Architecture.
  const views = open?.views ?? []
  const label = (text: string) => { const l = document.createElement('span'); l.className = 'bar-label'; l.textContent = text; return l }
  const arch = `?model=${current}`
  viewsNav.replaceChildren(...(views.length ? [label('View'), tab(`${arch}${coupling ? '&layout=coupling' : ''}`, 'Architecture', !view), ...views.map(v => tab(`${arch}&view=${v}`, v[0].toUpperCase() + v.slice(1), view === v))] : []))
  // Architecture's layouts: every map but a synthetic one, which has no map to rank.
  if (!view && current !== 'synthetic') viewsNav.append(label('Layout'), layoutMenu(arch, coupling))
  viewsNav.hidden = !viewsNav.childElementCount

  const heading = (s: string) => { const h = document.createElement('div'); h.className = 'menu-head'; h.textContent = s; return h }
  const menu = document.createElement('div')
  menu.className = 'model-menu panel'
  menu.hidden = true
  const imports = entries.filter(e => e.source === 'import'), samples = entries.filter(e => e.source === 'sample')
  menu.append(
    ...(imports.length ? [heading('Mapped projects'), ...imports.map(e => tab(`?model=${e.name}`, e.title, e.name === current, 'imported'))] : []),
    heading('Samples'),
    ...samples.map(e => tab(`?model=${e.name}`, e.title, e.name === current)),
    tab('?model=synthetic&n=1000', 'Synthetic · 1k', current === 'synthetic' && n !== '10000'),
    tab('?model=synthetic&n=10000', 'Synthetic · 10k', current === 'synthetic' && n === '10000'),
  )
  const button = document.createElement('button')
  button.className = 'model-current'
  button.textContent = current === 'synthetic' ? `Synthetic · ${n === '10000' ? '10k' : '1k'}` : open?.title ?? current
  button.title = 'Open another model'
  menu.id = 'model-menu'
  button.setAttribute('aria-controls', menu.id)
  button.setAttribute('aria-expanded', 'false')
  // The menu's state is on the button for a screen reader, however the menu was closed.
  new MutationObserver(() => button.setAttribute('aria-expanded', String(!menu.hidden))).observe(menu, { attributes: true, attributeFilter: ['hidden'] })
  button.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) (menu.querySelector<HTMLElement>('a.on') ?? menu.querySelector<HTMLElement>('a'))?.focus() }
  // A list of links shown by a button (a disclosure): Tab past its last link, or Shift+Tab out, closes it.
  nav.addEventListener('focusout', e => { if (!nav.contains(e.relatedTarget as Node | null)) menu.hidden = true })
  nav.replaceChildren(button, menu)
  return open
}

/**
 * The Layout menu: a button naming the layout in use and a menu of both, as links (each keeps the
 * place, like the view links). A disclosure: Esc or Tab out closes it, focus back on its button.
 */
function layoutMenu(arch: string, coupling: boolean): HTMLElement {
  const bar = document.createElement('span')
  bar.className = 'layoutbar'
  const button = document.createElement('button')
  button.className = 'layout-current'
  button.textContent = coupling ? 'By coupling' : 'As mapped'
  button.title = 'Lay the map out as mapped, or by coupling: the most connected part of each level in its middle'
  const menu = document.createElement('div')
  menu.className = 'layout-menu panel'
  menu.id = 'layout-menu'
  menu.hidden = true
  button.setAttribute('aria-controls', menu.id)
  button.setAttribute('aria-expanded', 'false')
  new MutationObserver(() => button.setAttribute('aria-expanded', String(!menu.hidden))).observe(menu, { attributes: true, attributeFilter: ['hidden'] })
  for (const [href, text, on] of [[arch, 'As mapped', !coupling], [`${arch}&layout=coupling`, 'By coupling', coupling]] as const) {
    const a = document.createElement('a')
    a.href = href
    a.textContent = text
    if (on) { a.className = 'on'; a.setAttribute('aria-current', 'page') }
    menu.append(a)
  }
  button.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) menu.querySelector<HTMLElement>('a.on')?.focus() }
  bar.addEventListener('focusout', e => { if (!bar.contains(e.relatedTarget as Node | null)) menu.hidden = true })
  bar.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; button.focus(); e.stopPropagation() } })
  addEventListener('click', e => { if (!bar.contains(e.target as Node)) menu.hidden = true })
  bar.append(button, menu)
  return bar
}

// One listener for the page: a click elsewhere or Esc closes the model menu.
const close = () => { for (const m of document.querySelectorAll<HTMLElement>('.model-menu')) m.hidden = true }
addEventListener('click', e => { if (!(e.target as Element).closest?.('.model-menu')) close() })
// Esc closes an open menu and nothing else: it does not also clear the map's selection.
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || ![...document.querySelectorAll<HTMLElement>('.model-menu')].some(m => !m.hidden)) return
  const inside = (document.activeElement as Element | null)?.closest?.('#models')
  close()
  // Focus that was in the menu goes back to its button, not to the page.
  if (inside) document.querySelector<HTMLElement>('.model-current')?.focus()
  e.stopImmediatePropagation()
}, true)
