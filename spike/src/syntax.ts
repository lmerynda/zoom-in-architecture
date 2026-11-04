/**
 * Just enough syntax colouring for the code view: comments, strings, numbers, keywords and type
 * names, line by line, in the languages the graph reads. A block comment or a multi-line string
 * carries over to the next line through `state`.
 */

export type TokenKind = 'kw' | 'str' | 'com' | 'num' | 'ty' | ''
export type Token = [TokenKind, string]
export type Lang = 'c' | 'py' | 'plain'
/** What is still open at the end of a line, and the text that closes it. */
export interface LineState { open: TokenKind; close: string }

const KEYWORDS = new Set(`
  abstract as async await break case catch class const continue def default defer del delete do elif else enum
  except export extends false final finally fn for from func function go goto if impl implements import in
  instanceof interface internal is lambda let loop match mod module mut namespace new nil none None not null
  or override package pass private protected pub public raise readonly record return select self Self sealed
  static struct super switch this throw throws trait true True False try type typeof unsafe use using var
  virtual void where while with yield chan map range fallthrough unsigned crate dyn ref out params
`.trim().split(/\s+/))

export function langOf(path: string): Lang {
  if (/\.(py|pyi)$/.test(path)) return 'py'
  if (/\.(m?[jt]sx?|c[jt]s|go|java|kt|cs|rs|c|h|cpp|hpp|swift|scala|dart|php)$/.test(path)) return 'c'
  return 'plain'
}

export function tokenize(line: string, lang: Lang, state: LineState): Token[] {
  const out: Token[] = []
  const push = (kind: TokenKind, text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last[0] === kind) last[1] += text
    else out.push([kind, text])
  }
  let i = 0
  // Whatever the previous line left open runs on until its closing text.
  if (state.open) {
    const end = line.indexOf(state.close)
    if (end < 0) { push(state.open, line); return out }
    push(state.open, line.slice(0, end + state.close.length))
    i = end + state.close.length
    state.open = ''
  }
  if (lang === 'plain') { push('', line.slice(i)); return out }
  while (i < line.length) {
    const ch = line[i], rest = line.slice(i)
    if ((lang === 'c' && rest.startsWith('//')) || (lang === 'py' && ch === '#')) { push('com', rest); break }
    if (lang === 'c' && rest.startsWith('/*')) {
      const end = line.indexOf('*/', i + 2)
      if (end < 0) { push('com', rest); state.open = 'com'; state.close = '*/'; break }
      push('com', line.slice(i, end + 2)); i = end + 2; continue
    }
    if (lang === 'py' && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const q = rest.slice(0, 3), end = line.indexOf(q, i + 3)
      if (end < 0) { push('str', rest); state.open = 'str'; state.close = q; break }
      push('str', line.slice(i, end + 3)); i = end + 3; continue
    }
    if (ch === '"' || ch === "'" || (ch === '`' && lang === 'c')) {
      let j = i + 1
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1
      // A backtick string (template literal, Go raw string) may span lines; others end with the line.
      if (j >= line.length && ch === '`') { push('str', rest); state.open = 'str'; state.close = '`'; break }
      push('str', line.slice(i, j + 1)); i = j + 1; continue
    }
    const num = /^\d[\w.]*/.exec(rest)
    if (num && !/[\w$]/.test(line[i - 1] ?? '')) { push('num', num[0]); i += num[0].length; continue }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest)
    if (word) {
      const w = word[0]
      push(KEYWORDS.has(w) ? 'kw' : /^[A-Z][a-z]/.test(w) ? 'ty' : '', w)
      i += w.length
      continue
    }
    push('', ch)
    i++
  }
  return out
}
