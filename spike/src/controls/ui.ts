import type { Tree } from '../model'
import { elementScore, fuzzy, type Hop } from './logic'

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

/** Short game-style notifications: what just happened, and the key for what comes next. */
export class Toast {
  private root = el('div', 'toast')
  private timer = 0
  constructor() { document.body.append(this.root) }
  show(text: string, hint = '') {
    this.root.replaceChildren(el('span', '', text), ...(hint ? [el('kbd', '', hint)] : []))
    this.root.classList.add('show')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.root.classList.remove('show'), 2200)
  }
}

export interface Command { name: string; hint?: string; run: () => void }

/** Fast travel: fuzzy search over every element plus commands, keyboard first. */
export class Palette {
  private root = el('div', 'palette')
  private input = el('input')
  private list = el('div', 'palette-list')
  private items: { label: string; sub: string; kind: string; run: (shift: boolean) => void }[] = []
  private active = 0
  isOpen = false

  constructor(public tree: Tree, private commands: () => Command[], private warp: (i: number, shift: boolean) => void) {
    this.input.placeholder = 'Travel to…  (type to search, > for commands, Shift+Enter routes from the selection)'
    this.root.append(this.input, this.list)
    document.body.append(this.root)
    this.input.addEventListener('input', () => this.search())
    this.input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { this.move(1); e.preventDefault() }
      if (e.key === 'ArrowUp') { this.move(-1); e.preventDefault() }
      if (e.key === 'Enter') { const it = this.items[this.active]; this.close(); it?.run(e.shiftKey) }
      if (e.key === 'Escape') this.close()
      e.stopPropagation()
    })
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 120))
  }

  open(prefix = '') {
    this.isOpen = true
    this.root.classList.add('open')
    this.input.value = prefix
    this.search()
    this.input.focus()
  }

  // Gives keyboard focus back to the map, or its keys would land in the hidden input.
  close() { this.isOpen = false; this.root.classList.remove('open'); this.input.blur() }

  private move(d: number) {
    this.active = Math.max(0, Math.min(this.items.length - 1, this.active + d))
    ;[...this.list.children].forEach((c, k) => c.classList.toggle('on', k === this.active))
    this.list.children[this.active]?.scrollIntoView({ block: 'nearest' })
  }

  private search() {
    const raw = this.input.value
    const cmdOnly = raw.startsWith('>')
    const q = raw.replace(/^>\s*/, '').trim()
    const cmds = this.commands().map(c => ({ c, s: fuzzy(q, c.name) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s)
    const els = cmdOnly || !q ? [] : this.tree.els.map((e, i) => ({ i, s: i > 0 ? elementScore(q, e) : -1 })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 12)
    this.items = [
      ...els.map(({ i }) => ({ label: this.tree.els[i].title, sub: pathOf(this.tree, i), kind: this.tree.els[i].kind, run: (shift: boolean) => this.warp(i, shift) })),
      ...cmds.slice(0, cmdOnly || !q ? 12 : 4).map(({ c }) => ({ label: c.name, sub: c.hint ?? '', kind: 'command', run: () => c.run() })),
    ]
    this.active = 0
    this.list.replaceChildren(...this.items.map((it, k) => {
      const row = el('div', k === 0 ? 'row on' : 'row')
      row.append(el('span', 'kind', it.kind), el('b', '', it.label), el('span', 'sub', it.sub))
      row.onmousedown = e => { e.preventDefault(); this.close(); it.run(e.shiftKey) }
      return row
    }))
  }
}

export interface RadialItem { label: string; key?: string; disabled?: boolean; run: () => void }

/**
 * Command wheel: right-click opens it around the cursor; click an item, or hold the right
 * button, flick toward an item and release.
 */
export class Radial {
  private root = el('div', 'radial')
  private items: { e: HTMLElement; item: RadialItem }[] = []
  isOpen = false
  private cx = 0
  private cy = 0

  constructor() {
    document.body.append(this.root)
    window.addEventListener('pointermove', e => this.isOpen && this.highlight(this.pick(e.clientX, e.clientY)))
    window.addEventListener('pointerdown', e => { if (this.isOpen && !this.root.contains(e.target as Node)) this.close() }, true)
  }

  open(x: number, y: number, title: string, items: RadialItem[]) {
    this.cx = Math.min(Math.max(x, 140), innerWidth - 140)
    this.cy = Math.min(Math.max(y, 140), innerHeight - 140)
    this.root.style.left = `${this.cx}px`
    this.root.style.top = `${this.cy}px`
    const hub = el('div', 'hub', title)
    this.items = items.map((item, k) => {
      const a = -Math.PI / 2 + (k / items.length) * Math.PI * 2
      const e = el('button', item.disabled ? 'item off' : 'item')
      e.append(el('span', '', item.label), ...(item.key ? [el('kbd', '', item.key)] : []))
      e.style.setProperty('--x', `${Math.cos(a) * 104}px`)
      e.style.setProperty('--y', `${Math.sin(a) * 104}px`)
      e.onclick = () => this.run(item)
      return { e, item }
    })
    this.root.replaceChildren(hub, ...this.items.map(x => x.e))
    this.isOpen = true
    this.root.classList.remove('open'); void this.root.offsetWidth
    this.root.classList.add('open')
  }

  /** Item in the direction of a point, once it is past the hub. */
  pick(x: number, y: number) {
    const dx = x - this.cx, dy = y - this.cy
    if (Math.hypot(dx, dy) < 36) return -1
    const a = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)
    return Math.round((a / (Math.PI * 2)) * this.items.length) % this.items.length
  }

  /** Release of a held right button: runs the item flicked toward. */
  release(x: number, y: number) {
    const k = this.pick(x, y)
    if (k >= 0) this.run(this.items[k].item)
  }

  private highlight(k: number) { this.items.forEach((x, j) => x.e.classList.toggle('hot', j === k)) }

  private run(item: RadialItem) {
    if (item.disabled) return
    this.close()
    item.run()
  }

  close() { this.isOpen = false; this.root.classList.remove('open') }
}

