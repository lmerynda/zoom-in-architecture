import { heatColor, type Lens, type LensName } from './lens'

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag)
  e.className = cls
  e.textContent = text
  return e
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

/** How long ago, in the largest whole unit: "4 min ago", "2 h ago", "3 days ago". */
export function ago(at: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(at)) / 1000)
  if (!Number.isFinite(s)) return ''
  const [n, unit] = s < 60 ? [0, 'just now'] : s < 3600 ? [Math.floor(s / 60), 'min'] : s < 86400 ? [Math.floor(s / 3600), 'h'] : [Math.floor(s / 86400), 'day']
  return n === 0 ? 'just now' : `${n} ${unit === 'day' && n > 1 ? 'days' : unit} ago`
}
