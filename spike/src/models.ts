/** One entry of public/models/index.json, written by scripts/store.mjs. */
export interface ModelEntry { name: string; title: string; source: 'sample' | 'import'; views?: string[] }

/**
 * Fills the model picker: one button naming the open model, and a menu of the rest (mapped
 * projects first, then the samples and the synthetic sizes), so the bar stays one line however
 * many models there are. A model with more than one view (its architecture, its requests) gets a
 * view switch in `views`, beside the lenses: like a lens, it is a way of looking at the open
 * model, not another model.
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
  button.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden }
  nav.replaceChildren(button, menu)
}

// One listener for the page: a click elsewhere or Esc closes the model menu.
const close = () => { for (const m of document.querySelectorAll<HTMLElement>('.model-menu')) m.hidden = true }
addEventListener('click', e => { if (!(e.target as Element).closest?.('.model-menu')) close() })
addEventListener('keydown', e => { if (e.key === 'Escape') close() })
