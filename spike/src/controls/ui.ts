import type { Tree } from '../model'
import { fuzzy, searchMap } from './logic'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

/** Path of titles from the top level down to an element's parent. */
export function pathOf(tree: Tree, i: number) {
  const out: string[] = []
  for (let a = tree.parent[i]; a > 0; a = tree.parent[a]) out.unshift(tree.els[a].title)
  return out.join(' › ')
}

/** Short notifications: what just happened, and the key for what comes next. Read out by screen readers. */
export class Toast {
  private root = el('div', 'toast')
  private timer = 0
  constructor() {
    this.root.setAttribute('role', 'status')
    this.root.setAttribute('aria-live', 'polite')
    document.body.append(this.root)
  }
  show(text: string, hint = '') {
    this.root.replaceChildren(el('span', '', text), ...(hint ? [el('kbd', '', hint)] : []))
    this.root.classList.add('show')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.root.classList.remove('show'), 2600)
  }
}

export interface Command { name: string; hint?: string; run: () => void }

/** What picking a search result does. */
export interface SearchActions {
  /** Go to element i. */
  go: (i: number) => void
  /** Show the cards that carry a feature. */
  feature: (name: string) => void
  /** Recently visited cards, most recent first. */
  recent: () => number[]
}

type Item = { label: string; sub: string; kind: string; run: () => void }

/**
 * Search: features and parts first, then files, keyboard first. An empty box lists the map's
 * features and the places you were; `>` lists commands. Closed, it is out of the tab order.
 */
export class Palette {
  private root = el('div', 'palette')
  private input = el('input')
  private list = el('div', 'palette-list')
  private items: Item[] = []
  private active = 0
  isOpen = false

  constructor(public tree: Tree, private commands: () => Command[], private act: SearchActions) {
    this.input.placeholder = 'Search features, parts and files…  (> for commands)'
    this.input.setAttribute('aria-label', 'Search the map')
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-label', 'Search')
    this.root.hidden = true
    this.root.append(this.input, this.list)
    document.body.append(this.root)
    this.input.addEventListener('input', () => this.search())
    this.input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { this.move(1); e.preventDefault() }
      if (e.key === 'ArrowUp') { this.move(-1); e.preventDefault() }
      if (e.key === 'Enter') { const it = this.items[this.active]; this.close(); it?.run() }
      if (e.key === 'Escape') this.close()
      e.stopPropagation()
    })
    // A click outside closes it; a click on a row runs that row first (mousedown, below).
    this.input.addEventListener('blur', () => { if (this.isOpen) this.close() })
  }

  open(prefix = '') {
    this.isOpen = true
    this.root.hidden = false
    this.input.value = prefix
    this.search()
    this.input.focus()
  }

  close() {
    if (!this.isOpen) return
    this.isOpen = false
    this.root.hidden = true
    this.input.blur()
  }

  private move(d: number) {
    this.active = Math.max(0, Math.min(this.items.length - 1, this.active + d))
    const rows = this.list.querySelectorAll('.row')
    rows.forEach((c, k) => c.classList.toggle('on', k === this.active))
    rows[this.active]?.scrollIntoView({ block: 'nearest' })
  }

  private element = (i: number): Item => {
    const e = this.tree.els[i]
    return { label: e.title, sub: e.metadata?.path ?? pathOf(this.tree, i), kind: e.metadata?.path ? 'file' : e.kind, run: () => this.act.go(i) }
  }
  private featureItem = (name: string, n: number): Item => ({ label: name, sub: `carried by ${n} card${n === 1 ? '' : 's'}`, kind: 'feature', run: () => this.act.feature(name) })

  private allFeatures() {
    const m = new Map<string, number>()
    for (const e of this.tree.els) for (const f of e.features ?? []) m.set(f, (m.get(f) ?? 0) + 1)
    return [...m]
  }

  private search() {
    const raw = this.input.value
    const q = raw.replace(/^>\s*/, '').trim()
    const groups: [string, Item[]][] = []
    let note: HTMLElement | null = null
    if (raw.startsWith('>')) {
      const cmds = this.commands().map(c => ({ c, s: q ? fuzzy(q, c.name) : 0 })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s)
      groups.push(['Commands', cmds.map(({ c }) => ({ label: c.name, sub: c.hint ?? '', kind: 'command', run: () => c.run() }))])
    } else if (!q) {
      const recent = this.act.recent().filter(i => i > 0 && i < this.tree.size).slice(0, 6)
      if (recent.length) groups.push(['Recent places', recent.map(this.element)])
      groups.push(['Features of this map', this.allFeatures().map(([f, n]) => this.featureItem(f, n))])
    } else {
      const found = searchMap(this.tree.els, q)
      // A part and a feature of one name: the part, a place to go, comes first.
      const parts = [...found.features.map(f => ({ score: f.score - 0.5, item: this.featureItem(f.name, f.cards.length) })), ...found.parts.map(p => ({ score: p.score, item: this.element(p.i) }))]
        .sort((a, b) => b.score - a.score).map(x => x.item)
      // An exact file path outranks the parts: it is what was asked for.
      const exact = found.files.filter(f => f.score >= 110)
      if (exact.length) groups.push(['Files', exact.map(f => this.element(f.i))])
      if (parts.length) groups.push(['Features and parts', parts])
      const files = found.files.filter(f => f.score < 110)
      if (files.length) groups.push([exact.length ? 'More files' : 'Files', files.map(f => this.element(f.i))])
      if (!groups.length) {
        // Nothing found: say so, and offer the map's own words, its features, instead. Picking one
        // searches for it in place: the box stays open on its results.
        note = el('div', 'none', `Nothing matches “${q}”. Search looks at titles, features, file paths and descriptions. Features of this map:`)
        groups.push(['', this.allFeatures().slice(0, 8).map(([f]) => ({ label: f, sub: 'feature', kind: 'try', run: () => this.open(f) }))])
      }
    }
    this.items = groups.flatMap(([, items]) => items)
    this.active = 0
    let k = 0
    this.list.replaceChildren(...(note ? [note] : []), ...groups.flatMap(([title, items]) => [
      ...(title ? [el('div', 'group', title)] : []),
      ...items.map(it => {
        const row = el('div', k++ === 0 ? 'row on' : 'row')
        row.append(el('span', 'kind', it.kind), el('b', '', it.label), el('span', 'sub', it.sub))
        row.onmousedown = e => { e.preventDefault(); this.close(); it.run() }
        return row
      }),
    ]))
  }
}

