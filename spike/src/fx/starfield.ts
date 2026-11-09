import { Container, Sprite, Texture, TilingSprite } from 'pixi.js'
import type { Camera } from '../camera'

/** Deterministic PRNG so the sky is the same every run (and in recordings). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')!] as const
}

const TILE = 512

function starTexture(seed: number, count: number, big: number) {
  const [c, g] = canvas(TILE)
  const r = rng(seed)
  const tints = ['255,255,255', '200,220,255', '255,236,210', '180,200,255']
  for (let i = 0; i < count; i++) {
    const x = r() * TILE, y = r() * TILE, rad = 0.45 + r() * r() * 1.3
    const tint = tints[Math.floor(r() * tints.length)]
    g.fillStyle = `rgba(${tint},${0.35 + r() * 0.65})`
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill()
  }
  for (let i = 0; i < big; i++) {
    const x = r() * TILE, y = r() * TILE, rad = 5 + r() * 9
    const grad = g.createRadialGradient(x, y, 0, x, y, rad)
    grad.addColorStop(0, 'rgba(255,255,255,0.95)')
    grad.addColorStop(0.15, 'rgba(190,215,255,0.5)')
    grad.addColorStop(1, 'rgba(120,160,255,0)')
    g.fillStyle = grad
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  return Texture.from(c)
}

function vignetteTexture() {
  const [c, g] = canvas(256)
  const grad = g.createRadialGradient(128, 128, 60, 128, 128, 182)
  grad.addColorStop(0, 'rgba(2,3,8,0)')
  grad.addColorStop(1, 'rgba(2,3,8,0.5)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  return Texture.from(c)
}

interface Layer {
  /** Exponent on the camera zoom: lower is farther away, so it scales and pans slower. */
  depth: number
  alpha: number
  drift: number
  octaves: [TilingSprite, TilingSprite]
}

/**
 * A faint backdrop of stars in three planes at different depths: each plane zooms as zoom^depth,
 * so a dive or a pan reads as motion even over empty space. Kept dim, with no colour wash or glow,
 * so it never competes with the map's 1.3 px edges; two octaves per plane crossfade so the zoom
 * never runs out of sky.
 */
export class Starfield {
  readonly back = new Container()
  readonly front = new Container()
  private layers: Layer[] = []
  private vignette: Sprite

  constructor() {
    const defs = [
      { depth: 0.3, alpha: 0.22, drift: 0.004, seed: 11, count: 420, big: 0 },
      { depth: 0.55, alpha: 0.28, drift: 0.008, seed: 23, count: 200, big: 0 },
      { depth: 0.8, alpha: 0.34, drift: 0.013, seed: 37, count: 90, big: 0 },
    ]
    for (const d of defs) {
      const tex = starTexture(d.seed, d.count, d.big)
      const octaves = [0, 1].map(() => {
        const t = new TilingSprite({ texture: tex, width: 10, height: 10 })
        t.blendMode = 'add'
        this.back.addChild(t)
        return t
      }) as [TilingSprite, TilingSprite]
      this.layers.push({ depth: d.depth, alpha: d.alpha, drift: d.drift, octaves })
    }
    this.vignette = new Sprite(vignetteTexture())
    this.front.addChild(this.vignette)
  }

  update(cam: Camera, time: number) {
    const W = cam.w, H = cam.h
    for (const L of this.layers) {
      const zk = Math.pow(cam.z, L.depth)
      const octave = Math.log2(zk)
      const f = octave - Math.floor(octave)
      // Screen position of this plane's world origin; panning moves it at zk/z of the map speed.
      const ox = W / 2 - cam.x * zk + time * L.drift
      const oy = H / 2 - cam.y * zk + time * L.drift * 0.35
      L.octaves.forEach((t, k) => {
        const size = TILE * 2 ** f * (k === 0 ? 1 : 0.5)
        t.width = W; t.height = H
        t.tileScale.set(size / TILE)
        t.tilePosition.set(((ox % size) + size) % size, ((oy % size) + size) % size)
        t.alpha = L.alpha * (k === 0 ? 1 - f : f)
      })
    }
    this.vignette.width = W
    this.vignette.height = H
  }
}
