/** A camera view to come back to; the selection is an element id, stable across model versions. */
export interface View { x: number; y: number; z: number; selected: string | null; here?: string | null }

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

/** Words of a text, lower case, plurals folded: "Spies and reports" → spy, and, report. */
export function words(s: string): string[] {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem)
}
const stem = (w: string) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

/**
 * How well `query` names `text`, in tiers that never mix: the whole of it (100), its start (80),
 * the starts of its words (60), anywhere inside it (40), and last, its letters in order (under 20).
 * Plurals and separators do not count: "spy" names "Spies and reports" by a word's start. -1: no match.
 */
export function match(query: string, text: string): number {
  const qw = words(query), tw = words(text)
  if (!qw.length || !tw.length) return -1
  const q = qw.join(''), t = tw.join('')
  if (q === t) return 100
  if (t.startsWith(q)) return 80 + Math.min(10, (10 * q.length) / t.length)
  // Every query word starts a word of the text, in order.
  let k = 0
  for (const w of tw) if (k < qw.length && w.startsWith(qw[k])) k++
  if (k === qw.length) return 60 + Math.min(10, (10 * q.length) / t.length)
  if (t.includes(q)) return 40
  const f = fuzzy(query, text)
  return f < 0 ? -1 : Math.min(19, f / 3)
}

export interface Searchable { title: string; id: string; features?: string[]; description?: string; metadata?: Record<string, string> }
export interface Found { features: { name: string; score: number; cards: number[] }[]; parts: { i: number; score: number }[]; files: { i: number; score: number }[] }

/**
 * Search over a map: its features, its parts (any card that is not a file) and its files, each
 * ranked by `match` on its name. A file is also found by its path, and an exact path wins
 * outright; a description holding the query as written comes last. Element 0 (the landscape) is
 * never a result.
 */
export function searchMap(els: Searchable[], query: string, limit = 12): Found {
  const q = query.trim()
  const out: Found = { features: [], parts: [], files: [] }
  if (!q) return out
  const qs = q.toLowerCase().replaceAll('\\', '/')
  const feats = new Map<string, number[]>()
  els.forEach((e, i) => { if (i) for (const f of e.features ?? []) feats.set(f, [...(feats.get(f) ?? []), i]) })
  for (const [name, cards] of feats) { const s = match(q, name); if (s >= 0) out.features.push({ name, score: s, cards }) }
  els.forEach((e, i) => {
    if (!i) return
    const path = e.metadata?.path
    // A card carrying a matching feature is found too, a tier below the feature itself.
    let s = Math.max(match(q, e.title), match(q, e.id.split('.').pop() ?? '') - 5, ...(e.features ?? []).map(f => { const m = match(q, f); return m < 0 ? -1 : m - 30 }))
    if (path) {
      const p = path.toLowerCase()
      if (p === qs || p.endsWith(`/${qs}`)) s = Math.max(s, 110)
      else if (qs.length >= 3 && p.includes(qs)) s = Math.max(s, 35)
    }
    if (s < 0 && q.length >= 3 && (e.description ?? '').toLowerCase().includes(q.toLowerCase())) s = 5
    if (s >= 0) (path ? out.files : out.parts).push({ i, score: s })
  })
  const by = (a: { score: number }, b: { score: number }) => b.score - a.score
  out.features.sort(by); out.parts.sort(by); out.files.sort(by)
  out.features.splice(limit); out.parts.splice(limit); out.files.splice(limit)
  return out
}
