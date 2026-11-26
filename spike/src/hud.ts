import { heatColor, type Lens, type LensName } from './lens'

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag)
  e.className = cls
  e.textContent = text
  return e
}

/**
 * Colour by: one menu button in the top bar naming the lens in use, its choices below it, and
 * under it while a lens is on, a legend with the measure, its unit and range, and what each card
 * is compared with.
 */
export class LensBar {
  private root = el('div', 'lensbar')
  private button = el('button', 'lens-current')
  private menu = el('div', 'lens-menu panel')
  private legend = el('div', 'lens-legend')
  private names: [LensName, string][]
  onPick: (name: LensName) => void = () => {}

  constructor(private lenses: Lens[]) {
    this.names = [['structure', 'Structure'], ...lenses.map(l => [l.name, l.name[0].toUpperCase() + l.name.slice(1)] as [LensName, string])]
    this.button.setAttribute('aria-haspopup', 'menu')
    this.button.setAttribute('aria-expanded', 'false')
    this.menu.setAttribute('role', 'menu')
    this.menu.id = 'lens-menu'
    this.button.setAttribute('aria-controls', this.menu.id)
    this.menu.hidden = true
    new MutationObserver(() => this.button.setAttribute('aria-expanded', String(!this.menu.hidden))).observe(this.menu, { attributes: true, attributeFilter: ['hidden'] })
    this.button.onclick = e => { e.stopPropagation(); this.menu.hidden = !this.menu.hidden; if (!this.menu.hidden) (this.menu.querySelector('.on') as HTMLElement | null)?.focus() }
    for (const [name, label] of this.names) {
      const b = el('button', '', label)
      b.setAttribute('role', 'menuitemradio')
      b.dataset.lens = name
      b.onclick = () => { this.menu.hidden = true; this.onPick(name); this.button.focus() }
      this.menu.append(b)
    }
    this.menu.addEventListener('keydown', e => {
      const items = [...this.menu.querySelectorAll('button')], k = items.indexOf(document.activeElement as HTMLButtonElement)
      if (e.key === 'ArrowDown') { items[(k + 1) % items.length].focus(); e.preventDefault() }
      if (e.key === 'ArrowUp') { items[(k - 1 + items.length) % items.length].focus(); e.preventDefault() }
      if (e.key === 'Escape') { this.menu.hidden = true; this.button.focus(); e.stopPropagation() }
    })
    addEventListener('click', e => { if (!this.root.contains(e.target as Node)) this.menu.hidden = true })
    // Tab or Shift+Tab out of the menu closes it, so it never stays open behind the focus.
    this.root.addEventListener('focusout', e => { if (!this.root.contains(e.relatedTarget as Node | null)) this.menu.hidden = true })
    const ramp = el('div', 'lens-ramp')
    ramp.style.background = `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map(v => hex(heatColor(v))).join(', ')})`
    this.legend.append(el('span', 'lens-label'), el('span', 'lens-lo'), ramp, el('span', 'lens-hi'), el('span', 'lens-range'))
    this.root.append(el('span', 'bar-label', 'Colour by'), this.button, this.menu, this.legend)
    const top = document.getElementById('top')!
    top.insertBefore(this.root, document.getElementById('help'))
  }

  show(active: Lens | null) {
    const name = active?.name ?? 'structure'
    this.button.textContent = this.names.find(([n]) => n === name)?.[1] ?? 'Structure'
    for (const b of this.menu.querySelectorAll<HTMLElement>('button')) { b.classList.toggle('on', b.dataset.lens === name); b.setAttribute('aria-checked', String(b.dataset.lens === name)) }
    this.legend.hidden = !active
    if (active) {
      // The colour compares a card with the others at its level, so the ramp's ends are the least
      // and most of a level, not numbers: the map's range is said apart, as the range it is.
      const lo = Math.min(...[...active.raw].slice(1)), hi = Math.max(...active.raw.slice(1))
      const parts = this.legend.children as HTMLCollectionOf<HTMLElement>
      parts[0].textContent = active.label
      parts[1].textContent = 'least'
      parts[3].textContent = 'most at its level'
      parts[4].textContent = `each card against the others at its level; across the map ${Math.round(lo).toLocaleString()}–${Math.round(hi).toLocaleString()} ${active.unit}`
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
