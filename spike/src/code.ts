import type { Tree } from './model'
import { langOf, tokenize, type Lang, type LineState, type Token, type TokenKind } from './syntax'

/** Where a file card shows its source this frame, in screen px. */
export interface CodeSlot { i: number; x: number; y: number; w: number; h: number; alpha: number }

/** The code is laid out once at this size and scaled; lines and characters in multiples of it. */
const BASE_PX = 16
const LINE = 1.45
const CHAR = 0.6
const LINE_PX = LINE * BASE_PX
const CHAR_PX = CHAR * BASE_PX
/** Wider lines are clipped: the shape of the code matters more than its far right. */
const MAX_COLS = 120
/** Below this on-screen font size the code is noise, not a minimap. */
const MIN_PX = 1.2
/** From this on-screen font size the code is text; below it, a drawn minimap of the same layout. */
const TEXT_PX = 6
/** Lines prepared, or drawn, per slice of work between frames. */
const SLICE = 600
/** Lines rendered beyond the view, so small moves need no new markup. */
const MARGIN = 0.5
/** Largest side of a minimap canvas, in canvas pixels. */
const MAX_CANVAS = 4096

/** Lines that links cite as evidence, per file path. */
export function citedLines(tree: Tree): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()
  for (const evs of tree.relEvidence) for (const ev of evs ?? []) {
    const m = ev.at.match(/^(.+?):(\d+)(?:-(\d+))?$/)
    if (!m) continue
    const set = out.get(m[1]) ?? out.set(m[1], new Set()).get(m[1])!
    for (let k = Number(m[2]); k <= Number(m[3] ?? m[2]); k++) set.add(k)
  }
  return out
}

/** Characters between columns. */
const GAP = 4
const MAX_COLUMNS = 12
/** Width of one column in characters: the widest line, within bounds. */
const colChars = (cols: number) => Math.min(MAX_COLS, Math.max(40, cols))
/** Distance from one column's left edge to the next, in layout px. */
const pitch = (cols: number) => (colChars(cols) + GAP) * CHAR_PX

/**
 * How to lay `lines` lines of up to `cols` characters into a w × h box: in as many columns as
 * make the text largest, like a newspaper, and the on-screen font size that gives.
 */
export function codeLayout(lines: number, cols: number, w: number, h: number): { columns: number; px: number } {
  let best = { columns: 1, px: 0 }
  for (let c = 1; c <= Math.min(MAX_COLUMNS, lines); c++) {
    const px = Math.min(h / (Math.ceil(lines / c) * LINE), w / ((c * colChars(cols) + (c - 1) * GAP) * CHAR))
    if (px > best.px) best = { columns: c, px }
  }
  return best
}

/** A file card this wide on screen shows its source: small enough that a file you travel to already shows it. */
export const CODE_W = 280
/** The code fills the card below this fraction of its height; title, kind and description sit above. */
const CODE_TOP = 0.4
/** The text padding of a card, as a fraction of its width (as the renderer lays it out). */
const CARD_PAD = 0.07

/** Where a file card of rect x, y, w, h shows its code: the same in screen px or world units. */
export function codeBox(x: number, y: number, w: number, h: number) {
  const pad = CARD_PAD * w, top = y + h * CODE_TOP
  return { x: x + pad, y: top, w: w - 2 * pad, h: y + h - pad * 0.6 - top }
}

/** Left edge of the laid-out code inside a box: a long file is narrower than the card, and centred. */
const codeLeft = (box: { x: number; w: number }, cols: number, columns: number, scale: number) =>
  box.x + Math.max(0, (box.w - (columns * pitch(cols) - GAP * CHAR_PX) * scale) / 2)

/**
 * Where line `line` of a file sits on its card of world rect x, y, w, h: the world point at the
 * start of its text, and its font size in world units (on-screen px = font × zoom).
 */
