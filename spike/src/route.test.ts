import { describe, expect, it } from 'vitest'
import { ChannelGrid, simplify, type Rect } from './route'

const card = (x: number, y: number): Rect => ({ x, y, w: 100, h: 60 })

/** True if any segment of the polyline passes through a card's interior. */
function crosses(pts: number[], cards: Rect[]) {
  for (let k = 2; k < pts.length; k += 2) {
    const ax = Math.min(pts[k - 2], pts[k]), bx = Math.max(pts[k - 2], pts[k])
    const ay = Math.min(pts[k - 1], pts[k + 1]), by = Math.max(pts[k - 1], pts[k + 1])
    for (const c of cards) {
      const inX = ax === bx ? ax > c.x && ax < c.x + c.w : ax < c.x + c.w && bx > c.x
      const inY = ay === by ? ay > c.y && ay < c.y + c.h : ay < c.y + c.h && by > c.y
      if (inX && inY) return true
    }
  }
  return false
}

const orthogonal = (pts: number[]) => {
  for (let k = 2; k < pts.length; k += 2) if (pts[k] !== pts[k - 2] && pts[k + 1] !== pts[k - 1]) return false
  return true
}

describe('ChannelGrid', () => {
  // 3×2 grid with 40-unit gutters.
  const cards = [card(0, 0), card(140, 0), card(280, 0), card(0, 100), card(140, 100), card(280, 100)]
  const g = new ChannelGrid(cards, 20)

  it('joins neighbours with a straight line between facing sides', () => {
    const r = g.route(cards[0], cards[1])!
    expect(r.pts).toEqual([100, 30, 140, 30])
    expect([r.from, r.to]).toEqual([1, 3])
  })

  it('routes around a card in the way, orthogonally, never through a card', () => {
    const r = g.route(cards[0], cards[2])!
    expect(orthogonal(r.pts)).toBe(true)
    expect(crosses(r.pts, cards)).toBe(false)
    expect(r.pts.slice(0, 2)).toEqual(g.port(cards[0], r.from))
    expect(r.pts.slice(-2)).toEqual(g.port(cards[2], r.to))
  })

  it('reaches diagonal cards through the gutters', () => {
    const r = g.route(cards[0], cards[5])!
    expect(orthogonal(r.pts)).toBe(true)
    expect(crosses(r.pts, cards)).toBe(false)
  })

  it('shares trunk segments between routes that use the same set', () => {
    const used = new Set<number>()
    const a = g.route(cards[0], cards[2], used)!
    const b = g.route(cards[3], cards[2], used)!
    expect(crosses(a.pts, cards) || crosses(b.pts, cards)).toBe(false)
    expect(used.size).toBeGreaterThan(0)
  })

  it('exits to the ring beyond all cards on the requested side', () => {
    const r = g.exit(cards[4], 0, 190)!
    expect(orthogonal(r.pts)).toBe(true)
    expect(crosses(r.pts, cards)).toBe(false)
    expect(r.pts.slice(-2)).toEqual([190, -20])
  })
})

describe('simplify', () => {
  it('drops duplicates and collinear points', () => {
    expect(simplify([0, 0, 0, 0, 5, 0, 10, 0, 10, 5, 10, 9])).toEqual([0, 0, 10, 0, 10, 9])
  })
})
