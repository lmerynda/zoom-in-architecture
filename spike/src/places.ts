import { same, type View } from './controls/logic'

/**
 * What a place is in words, for its address: the selected card (`at`), else the card you are in
 * (`in`); a file and line when reading code; the lens.
 */
export interface PlaceWords { at: string | null; in?: string | null; file?: string | null; line?: number | null; lens?: string | null }

/** The address of a place: the page's model and view, then the place's own words. */
export function placeUrl(search: string, w: PlaceWords): string {
  const q = new URLSearchParams(search)
  for (const k of ['at', 'in', 'file', 'line', 'lens']) q.delete(k)
  if (w.at) q.set('at', w.at)
  else if (w.in) q.set('in', w.in)
  if (w.file) q.set('file', w.file)
  if (w.line && w.line > 1) q.set('line', String(w.line))
  if (w.lens && w.lens !== 'structure') q.set('lens', w.lens)
  return `?${q.toString().replace(/%2F/g, '/')}`
}

interface Entry extends View { k: number }

/**
 * Places are the browser's history: every place you leave is an entry, so the browser's Back and
 * Forward work like the map's, the address names where you are, and a link opens there. The
 * current entry follows the view as it moves; leaving it pushes a new one. Camera and selection
 * live in the entry's state; the address holds only words (a card's id, a file, a line, a lens).
 */
export class Places {
  /** Called when the browser moves to another entry: fly there. */
  onGo: (v: View) => void = () => {}

  constructor(private words: (v: View) => PlaceWords, private viewportW: () => number) {
    addEventListener('popstate', e => { const s = e.state as Entry | null; if (s && typeof s.z === 'number') this.onGo(s) })
  }

  private get k() { return (history.state as Entry | null)?.k ?? 0 }

  /** The current entry becomes this view, without adding one. */
  update(v: View) {
    this.moved(v)
    const url = placeUrl(location.search, this.words(v))
    history.replaceState({ ...v, k: this.k } satisfies Entry, '', url)
  }

  /** Where the current entry started, while nothing has moved since: leaving it again adds nothing. */
  private fresh: View | null = null

  /**
   * Leaving `from` for `to` (by default, for wherever the view goes next): `from` keeps its entry
   * and `to` gets a new one. Leaving a place just arrived at, before it moved, adds nothing.
   */
  record(from: View, to: View = from) {
    if (this.fresh && same(this.fresh, from, this.viewportW())) return
    const k = this.k
    history.replaceState({ ...from, k } satisfies Entry, '', placeUrl(location.search, this.words(from)))
    history.pushState({ ...to, k: k + 1 } satisfies Entry, '', placeUrl(location.search, this.words(to)))
    this.fresh = to === from ? from : null
  }

  /** The view moved on from where its entry started. */
  moved(v: View) { if (this.fresh && !same(this.fresh, v, this.viewportW())) this.fresh = null }

  /** Back one place; false when this is the first place of the visit. */
  back(): boolean {
    if (this.k <= 0) return false
    history.back()
    return true
  }

  forward() { history.forward() }
}