export function linePoint(x: number, y: number, w: number, h: number, lines: number, cols: number, line: number) {
  const box = codeBox(x, y, w, h)
  const { columns, px } = codeLayout(lines, cols, box.w, box.h)
  const scale = px / BASE_PX, per = Math.ceil(lines / columns), k = Math.max(0, Math.min(lines, line) - 1)
  const left = codeLeft(box, cols, columns, scale)
  return {
    x: left + (Math.floor(k / per) * pitch(cols) + colChars(cols) * CHAR_PX * 0.4) * scale,
    y: box.y + ((k % per) + 0.5) * LINE_PX * scale,
    font: px,
  }
}

/** Rows (within each column) and columns that a view of layout rect [x0, x1] × [y0, y1] needs. */
export interface Window { c0: number; c1: number; r0: number; r1: number }

/**
 * The part of a laid-out file in view, widened by `margin` (a fraction of the view) on each side,
 * and clamped to the file. Columns hold `per` rows each.
 */
export function viewWindow(x0: number, x1: number, y0: number, y1: number, cols: number, columns: number, per: number, margin = 0): Window {
  const mx = (x1 - x0) * margin, my = (y1 - y0) * margin
  return {
    c0: Math.max(0, Math.floor((x0 - mx) / pitch(cols))),
    c1: Math.min(columns - 1, Math.floor((x1 + mx) / pitch(cols))),
    r0: Math.max(0, Math.floor((y0 - my) / LINE_PX)),
    r1: Math.min(per, Math.ceil((y1 + my) / LINE_PX)),
  }
}

const covers = (a: Window, b: Window) => a.c0 <= b.c0 && a.c1 >= b.c1 && a.r0 <= b.r0 && a.r1 >= b.r1

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The graph's marked lines of a file (routes, calls, stores…), from its `marks` metadata: "12:route 40:call". */
export function parseMarks(marks = ''): Map<number, string[]> {
  const out = new Map<number, string[]>()
  for (const m of marks.split(' ')) {
    const [line, kind] = m.split(':')
    if (kind) out.set(Number(line), [...(out.get(Number(line)) ?? []), kind])
  }
  return out
}

export interface CodeMarks { cited?: Set<number>; marks?: Map<number, string[]>; lang?: Lang }

