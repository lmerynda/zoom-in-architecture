import type { Tree } from '../model'

/** A camera view to come back to; the selection is an element id, stable across model versions. */
export interface View { x: number; y: number; z: number; selected: string | null }

/** Back/forward through places visited, like a browser or an RPG's "return to last location". */
export class History {
  back: View[] = []
  forward: View[] = []

  /** Records leaving `from`; views close to the last entry are not duplicated. */
  push(from: View, viewportW: number) {
    const last = this.back[this.back.length - 1]
    if (last && same(last, from, viewportW)) return
    this.back.push(from)
    if (this.back.length > 100) this.back.shift()
    this.forward = []
  }

  goBack(current: View): View | null {
    const v = this.back.pop()
    if (v) this.forward.push(current)
    return v ?? null
  }

  goForward(current: View): View | null {
    const v = this.forward.pop()
    if (v) this.back.push(current)
    return v ?? null
  }
}

/** Whether two views are the same place: one selection, about the same zoom and spot. */
export function same(a: View, b: View, viewportW: number) {
  return a.selected === b.selected && Math.abs(Math.log(a.z / b.z)) < 0.2 && Math.hypot(a.x - b.x, a.y - b.y) * a.z < viewportW * 0.15
}

/**
 * Fuzzy score of `query` against `text`: every query character must appear in order. Matches
 * at word starts and consecutive runs score higher; -1 means no match.
 */
export function fuzzy(query: string, text: string): number {
  // A space in the query stands for any separator, or none: "sign in" finds "sign-in" and "SignIn".
  const q = query.toLowerCase().replace(/\s+/g, ''), t = text.toLowerCase()
  if (!q) return 0
  let score = 0, ti = 0, run = 0
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    let found = -1
    for (let j = ti; j < t.length; j++) if (t[j] === c) { found = j; break }
    if (found < 0) return -1
    const wordStart = found === 0 || /[\s._/-]/.test(text[found - 1]) || (text[found] >= 'A' && text[found] <= 'Z' && text[found - 1] >= 'a' && text[found - 1] <= 'z')
    run = found === ti ? run + 1 : 0
    score += 1 + (wordStart ? 6 : 0) + run * 3 - Math.min(found - ti, 8) * 0.3
    ti = found + 1
  }
  return score - t.length * 0.02
}

/**
 * How well a query finds an element: by its title, its id, or a feature it carries; failing
 * those, by its description or file path holding the query as written (separators aside), which
 * ranks below any name match.
 */
export function elementScore(query: string, e: { title: string; id: string; features?: string[]; description?: string; metadata?: Record<string, string> }): number {
  const named = Math.max(fuzzy(query, e.title), fuzzy(query, e.id) - 4, ...(e.features ?? []).map(f => fuzzy(query, f) - 1))
  if (named >= 0) return named
  const q = squash(query)
  if (q.length < 3) return -1
  if (squash(e.metadata?.path ?? '').includes(q)) return 0.5
  if (squash(e.description ?? '').includes(q)) return 0.25
  return -1
}
const squash = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')