export interface MenuItem { label: string; key?: string; run: () => void }

/** A plain context menu: a short list at the pointer, keyboard reachable, gone on Esc or any click. */
export class Menu {
  private root = el('div', 'menu panel')
  get isOpen() { return !this.root.hidden }

  constructor() {
    this.root.setAttribute('role', 'menu')
    this.root.hidden = true
    document.body.append(this.root)
    window.addEventListener('pointerdown', e => { if (this.isOpen && !this.root.contains(e.target as Node)) this.close() }, true)
    this.root.addEventListener('keydown', e => {
      const items = [...this.root.querySelectorAll('button')]
      const k = items.indexOf(document.activeElement as HTMLButtonElement)
      if (e.key === 'ArrowDown') { items[(k + 1) % items.length]?.focus(); e.preventDefault() }
      if (e.key === 'ArrowUp') { items[(k - 1 + items.length) % items.length]?.focus(); e.preventDefault() }
      if (e.key === 'Escape') { this.close(); e.stopPropagation() }
    })
  }

  open(x: number, y: number, title: string, items: MenuItem[]) {
    this.root.replaceChildren(el('div', 'menu-title', title), ...items.map(it => {
      const b = el('button')
      b.setAttribute('role', 'menuitem')
      b.append(el('span', '', it.label), ...(it.key ? [el('kbd', '', it.key)] : []))
      b.onclick = () => { this.close(); it.run() }
      return b
    }))
    this.root.hidden = false
    const r = this.root.getBoundingClientRect()
    this.root.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`
    this.root.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`
    this.root.querySelector('button')?.focus()
  }

  close() { this.root.hidden = true }
}

/**
 * A short preview of a card too small to show its own text: what it is and how much it uses and
 * is used. It follows the pointer and holds nothing to click.
 */
export class Tooltip {
  private root = el('div', 'tip')
  private node = -1
  private since = 0

  constructor(public tree: Tree, private counts: (i: number) => { uses: number; usedBy: number }) {
    this.root.hidden = true
    this.root.setAttribute('aria-hidden', 'true')
    document.body.append(this.root)
  }

  /** Every frame: the card under the pointer that is too small to read, or -1. */
  update(node: number, x: number, y: number, now: number) {
    // Off the line it was naming: that tooltip goes.
    if (this.lineKey) { this.lineKey = ''; this.root.hidden = true }
    if (node !== this.node) { this.node = node; this.since = now; this.root.hidden = true }
    if (node <= 0 || now - this.since < 350) return
    if (this.root.hidden) {
      const e = this.tree.els[node], n = this.counts(node), inside = this.tree.children[node].length
      this.root.replaceChildren(
        el('div', 'tip-kind', `${e.metadata?.path ? 'File' : e.kind}${e.technology ? ` · ${e.technology}` : ''}`),
        el('div', 'tip-title', e.title),
        ...(e.description ? [el('div', 'tip-desc', e.description.replace(/\s+/g, ' ').slice(0, 160))] : []),
        el('div', 'tip-counts', [`uses ${n.uses}`, `used by ${n.usedBy}`, ...(inside ? [`${inside} inside`] : [])].join(' · ')),
      )
      this.root.hidden = false
    }
    const r = this.root.getBoundingClientRect()
    this.root.style.left = `${Math.min(x + 16, innerWidth - r.width - 12)}px`
    this.root.style.top = `${Math.min(y + 16, innerHeight - r.height - 12)}px`
  }