/** A file's lines as the code view shows them: tabs expanded, no trailing empty line. */
export function splitLines(text: string): string[] {
  const lines = text.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Line `n` as markup: its number, coloured tokens, and its marks. A line a link cites is
 * highlighted, and a line the graph marked carries its kinds (route, call, store…) at the end.
 */
export function lineHtml(n: number, pad: number, tokens: Token[], cited: boolean, kinds?: string[]): string {
  const cls = [cited && 'cited', kinds && 'mark'].filter(Boolean).join(' ')
  const body = tokens.map(([kind, t]) => (kind ? `<em class="${kind}">${escape(t)}</em>` : escape(t))).join('')
  const tags = kinds ? kinds.map(kind => `<b>${kind}</b>`).join('') : ''
  return `<span${cls ? ` class="${cls}"` : ''}><i>${String(n).padStart(pad)}</i>${body || ' '}${tags}</span>`
}

/** Minimap colours per token kind, as in the text view's styles. */
const INK: Record<TokenKind, string> = { '': '#94a3b8', kw: '#c4b5fd', str: '#86efac', com: '#475569', num: '#fdba74', ty: '#7dd3fc' }

/** A file fetched and prepared in slices: tokens and markup per line, and minimaps per column count. */
interface Source {
  lines: string[]
  tokens: Token[][]
  html: string[]
  cols: number
  pad: number
  cited: Set<number>
  marks: Map<number, string[]>
  ready: boolean
  maps: Map<number, HTMLCanvasElement | 'drawing'>
}

interface Shown { wrap: HTMLDivElement; pre: HTMLPreElement; map: HTMLCanvasElement | null; key: string; win: Window | null }

/** Runs `step` until it returns false, a slice at a time, yielding to frames in between. */
function sliced(step: () => boolean) {
  const run = () => { if (step()) setTimeout(run, 0) }
  setTimeout(run, 0)
}

/**
 * Past a file card's last level, the file itself: its whole source, scaled to fill the lower part
 * of the card. Far out it is a drawn minimap of the code; closer in, text, of which only the lines
 * in view are in the page. All preparation runs in slices between frames, starting as soon as the
 * card is big enough to ask for the file, so no frame builds a whole file. The dev server serves the
 * source from the mapped repository; without one (a static build) cards stay as they are.
 */
export class CodeView {
  private shown: Shown[] = []
  private sources = new Map<string, Source | 'loading' | null>()
  private cited = new Map<string, Set<number>>()
  private fonts = new Map<number, number>()

  constructor(private root: HTMLElement, private model: string, private tree: Tree) {
    this.cited = citedLines(tree)
  }

  /** A new model version: its files may have changed, and so may what they cite and mark. */
  reset(tree: Tree) {
    this.tree = tree
    this.cited = citedLines(tree)
    this.sources.clear()
    for (const s of this.shown) s.key = ''
  }

  private load(path: string, i: number) {
    this.sources.set(path, 'loading')
    fetch(`${import.meta.env.BASE_URL}source/${this.model}?path=${encodeURIComponent(path)}`)
      .then(r => (r.ok ? r.text() : null))
      .then(text => {
        if (text == null) return this.sources.set(path, null)
        const lines = splitLines(text)
        const src: Source = {
          lines, tokens: [], html: [], pad: String(lines.length).length, ready: false, maps: new Map(),
          cols: Math.max(...lines.map(l => l.length)) + String(lines.length).length + 1,
          cited: this.cited.get(path) ?? new Set(), marks: parseMarks(this.tree.els[i]?.metadata?.marks),
        }
        this.sources.set(path, src)
        const lang = langOf(path), state: LineState = { open: '', close: '' }
        let k = 0
        sliced(() => {
          for (const end = Math.min(lines.length, k + SLICE); k < end; k++) {
            src.tokens[k] = tokenize(lines[k], lang, state)
            src.html[k] = lineHtml(k + 1, src.pad, src.tokens[k], src.cited.has(k + 1), src.marks.get(k + 1))
          }
          if (k < lines.length) return true
          src.ready = true
          return false
        })
      })
      .catch(() => this.sources.set(path, null))
  }

  /** Draws the minimap for a column count, in slices; it shows once complete. */
  private draw(src: Source, columns: number) {
    src.maps.set(columns, 'drawing')
    const per = Math.ceil(src.lines.length / columns)
    const w = columns * pitch(src.cols) - GAP * CHAR_PX, h = per * LINE_PX
    // About a canvas pixel per character, less for files too big for one canvas.
    const q = Math.min(1 / CHAR_PX, MAX_CANVAS / w, MAX_CANVAS / h)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(w * q); canvas.height = Math.ceil(h * q)
    canvas.style.cssText = `width:${w}px;height:${h}px`
    const g = canvas.getContext('2d')!
    const bar = Math.max(1, LINE_PX * q * 0.55), cw = CHAR_PX * q
    let k = 0
    sliced(() => {
      for (const end = Math.min(src.lines.length, k + SLICE); k < end; k++) {
        const x0 = Math.floor(k / per) * pitch(src.cols) * q, y = (k % per) * LINE_PX * q
        const n = k + 1
        if (src.cited.has(n) || src.marks.has(n)) {
          g.fillStyle = src.cited.has(n) ? 'rgba(251,191,36,0.35)' : 'rgba(34,211,238,0.25)'
          g.fillRect(x0, y, colChars(src.cols) * cw, LINE_PX * q)
        }
        let x = x0 + (src.pad + 1) * cw
        for (const [kind, t] of src.tokens[k]) {
          const lead = t.length - t.trimStart().length, body = t.trim().length
          if (body) { g.fillStyle = INK[kind]; g.fillRect(x + lead * cw, y + (LINE_PX * q - bar) / 2, body * cw, bar) }
          x += t.length * cw
        }
      }
      if (k < src.lines.length) return true
      src.maps.set(columns, canvas)
      return false
    })
  }

  /** On-screen font size of a file card's code last frame, if it showed any. */
  fontOf(i: number): number | undefined { return this.fonts.get(i) }

  /** A file's line count and width once it is fetched and prepared, or null if it has no source. */
  async measure(i: number): Promise<{ lines: number; cols: number } | null> {
    const path = this.tree.els[i]?.metadata?.path
    if (!path) return null
    if (!this.sources.has(path)) this.load(path, i)
    for (let t = 0; t < 200; t++) {
      const src = this.sources.get(path)
      if (src === null || src === undefined) return null
      if (src !== 'loading' && src.ready) return { lines: src.lines.length, cols: src.cols }
      await new Promise(r => setTimeout(r, 25))
    }
    return null
  }

  update(slots: CodeSlot[], W: number, H: number) {
    this.fonts.clear()
    let k = 0
    for (const slot of slots) {
      const path = this.tree.els[slot.i]?.metadata?.path
      if (!path) continue
      if (!this.sources.has(path)) this.load(path, slot.i)
      const src = this.sources.get(path)
      if (!src || src === 'loading' || !src.ready) continue
      const { columns, px } = codeLayout(src.lines.length, src.cols, slot.w, slot.h)
      this.fonts.set(slot.i, px)
      if (px < MIN_PX) continue
      // Only the visible part of the card gets a box, however far it is zoomed; the code moves inside it.
      const x0 = Math.max(slot.x, 0), y0 = Math.max(slot.y, 0)
      const x1 = Math.min(slot.x + slot.w, W), y1 = Math.min(slot.y + slot.h, H)
      if (x1 <= x0 || y1 <= y0) continue
      const text = px >= TEXT_PX
      const map = text ? null : src.maps.get(columns)
      if (!text && !map) this.draw(src, columns)
      if (!text && !(map instanceof HTMLCanvasElement)) continue

      const s = (this.shown[k] ??= this.make())
      k++
      s.wrap.hidden = false
      s.wrap.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;opacity:${slot.alpha}`
      // A long file fills the card's height and is narrower than it: centred, so zooming in on the
      // card's middle (where a fly-in aims) lands on code.
      const scale = px / BASE_PX
      const ox = codeLeft(slot, src.cols, columns, scale)
      const transform = `translate(${ox - x0}px,${slot.y - y0}px) scale(${scale})`
      if (!text) {
        if (s.map !== map) { s.pre.replaceChildren(); s.map?.remove(); s.map = map as HTMLCanvasElement; s.wrap.append(s.map); s.key = ''; s.win = null }
        s.map!.style.transform = transform
        s.pre.hidden = true
        continue
      }
      if (s.map) { s.map.remove(); s.map = null }
      s.pre.hidden = false
      s.pre.style.transform = transform
      // Text: only the lines in view (and a margin) are in the page, re-rendered when the view leaves them.
      const per = Math.ceil(src.lines.length / columns)
      const view = [(x0 - ox) / scale, (x1 - ox) / scale, (y0 - slot.y) / scale, (y1 - slot.y) / scale] as const
      const need = viewWindow(...view, src.cols, columns, per)
      const key = `${path}|${columns}`
      if (s.key !== key || !s.win || !covers(s.win, need)) {
        // Render past the view, so the next small moves (and every zoom in) need no new markup.
        const win = viewWindow(...view, src.cols, columns, per, MARGIN)
        let html = ''
        const width = colChars(src.cols) * CHAR_PX
        for (let c = win.c0; c <= win.c1; c++) {
          const from = c * per + win.r0, to = Math.min(src.lines.length, c * per + win.r1)
          if (from >= to) continue
          html += `<div style="left:${c * pitch(src.cols)}px;top:${win.r0 * LINE_PX}px;width:${width}px">${src.html.slice(from, to).join('')}</div>`
        }
        s.pre.innerHTML = html
        s.key = key
        s.win = win
      }
    }
    for (let j = k; j < this.shown.length; j++) this.shown[j].wrap.hidden = true
  }

  private make(): Shown {
    const wrap = document.createElement('div')
    wrap.className = 'code'
    const pre = document.createElement('pre')
    wrap.append(pre)
    this.root.append(wrap)
    return { wrap, pre, map: null, key: '', win: null }
  }
}
