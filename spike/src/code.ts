import type { Tree } from './model'

/** Where a file card shows its source this frame, in screen px. */
export interface CodeSlot { i: number; x: number; y: number; w: number; h: number; alpha: number }

/** The code is laid out once at this size and scaled; lines and characters in multiples of it. */
const BASE_PX = 16
const LINE = 1.45
const CHAR = 0.6
/** Wider lines are clipped: the shape of the code matters more than its far right. */
const MAX_COLS = 120
/** Below this on-screen font size the text is noise, not a minimap. */
const MIN_PX = 1.2

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

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A file as numbered lines, cited ones marked, flowed into `columns` columns. */
export function codeHtml(text: string, cited: Set<number> = new Set(), columns = 1) {
  const lines = text.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  const pad = String(lines.length).length
  const spans = lines.map((l, k) => `<span${cited.has(k + 1) ? ' class="cited"' : ''}><i>${String(k + 1).padStart(pad)}</i>${escape(l) || ' '}</span>`)
  const cols = Math.max(...lines.map(l => l.length)) + pad + 1
  const per = Math.ceil(lines.length / columns), width = colChars(cols) * CHAR * BASE_PX
  let html = ''
  for (let c = 0; c < columns; c++) html += `<div style="width:${width}px">${spans.slice(c * per, (c + 1) * per).join('')}</div>`
  return { html, lines: lines.length, cols }
}

interface Shown { wrap: HTMLDivElement; pre: HTMLPreElement; path: string | null }
type Source = { text: string; lines: number; cols: number; html: Map<number, string> } | 'loading' | null

/**
 * Past a file card's last level, the file itself: its whole source, scaled to fill the lower part
 * of the card, so it reads as a minimap at first and as code once zoomed in. The dev server serves
 * it from the mapped repository; without one (a static build) cards stay as they are.
 */
export class CodeView {
  private shown: Shown[] = []
  private sources = new Map<string, Source>()
  private cited = new Map<string, Set<number>>()

  constructor(private root: HTMLElement, private model: string, private tree: Tree) {
    this.cited = citedLines(tree)
  }

  /** A new model version: its files may have changed, and so may what they cite. */
  reset(tree: Tree) {
    this.tree = tree
    this.cited = citedLines(tree)
    this.sources.clear()
    for (const s of this.shown) s.path = null
  }

  private load(path: string) {
    this.sources.set(path, 'loading')
    fetch(`${import.meta.env.BASE_URL}source/${this.model}?path=${encodeURIComponent(path)}`)
      .then(r => (r.ok ? r.text() : null))
      .then(text => {
        if (text == null) return this.sources.set(path, null)
        const { lines, cols } = codeHtml(text)
        this.sources.set(path, { text, lines, cols, html: new Map() })
      })
      .catch(() => this.sources.set(path, null))
  }

  update(slots: CodeSlot[], W: number, H: number) {
    let k = 0
    for (const slot of slots) {
      const path = this.tree.els[slot.i]?.metadata?.path
      if (!path) continue
      if (!this.sources.has(path)) this.load(path)
      const src = this.sources.get(path)
      if (!src || src === 'loading') continue
      const { columns, px } = codeLayout(src.lines, src.cols, slot.w, slot.h)
      if (px < MIN_PX) continue
      const s = (this.shown[k] ??= this.make())
      k++
      // A card keeps its shape while zooming, so its column count, and this markup, rarely change.
      const key = `${path}|${columns}`
      if (s.path !== key) {
        if (!src.html.has(columns)) src.html.set(columns, codeHtml(src.text, this.cited.get(path), columns).html)
        s.pre.innerHTML = src.html.get(columns)!
        s.path = key
      }
      // Only the visible part of the card gets a box, however far it is zoomed; the code moves inside it.
      const x0 = Math.max(slot.x, 0), y0 = Math.max(slot.y, 0)
      const x1 = Math.min(slot.x + slot.w, W), y1 = Math.min(slot.y + slot.h, H)
      if (x1 <= x0 || y1 <= y0) { s.wrap.hidden = true; continue }
      s.wrap.hidden = false
      s.wrap.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;opacity:${slot.alpha}`
      s.pre.style.transform = `translate(${slot.x - x0}px,${slot.y - y0}px) scale(${px / BASE_PX})`
    }
    for (let j = k; j < this.shown.length; j++) this.shown[j].wrap.hidden = true
  }

  private make(): Shown {
    const wrap = document.createElement('div')
    wrap.className = 'code'
    const pre = document.createElement('pre')
    wrap.append(pre)
    this.root.append(wrap)
    return { wrap, pre, path: null }
  }
}
