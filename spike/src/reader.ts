const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

/** A prepared file, as the code view keeps it. */
export interface Source { lines: string[]; html: string[]; cited: Set<number>; marks: Map<number, string[]> }

/** Line height of the reader's text, in px; its CSS says the same. */
const LINE_PX = 20

/**
 * Reading a file: one column of its code over the map, scrolled like any page, its text
 * selectable. The header names it with the line at the top and has Copy and the way back; a rail
 * marks the cited (amber) and marked (cyan) lines, each a click away. It opens only when asked
 * (double-click, Enter, Read code, a cited line); the wheel on the map never opens it.
 */
export class Reader {
  private root = el('section', 'reader')
  private title = el('div', 'reader-title')
  private where = el('code', 'reader-where')
  private copy = el('button', '', 'Copy path:line')
  private backBtn = el('button', 'reader-back')
  private scroller = el('div', 'reader-scroll')
  private pre = el('pre')
  private rail = el('div', 'reader-rail')
  private path = ''
  private total = 0
  /** Called with the line at the top as the reader scrolls, and with 0 when it closes. */
  onLine: (line: number) => void = () => {}
  onClose: () => void = () => {}

  constructor() {
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-modal', 'false')
    this.root.hidden = true
    const head = el('header', 'reader-head')
    const actions = el('div', 'reader-actions')
    const close = el('button', 'reader-close', 'Close')
    close.title = 'Close the code (Esc)'
    close.onclick = () => this.close()
    this.backBtn.onclick = () => this.close()
    this.copy.onclick = () => {
      void navigator.clipboard?.writeText(`${this.path}:${this.line}`).then(() => { this.copy.textContent = 'Copied'; setTimeout(() => { this.copy.textContent = 'Copy path:line' }, 1200) }, () => {})
    }
    actions.append(this.copy, close)
    const names = el('div', 'reader-names')
    names.append(this.backBtn, this.title, this.where)
    head.append(names, actions)
    this.scroller.tabIndex = 0
    this.scroller.append(this.pre)
    const body = el('div', 'reader-body')
    body.append(this.scroller, this.rail)
    this.root.append(head, body)
    this.root.addEventListener('keydown', e => {
      if (e.key === 'Escape') { this.close(); e.stopPropagation() }
    })
    // The line named is the one a third of the way down, where an opened line sits; the reader's
    // own scrolling (opening, going to a line) names the line it went to.
    let pending = 0
    this.scroller.addEventListener('scroll', () => {
      if (Math.abs(this.scroller.scrollTop - this.expect) < 2) return
      cancelAnimationFrame(pending)
      pending = requestAnimationFrame(() => this.name(this.lineAt()))
    })
    document.body.append(this.root)
  }

  get isOpen() { return !this.root.hidden }

  /** Where the reader last scrolled itself to: a scroll event there is its own, not the reader's. */
  private expect = 0
  private line = 1
  private lineAt() { return Math.max(1, Math.min(this.total, Math.floor((this.scroller.scrollTop + this.scroller.clientHeight / 3) / LINE_PX) + 1)) }
  private name(n: number) { this.line = n; this.where.textContent = `${this.path}:${n}`; this.onLine(n) }

  /** Opens `path` (shown as `title`, inside `parent`) at `line`, or says why it cannot. */
  open(path: string, title: string, parent: string, line: number, src: Source | null, retry: () => void) {
    this.path = path
    this.title.textContent = title
    this.backBtn.textContent = `← back to ${parent}`
    this.root.setAttribute('aria-label', `Code of ${path}`)
    this.root.hidden = false
    this.rail.replaceChildren()
    if (!src) {
      this.total = 0
      this.where.textContent = path
      const again = el('button', '', 'Try again')
      again.onclick = retry
      const box = el('div', 'reader-none')
      box.append(el('p', '', 'Source unavailable: the viewer could not fetch this file.'), again)
      this.pre.replaceChildren(box)
      return
    }
    this.total = src.lines.length
    this.pre.innerHTML = src.html.join('')
    // The rail: a tick per cited or marked line, where it falls in the file.
    for (const n of new Set([...src.cited, ...src.marks.keys()])) {
      if (n < 1 || n > this.total) continue
      const t = el('button', src.cited.has(n) ? 'cited' : 'mark')
      t.style.top = `${((n - 1) / this.total) * 100}%`
      t.title = `Line ${n}${src.marks.get(n) ? ` · ${src.marks.get(n)!.join(', ')}` : ''}${src.cited.has(n) ? ' · cited' : ''}`
      t.onclick = () => this.goto(n)
      this.rail.append(t)
    }
    this.goto(line)
    this.scroller.focus({ preventScroll: true })
  }

  /** Scrolls so line n sits a third of the way down, and marks it. */
  goto(n: number) {
    const k = Math.max(1, Math.min(this.total, n))
    for (const s of this.pre.querySelectorAll('.at')) s.classList.remove('at')
    this.pre.children[k - 1]?.classList.add('at')
    this.scroller.scrollTop = Math.max(0, (k - 1) * LINE_PX - this.scroller.clientHeight / 3)
    this.expect = this.scroller.scrollTop
    this.name(k)
  }

  close() {
    if (this.root.hidden) return
    this.root.hidden = true
    this.pre.replaceChildren()
    this.onLine(0)
    this.onClose()
  }
}
