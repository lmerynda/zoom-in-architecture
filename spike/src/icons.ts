import { Graphics } from 'pixi.js'
import type { ElementJson } from './model'

export const GLYPHS = ['person', 'database', 'queue', 'browser', 'mobile', 'app', 'system', 'library', 'component', 'external', 'code'] as const
export type Glyph = (typeof GLYPHS)[number]

/**
 * The icon that says what an element is. The shape is the strongest hint (maps and LikeC4 both
 * set it for people and stores); otherwise the kind's name is matched, so sample vocabularies
 * (service, container, softwaresystem, existingsystem) find their icon too.
 */
export function glyphOf(el: Pick<ElementJson, 'kind' | 'shape'>): Glyph | null {
  const byShape: Record<string, Glyph> = { person: 'person', storage: 'database', cylinder: 'database', queue: 'queue', browser: 'browser', mobile: 'mobile' }
  if (byShape[el.shape]) return byShape[el.shape]
  const k = el.kind.toLowerCase()
  if (/external|existing/.test(k)) return 'external'
  if (/system|enterprise|domain/.test(k)) return 'system'
  if (/app|service|container/.test(k)) return 'app'
  if (/librar|package/.test(k)) return 'library'
  if (/component|module/.test(k)) return 'component'
  if (k === 'code') return 'code'
  return null
}

/** Draws a glyph in white on a 64 × 64 canvas, for baking into a texture that cards tint. */
export function drawGlyph(name: Glyph): Graphics {
  const g = new Graphics()
  const line = { width: 5, color: 0xffffff, join: 'round' as const, cap: 'round' as const }
  switch (name) {
    case 'person':
      g.circle(32, 19, 11).fill(0xffffff)
      g.moveTo(10, 58).bezierCurveTo(10, 36, 54, 36, 54, 58).closePath().fill(0xffffff)
      break
    case 'database':
      g.moveTo(12, 14).lineTo(12, 50).bezierCurveTo(12, 59, 52, 59, 52, 50).lineTo(52, 14).stroke(line)
      g.ellipse(32, 14, 20, 7).stroke(line)
      g.moveTo(12, 32).bezierCurveTo(12, 41, 52, 41, 52, 32).stroke(line)
      break
    case 'queue':
      g.roundRect(5, 20, 54, 24, 12).stroke(line)
      g.moveTo(25, 26).lineTo(25, 38).moveTo(39, 26).lineTo(39, 38).stroke(line)
      break
    case 'browser':
      g.roundRect(6, 10, 52, 44, 7).stroke(line)
      g.moveTo(6, 23).lineTo(58, 23).stroke(line)
      g.circle(14, 16.5, 2.6).circle(22, 16.5, 2.6).fill(0xffffff)
      break
    case 'mobile':
      g.roundRect(18, 5, 28, 54, 7).stroke(line)
      g.moveTo(28, 50).lineTo(36, 50).stroke(line)
      break
    case 'app':
      g.roundRect(7, 9, 50, 46, 8).stroke(line)
      g.moveTo(18, 24).lineTo(27, 32).lineTo(18, 40).moveTo(32, 41).lineTo(44, 41).stroke(line)
      break
    case 'system':
      g.roundRect(5, 5, 54, 54, 9).stroke(line)
      g.roundRect(15, 15, 15, 15, 3).roundRect(34, 15, 15, 15, 3).roundRect(15, 34, 34, 15, 3).fill(0xffffff)
      break
    case 'library':
      g.roundRect(8, 9, 48, 12, 4).roundRect(8, 26, 48, 12, 4).roundRect(8, 43, 48, 12, 4).stroke(line)
      break
    case 'component':
      g.roundRect(8, 8, 21, 21, 4).roundRect(35, 8, 21, 21, 4).roundRect(8, 35, 21, 21, 4).fill(0xffffff)
      g.roundRect(37, 37, 17, 17, 4).stroke(line)
      break
    case 'external':
      g.circle(32, 32, 23).stroke(line)
      g.ellipse(32, 32, 10, 23).stroke(line)
      g.moveTo(9, 32).lineTo(55, 32).stroke(line)
      break
    case 'code':
      g.moveTo(40, 6).lineTo(14, 6).lineTo(14, 58).lineTo(50, 58).lineTo(50, 16).closePath().stroke(line)
      g.moveTo(22, 30).lineTo(42, 30).moveTo(22, 40).lineTo(42, 40).moveTo(22, 50).lineTo(34, 50).stroke(line)
      break
  }
  return g
}
