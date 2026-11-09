/** One entry of public/models/index.json, written by scripts/map.mjs. */
export interface ModelEntry { name: string; title: string; source: 'sample' | 'import'; views?: string[] }

/**
 * Fills the model tabs: published maps first, then the samples and the synthetic sizes. A model
 * with more than one view (its architecture, its requests) gets a view switch in `views`, beside
 * the lenses: like a lens, it is a way of looking at the open model, not another model.
 */
export async function renderModelTabs(nav: HTMLElement, viewsNav: HTMLElement, current: string, n: string | null, view: string | null = null) {
  let entries: ModelEntry[] = []
  try { entries = await (await fetch(`${import.meta.env.BASE_URL}models/index.json?v=${Date.now()}`)).json() } catch { /* none extracted yet */ }
  const tab = (href: string, label: string, on: boolean, cls = '') => {
    const a = document.createElement('a')
    a.href = href
    a.textContent = label
    a.title = label
    a.className = [on ? 'on' : '', cls].filter(Boolean).join(' ')
    return a
  }
  const open = entries.find(e => e.name === current)
  viewsNav.replaceChildren(...(open?.views?.length
    ? [tab(`?model=${open.name}`, 'Architecture', !view), ...open.views.map(v => tab(`?model=${open.name}&view=${v}`, v[0].toUpperCase() + v.slice(1), view === v))]
    : []))
  viewsNav.hidden = !viewsNav.childElementCount
  nav.replaceChildren(
    ...entries.filter(e => e.source === 'import').map(e => tab(`?model=${e.name}`, e.title, e.name === current, 'imported')),
    ...entries.filter(e => e.source === 'sample').map(e => tab(`?model=${e.name}`, e.title, e.name === current)),
    tab('?model=synthetic&n=1000', '1k', current === 'synthetic' && n !== '10000'),
    tab('?model=synthetic&n=10000', '10k', current === 'synthetic' && n === '10000'),
  )
}
