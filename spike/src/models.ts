/** One entry of public/models/index.json, written by scripts/map.mjs. */
export interface ModelEntry { name: string; title: string; source: 'sample' | 'import'; views?: string[] }

/** Fills the model tabs: published maps first, then the samples and the synthetic sizes. */
export async function renderModelTabs(nav: HTMLElement, current: string, n: string | null, view: string | null = null) {
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
  // An import with a Requests view gets a switch beside its tab: its architecture, or its requests.
  const views = (e: ModelEntry) => (e.name === current && e.views?.length
    ? [tab(`?model=${e.name}`, 'Architecture', !view, 'view'), ...e.views.map(v => tab(`?model=${e.name}&view=${v}`, v[0].toUpperCase() + v.slice(1), view === v, 'view'))]
    : [])
  nav.replaceChildren(
    ...entries.filter(e => e.source === 'import').flatMap(e => [tab(`?model=${e.name}`, e.title, e.name === current, 'imported'), ...views(e)]),
    ...entries.filter(e => e.source === 'sample').map(e => tab(`?model=${e.name}`, e.title, e.name === current)),
    tab('?model=synthetic&n=1000', '1k', current === 'synthetic' && n !== '10000'),
    tab('?model=synthetic&n=10000', '10k', current === 'synthetic' && n === '10000'),
  )
}