/**
 * Strategy-game tooltips: hovering a card shows one; holding still locks it, after which names
 * inside can be hovered for nested tooltips, as deep as you like.
 */
export class Tooltips {
  private stack: { node: number; e: HTMLElement; locked: boolean; at: number }[] = []
  private hoverNode = -1
  private hoverSince = 0
  private inside = false
  private linkTimer = 0

  constructor(public tree: Tree, private relations: (i: number) => { out: { other: number; title: string }[]; inn: { other: number; title: string }[] }, private go: (i: number) => void, private clock: () => number) {}

  /** Call every frame with the card under the pointer. */
  /** `node` is -1 when the pointer is off the map, which includes being over a tooltip. */
  update(node: number, x: number, y: number, now: number, busy: boolean) {
    for (const t of this.stack) if (!t.locked && now - t.at > 900) { t.locked = true; t.e.classList.add('locked') }
    if (busy) { this.closeFrom(0); this.hoverNode = -1; return }
    // Reading a tooltip: leave the stack alone, however the map's hover changes underneath.
    if (this.inside) return
    if (node !== this.hoverNode) { this.hoverNode = node; this.hoverSince = now }
    const root = this.stack[0]
    if (root && !root.locked && root.node !== node) this.closeFrom(0)
    // A locked stack survives brief detours, so the pointer can travel to it.
    if (root?.locked && node !== root.node && now - this.hoverSince > 600) this.closeFrom(0)
    if (!this.stack.length && node > 0 && now - this.hoverSince > 450) this.open(node, x + 18, y + 18, 0, now)
  }

  closeAll() { this.closeFrom(0) }

