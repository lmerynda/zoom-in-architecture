// What made each request, from the project's own end-to-end tests (zoom trace, folded in at publish
// by scripts/observed.mjs markCallers): the pages a browser made it from, the endpoints a page
// called, and the tests that made it. Panel sections; each row with a card on this map goes to it.
import type { Tree } from './model'

type PageRow = { page: string; path: string | null; count: number }
type CallRow = { endpoint: string; count: number; path: string | null }
type TestRow = { test: string; count: number }
/** A call in an endpoint's call tree (trace --methods): a method, or a table touched, with where it is declared. */
export type CallNode = { at: string; count: number; path?: string; line?: number; kids?: CallNode[] }

const el = (tag: string, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e }
/** A JSON list from metadata, keeping only the rows of the expected shape: metadata is any upload's strings. */
const parse = <T>(s: string | undefined, ok: (r: Record<string, unknown>) => boolean): T[] => {
  if (!s) return []
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter(r => r && typeof r === 'object' && ok(r)) : [] } catch { return [] }
}
const str = (v: unknown) => typeof v === 'string'
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const strOrNull = (v: unknown) => v == null || typeof v === 'string'
const times = (n: number) => `×${n.toLocaleString('en-US')}`
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** The lists a card's trace marks hold, as plain rows: what the panel shows, testable without a page. */
export function callerRows(tree: Tree, i: number): { pages: PageRow[]; calls: CallRow[]; tests: TestRow[]; testCount: number; untimed: number; otherPages: number } {
  const m = tree.els[i]?.metadata
  const tests = parse<TestRow>(m?.tests, r => str(r.test) && num(r.count))
  return {
    pages: parse<PageRow>(m?.pages, r => str(r.page) && strOrNull(r.path) && num(r.count)),
    calls: parse<CallRow>(m?.pageCalls, r => str(r.endpoint) && strOrNull(r.path) && num(r.count)),
    tests, testCount: Math.max(tests.length, Number(m?.testCount) || 0), untimed: Number(m?.untimed) || 0, otherPages: Number(m?.otherPages) || 0,
  }
}

/** How many tests a list shows before "Show all". */
const FIRST = 8

/**
 * The panel sections: "Called from pages" on an endpoint, "Calls in tests" on a page's file, "Made
 * by tests" on an endpoint. A page or endpoint whose file is a card here is a button to it.
 */