  /** Over a line: what it carries, as pairs, kept until the pointer leaves it. */
  showLines(key: string, title: string, rows: string[], x: number, y: number) {
    if (key !== this.lineKey) {
      this.lineKey = key
      this.root.replaceChildren(el('div', 'tip-kind', 'This line carries'), el('div', 'tip-title', title), ...rows.map(r => el('div', 'tip-desc', r)))
    }
    this.node = -1
    this.root.hidden = false
    const r = this.root.getBoundingClientRect()
    this.root.style.left = `${Math.min(x + 16, innerWidth - r.width - 12)}px`
    this.root.style.top = `${Math.min(y + 16, innerHeight - r.height - 12)}px`
  }
  private lineKey = ''

  close() { this.node = -1; this.lineKey = ''; this.root.hidden = true }
}

/** The controls page, as a modal dialog: focus moves in, Tab stays in, Esc or ? closes it. */
export class Help {
  private root = el('div', 'help-overlay')
  private box = el('div', 'help-box')
  private back: HTMLElement | null = null

  constructor(connections: boolean) {
    const groups: [string, [string, string][]][] = [
      ['Mouse', [['Wheel', 'Zoom at the pointer'], ['Drag', 'Pan'], ['Click', 'Select: amber arrows it uses, cyan what uses it'], ['Double-click', 'Go into a card; on a file, read its code'], ['Right-click', 'Go in, read code, copy path'], ['Click a cited line', 'Open its code at that line']]],
      ['Keys', [['Ctrl+K or /', 'Search the map'], ['Backspace or Alt+←', 'Back to the previous place'], ['Alt+→', 'Forward'], ['Alt+↑', 'Up to the parent'], [']  /  [', 'Step through what it uses / what uses it'], ['Enter', 'Go to the card stepped to, or into the selection'], ...(connections ? [['.  /  ,', 'Next / previous by connections in this level'] as [string, string]] : []), ['Arrows, + / −', 'Move and zoom'], ['Esc', 'Close the top layer, then clear the selection'], ['?', 'This page']]],
    ]
    const legend: [string, string][] = [
      ['Card', 'A part of the product; a card inside a card is a part of it'],
      ['Arrow', 'One part uses another; thicker carries more relations'],
      ['Amber / cyan', 'With a selection: what it uses / what uses it'],
      ['Grey outline', 'An external system, outside the mapped code'],
    ]
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'true')
    this.root.setAttribute('aria-labelledby', 'help-title')
    this.root.hidden = true
    const grid = el('div', 'help-grid')
    for (const [title, rows] of [...groups, ['What you see', legend] as [string, [string, string][]]]) {
      const col = el('section', 'help-col')
      col.append(el('h3', '', title))
      for (const [k, v] of rows) { const r = el('div', 'help-row'); r.append(el(title === 'What you see' ? 'b' : 'kbd', '', k), el('span', '', v)); col.append(r) }
      grid.append(col)
    }
    const h = el('h2', '', 'Controls')
    h.id = 'help-title'
    const close = el('button', 'help-close', 'Close')
    close.onclick = () => this.toggle(false)
    this.box.append(h, grid, close)
    this.root.append(this.box)
    this.root.onclick = e => { if (e.target === this.root) this.toggle(false) }
    this.root.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.key === '?') { this.toggle(false); e.preventDefault(); e.stopPropagation(); return }
      if (e.key === 'Tab') {
        // Focus stays in the dialog: its one control.
        e.preventDefault()
        close.focus()
      }
      // Nothing typed here reaches the map behind it.
      e.stopPropagation()
    })
    document.body.append(this.root)
  }
  get isOpen() { return !this.root.hidden }
  toggle(on = !this.isOpen) {
    if (on === this.isOpen) return
    if (on) {
      this.back = document.activeElement as HTMLElement | null
      this.root.hidden = false
      ;(this.root.querySelector('.help-close') as HTMLElement).focus()
    } else {
      this.root.hidden = true
      this.back?.focus?.()
    }
  }
}
