/** One entry of public/models/index.json, written by scripts/extract-likec4.mjs. */
export interface ModelEntry { name: string; title: string; source: 'sample' | 'import' }

/** Fills the model tabs: samples, local imports, the synthetic sizes, and the import button. */
export async function renderModelTabs(nav: HTMLElement, current: string, n: string | null) {
  let entries: ModelEntry[] = []
  try { entries = await (await fetch(`${import.meta.env.BASE_URL}models/index.json`)).json() } catch { /* none extracted yet */ }
  const tab = (href: string, label: string, on: boolean, cls = '') => {
    const a = document.createElement('a')
    a.href = href
    a.textContent = label
    a.className = [on ? 'on' : '', cls].filter(Boolean).join(' ')
    return a
  }
  const imports = entries.filter(e => e.source === 'import')
  nav.replaceChildren(
    ...imports.map(e => tab(`?model=${e.name}`, e.title, e.name === current, 'imported')),
    ...entries.filter(e => e.source === 'sample').map(e => tab(`?model=${e.name}`, e.title, e.name === current)),
    tab('?model=synthetic&n=1000', '1k', current === 'synthetic' && n !== '10000'),
    tab('?model=synthetic&n=10000', '10k', current === 'synthetic' && n === '10000'),
  )
  // Importing runs the scanner in the dev server; a static build only shows what it was built with.
  if (import.meta.hot) {
    const b = document.createElement('button')
    b.id = 'import'
    b.textContent = '+ Import'
    b.title = 'Import a local codebase'
    b.onclick = openImport
    nav.append(b)
  }
}

/** Asks for a local repository path, imports it through the dev server, then opens it. */
export function openImport() {
  document.querySelector('.import-box')?.remove()
  const box = document.createElement('div')
  box.className = 'palette open import-box'
  const input = document.createElement('input')
  input.placeholder = 'Path to a local repository, e.g. C:/code/shop or ~/src/api'
  const status = document.createElement('div')
  status.className = 'palette-list import-status'
  status.textContent = 'Projects come from .csproj, Cargo.toml, package.json and Unity folders. Enter imports, Esc cancels.'
  box.append(input, status)
  document.body.append(box)
  input.focus()
  let busy = false
  input.addEventListener('keydown', async e => {
    e.stopPropagation()
    if (e.key === 'Escape' && !busy) box.remove()
    if (e.key !== 'Enter' || busy || !input.value.trim()) return
    busy = true
    input.disabled = true
    status.textContent = 'Importing…'
    try {
      const res = await fetch('/__import', { method: 'POST', body: JSON.stringify({ path: input.value.trim() }) })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error ?? res.statusText)
      status.textContent = `${r.projects} projects, ${r.files} files, ${r.relations} relations. Opening…`
      location.search = `?model=${encodeURIComponent(r.name)}`
    } catch (err) {
      status.textContent = `Import failed: ${(err as Error).message}`
      busy = false
      input.disabled = false
      input.focus()
    }
  })
}