  private open(node: number, x: number, y: number, level: number, now: number) {
    this.closeFrom(level)
    const e = this.tree.els[node]
    const t = el('div', 'tip')
    const { out, inn } = this.relations(node)
    const top = (rows: { other: number; title: string }[]) => [...new Map(rows.map(r => [r.other, r])).values()].slice(0, 6)
    t.append(el('div', 'tip-kind', `${e.kind}${e.technology ? ` · ${e.technology}` : ''}`), el('div', 'tip-title', e.title))
    if (e.description) t.append(el('div', 'tip-desc', e.description.replace(/\s+/g, ' ').slice(0, 220)))
    t.append(el('div', 'tip-counts', `→ ${out.length} out · ← ${inn.length} in${this.tree.children[node].length ? ` · ${this.tree.children[node].length} inside` : ''}`))
    const section = (label: string, rows: { other: number; title: string }[]) => {
      if (!rows.length) return
      const box = el('div', 'tip-links')
      box.append(el('span', 'tip-label', label))
      for (const r of top(rows)) {
        const a = el('span', 'tip-link', this.tree.els[r.other].title)
        a.title = r.title
        a.onmouseenter = () => {
          clearTimeout(this.linkTimer)
          this.linkTimer = window.setTimeout(() => {
            const b = a.getBoundingClientRect()
            this.open(r.other, b.right + 10, b.top - 8, level + 1, this.clock())
          }, 380)
        }
        a.onmouseleave = () => clearTimeout(this.linkTimer)
        a.onclick = () => { this.closeFrom(0); this.go(r.other) }
        box.append(a)
      }
      t.append(box)
    }
    section('Calls', out)
    section('Called by', inn)
    t.append(el('div', 'tip-lock'))
    t.onmouseenter = () => { this.inside = true }
    t.onmouseleave = () => { this.inside = false }
    document.body.append(t)
    const r = t.getBoundingClientRect()
    t.style.left = `${Math.min(x, innerWidth - r.width - 12)}px`
    t.style.top = `${Math.min(y, innerHeight - r.height - 12)}px`
    this.stack.push({ node, e: t, locked: false, at: now })
  }

  private closeFrom(level: number) {
    for (const t of this.stack.splice(level)) t.e.remove()
    if (!this.stack.length) this.inside = false
  }
}

/** GPS-style directions for the route on the map; each hop is a waypoint you can jump to. */
export class RoutePanel {
  private root = el('div', 'routepanel panel')
  onStep: (k: number) => void = () => {}
  constructor(public tree: Tree) { document.body.append(this.root) }

  show(route: Hop[] | null, step: number) {
    this.root.hidden = !route
    if (!route) return
    const stops = [route[0].from, ...route.map(h => h.to)]
    const head = el('div', 'rp-head')
    head.append(el('b', '', `Route · ${route.length} hop${route.length === 1 ? '' : 's'}`), el('span', '', 'click a stop · Esc clears'))
    this.root.replaceChildren(head, ...stops.map((n, k) => {
      const row = el('button', k === step ? 'rp-stop on' : 'rp-stop')
      row.append(el('i', '', String(k + 1)), el('b', '', this.tree.els[n].title))
      if (k > 0) row.append(el('span', '', `${route[k - 1].reversed ? '← ' : ''}${route[k - 1].title}`))
      row.onclick = () => this.onStep(k)
      return row
    }))
  }
}

/** Keybinding screen, like a game's controls page. */
export class Help {
  private root = el('div', 'help-overlay')
  constructor() {
    const groups: [string, [string, string][]][] = [
      ['Mouse', [['Wheel', 'Zoom at the cursor'], ['Drag', 'Pan'], ['Click', 'Select (amber out, cyan in)'], ['Double-click', 'Fly into a card'], ['Right-click', 'Wheel: route, pin, look around'], ['Hover, hold still', 'Tooltip; names inside open more'], ['Click a cited line', 'Open its code at that line']]],
      ['Keys', [['Ctrl+K or /', 'Travel to anything, or run a command'], ['Backspace', 'Back to the last place'], [']  /  [', 'Look at what it calls / what calls it'], ['Enter', 'Go there'], ['Esc', 'Clear, then up a level'], ['?', 'This screen']]],
    ]
    const grid = el('div', 'help-grid')
    for (const [title, rows] of groups) {
      const col = el('div', 'help-col')
      col.append(el('h3', '', title))
      for (const [k, v] of rows) { const r = el('div', 'help-row'); r.append(el('kbd', '', k), el('span', '', v)); col.append(r) }
      grid.append(col)
    }
    this.root.append(el('h2', '', 'Controls'), grid, el('div', 'help-foot', 'Press ? or Esc to close'))
    this.root.onclick = () => this.toggle(false)
    document.body.append(this.root)
  }
  get isOpen() { return this.root.classList.contains('open') }
  toggle(on = !this.isOpen) { this.root.classList.toggle('open', on) }
}