export function traceSections(tree: Tree, i: number, act: { go: (j: number) => void; openPath: (path: string, line: number, near: number) => void }): HTMLElement[] {
  const go = act.go
  const { pages, calls, tests, testCount, untimed, otherPages } = callerRows(tree, i)
  const byPath = new Map<string, number>()
  if (pages.length || calls.length) tree.els.forEach((e, j) => { if (e.metadata?.path && !byPath.has(e.metadata.path)) byPath.set(e.metadata.path, j) })
  const out: HTMLElement[] = []
  const section = (title: string, note: string, rows: HTMLElement[], hidden = 0, after: string[] = []) => {
    const box = el('section', 'd-outline d-callers')
    box.append(el('h3', '', title), el('p', 'd-hint', note))
    const ul = el('ul')
    ul.setAttribute('aria-label', title)
    rows.forEach((r, k) => { const li = el('li'); li.append(r); if (k >= rows.length - hidden) li.hidden = true; ul.append(li) })
    box.append(ul)
    // A toggle that stays where it is, so keyboard focus does too, and says whether the list is open.
    if (hidden) {
      const more = el('button', 'd-more', `Show all ${rows.length}`)
      more.setAttribute('aria-expanded', 'false')
      more.onclick = () => {
        const open = more.getAttribute('aria-expanded') !== 'true'
        ;[...ul.children].forEach((li, k) => { (li as HTMLElement).hidden = !open && k >= rows.length - hidden })
        more.setAttribute('aria-expanded', String(open))
        more.textContent = open ? `Show the first ${rows.length - hidden}` : `Show all ${rows.length}`
      }
      box.append(more)
    }
    for (const t of after) box.append(el('p', 'd-hint', t))
    out.push(box)
  }
  const row = (title: string, note: string, path: string | null) => {
    const j = path ? byPath.get(path) ?? -1 : -1
    const r = el(j > 0 ? 'button' : 'span', 'd-rel')
    r.append(el('b', '', title), el('span', '', note))
    if (j > 0) r.onclick = () => go(j)
    return r
  }
  const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`
  if (pages.length) section(`Called from pages · ${pages.length}`, 'The pages a browser was on when the tests made it (their Referer).', pages.map(p => row(p.page, [p.path ? base(p.path) : '', times(p.count)].filter(Boolean).join(' · '), p.path)), 0,
    otherPages ? [`And ${plural(otherPages, 'request')} from addresses no route of the app names, not kept: they may hold an id or a token.`] : [])
  if (calls.length) section(`Calls in tests · ${calls.length}`, `What this page${tree.els[i].metadata?.page ? ` (${tree.els[i].metadata!.page})` : ''} asked the server for while the browser tests used it.`, calls.map(c => row(c.endpoint, [c.path ? base(c.path) : '', times(c.count)].filter(Boolean).join(' · '), c.path)))
  if (tests.length || untimed) {
    const rows = tests.map(t => { const [file, ...name] = t.test.split(' › '); return row(name.length ? name.join(' › ') : file, name.length ? `${file} · ${times(t.count)}` : times(t.count), null) })
    section(`Made by tests · ${testCount}`, testCount > tests.length ? `The ${tests.length} that made it most, of ${testCount}.` : 'The tests running when it was made, busiest first.', rows, Math.max(0, rows.length - FIRST),
      untimed ? [`And ${plural(untimed, 'request')} while no single test ran in its file: a set-up, or tests side by side.`] : [])
  }
  const calls3 = callTreeOf(tree.els[i]?.metadata?.callTree)
  // A method opens its file only where this view has a card for it.
  const files = new Set(tree.els.flatMap(e => (e.metadata?.path ? [e.metadata.path] : [])))
  if (calls3.length) out.push(callTreeSection(calls3, p => files.has(p), (path, line) => act.openPath(path, line, i)))
  return out
}


/** An endpoint's call tree from metadata, keeping only well-formed calls. */
export function callTreeOf(s: string | undefined): CallNode[] {
  const ok = (n: unknown): n is CallNode => {
    const r = n as Record<string, unknown>
    return !!r && typeof r === 'object' && str(r.at) && num(r.count) && (r.path == null || str(r.path)) && (r.line == null || num(r.line)) && (r.kids == null || Array.isArray(r.kids))
  }
  const clean = (ns: unknown[]): CallNode[] => ns.filter(ok).map(n => ({ ...n, ...(n.kids ? { kids: clean(n.kids) } : {}) }))
  if (!s) return []
  try { const v = JSON.parse(s); return Array.isArray(v) ? clean(v) : [] } catch { return [] }
}

/** "com.x.KingdomService.build" reads "KingdomService.build"; a table's line, or "3 more", as it is. */
export const shortCall = (at: string) => { const p = at.split('.'); return !/\s/.test(at) && p.length > 2 ? p.slice(-2).join('.') : at }


/**
 * An endpoint's method-level call tree (trace --methods): each call with how often it ran in the
 * tested requests, nested as the code called it, the first level open. Two controls per call, never
 * one inside the other: ▸ shows or hides the calls under it, and its name, where this view has its
 * file, opens the file at the method.
 */
function callTreeSection(nodes: CallNode[], shown: (path: string) => boolean, open: (path: string, line: number) => void): HTMLElement {
  const box = el('section', 'd-outline d-calltree')
  box.append(el('h3', '', 'Call tree in tests'), el('p', 'd-hint', 'The project’s own methods its tested requests ran, as they called each other, with how often.'))
  const list = (ns: CallNode[], depth: number): HTMLElement => {
    const ul = el('ul')
    if (depth === 0) ul.setAttribute('aria-label', 'Call tree in tests')
    for (const n of ns) {
      const li = el('li'), row = el('div', 'd-call')
      const name = shortCall(n.at)
      const canOpen = !!n.path && shown(n.path)
      const label = el(canOpen ? 'button' : 'span', 'd-rel')
      label.append(el('b', '', name), el('span', '', times(n.count)))
      if (canOpen) {
        label.title = `Open ${base(n.path!)}${n.line ? ` at line ${n.line}` : ''}`
        label.setAttribute('aria-label', `${name}, ${n.count} calls: open ${base(n.path!)}${n.line ? ` at line ${n.line}` : ''}`)
        label.onclick = () => open(n.path!, n.line ?? 1)
      }
      if (n.kids?.length) {
        const kids = list(n.kids, depth + 1)
        const toggle = el('button', 'd-fold')
        const set = (on: boolean) => {
          kids.hidden = !on
          toggle.setAttribute('aria-expanded', String(on))
          toggle.textContent = on ? '▾' : '▸'
        }
        toggle.setAttribute('aria-label', `Calls under ${name}`)
        toggle.onclick = () => set(kids.hidden === true)
        set(depth < 1)
        row.append(toggle, label)
        li.append(row, kids)
      } else {
        row.append(el('span', 'd-fold-gap'), label)
        li.append(row)
      }
      ul.append(li)
    }
    return ul
  }
  box.append(list(nodes, 0))
  return box
}
