import { heatColor, type Lens, type LensName } from './lens'
import type { Tree } from './model'

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag)
  e.className = cls
  e.textContent = text
  return e
}

/**
 * Flight-sim altimeter on the left edge: one tick per level of the tree, labelled with the
 * kinds along the path under the screen centre, and a marker that glides with the zoom.
 */
export class Altimeter {
  private root = el('div', 'alt')
  private rail = el('div', 'alt-rail')
  private marker = el('div', 'alt-marker')
  private readout = el('div', 'alt-readout')
  private ticks: HTMLElement[] = []

  constructor(private tree: Tree) {
    this.root.append(el('div', 'alt-title', 'DEPTH'), this.rail, this.readout)
    document.body.append(this.root)
    this.setTree(tree)
  }

  /** One tick per level: rebuilt when a new model version has a different depth. */
  setTree(tree: Tree) {
    this.tree = tree
    if (!this.marker.parentNode) this.rail.append(this.marker)
    for (const t of this.ticks) t.remove()
    this.ticks = []
    for (let d = 0; d <= tree.maxDepth; d++) {
      const t = el('div', 'alt-tick')
      t.style.top = `${(d / tree.maxDepth) * 100}%`
      this.rail.insertBefore(t, this.marker)
      this.ticks.push(t)
    }
  }

  update(path: number[], altitude: number, zoom: number) {
    const max = this.tree.maxDepth
    this.ticks.forEach((t, d) => {
      const label = d === 0 ? 'LANDSCAPE' : path[d - 1] != null ? this.tree.els[path[d - 1]].kind.toUpperCase() : ''
      if (t.dataset.label !== label) { t.dataset.label = label; t.textContent = label }
      t.classList.toggle('on', d <= Math.floor(altitude + 1e-6))
    })
    this.marker.style.top = `${(Math.min(max, altitude) / max) * 100}%`
    this.readout.textContent = `×${zoom < 1000 ? zoom.toFixed(zoom < 10 ? 1 : 0) : zoom.toExponential(1)}`
  }
}

/** "Entering" banner: names the region the camera settles in, like a game's area title card. */
export class Banner {
  private root = el('div', 'banner')
  private title = el('div', 'banner-title')
  private sub = el('div', 'banner-sub')
  private shown = -1
  private pending = -1
  private since = 0

  constructor(public tree: Tree) {
    this.root.append(el('div', 'banner-kicker', 'ENTERING'), this.title, this.sub)
    document.body.append(this.root)
  }

  /** Call every frame with the deepest element under the screen centre. */
  update(node: number, now: number) {
    if (node !== this.pending) { this.pending = node; this.since = now }
    if (node === this.shown || node <= 0 || now - this.since < 450) return
    this.shown = node
    const e = this.tree.els[node]
    const parent = this.tree.parent[node]
    this.title.textContent = e.title
    this.sub.textContent = [e.kind, this.tree.children[node].length ? `${this.tree.children[node].length} inside` : e.technology, parent > 0 ? `in ${this.tree.els[parent].title}` : '']
      .filter(Boolean).join(' · ')
    this.root.classList.remove('show')
    void this.root.offsetWidth
    this.root.classList.add('show')
  }
}

/** Lens picker and legend. */
export class LensBar {
  private root = el('div', 'lensbar panel')
  private legend = el('div', 'lens-legend')
  private buttons = new Map<LensName, HTMLButtonElement>()
  onPick: (name: LensName) => void = () => {}

  constructor(lenses: Lens[]) {
    const names: [LensName, string][] = [['structure', 'Structure'], ...lenses.map(l => [l.name, l.name[0].toUpperCase() + l.name.slice(1)] as [LensName, string])]
    for (const [name, label] of names) {
      const b = el('button', '', label)
      b.onclick = () => this.onPick(name)
      this.buttons.set(name, b)
      this.root.append(b)
    }
    const ramp = el('div', 'lens-ramp')
    ramp.style.background = `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map(v => hex(heatColor(v))).join(', ')})`
    this.legend.append(el('span', 'lens-label'), ramp, el('span', 'lens-range'))
    this.root.append(this.legend)
    document.getElementById('top')!.insertBefore(this.root, document.getElementById('sound'))
  }

  show(active: Lens | null) {
    for (const [name, b] of this.buttons) b.classList.toggle('on', (active?.name ?? 'structure') === name)
    this.legend.hidden = !active
    if (active) {
      ;(this.legend.children[0] as HTMLElement).textContent = active.label
      ;(this.legend.children[2] as HTMLElement).textContent = `low → high, per level`
    }
  }
}
