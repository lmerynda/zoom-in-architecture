/**
 * Camera in float64: (x, y) is the world point at the screen centre, z is screen px per world
 * unit. All drawing happens in screen space from these, so deep zoom never hits float32 limits.
 */
export class Camera {
  x = 0
  y = 0
  z = 1
  w = 1
  h = 1
  /** How fast the view is changing, for motion effects: zoom in log units/s, pan in screen px/s. */
  zoomRate = 0
  panSpeed = 0
  /** Screen point the current zoom is anchored on, for effects that radiate from it. */
  focusX = 0
  focusY = 0

  private targetLogZ = 0
  private anchor: { sx: number; sy: number; wx: number; wy: number } | null = null
  private vx = 0
  private vy = 0
  private fly: Flight | null = null

  resize(w: number, h: number) { this.w = w; this.h = h; this.focusX = w / 2; this.focusY = h / 2 }

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.z + this.w / 2, (wy - this.y) * this.z + this.h / 2]
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [this.x + (sx - this.w / 2) / this.z, this.y + (sy - this.h / 2) / this.z]
  }

  get flying() { return this.fly != null }

  /** Duration of the flight in progress, in ms (0 when not flying). */
  get flightMs() { return this.fly?.dur ?? 0 }

  set(x: number, y: number, z: number) {
    this.x = x; this.y = y; this.z = z
    this.targetLogZ = Math.log(z)
    this.anchor = null; this.fly = null; this.vx = this.vy = 0
  }

  /** Wheel zoom: keeps the world point under the cursor fixed while the zoom eases in. */
  zoomAt(sx: number, sy: number, factor: number) {
    this.fly = null
    this.vx = this.vy = 0
    if (!this.anchor || this.anchor.sx !== sx || this.anchor.sy !== sy) {
      const [wx, wy] = this.toWorld(sx, sy)
      this.anchor = { sx, sy, wx, wy }
    }
    this.focusX = sx; this.focusY = sy
    this.targetLogZ += Math.log(factor)
  }

  /** Pans by screen pixels. A zoom in progress keeps going, still anchored on the same screen point. */
  panBy(dx: number, dy: number) {
    this.fly = null
    this.x -= dx / this.z
    this.y -= dy / this.z
    if (this.anchor) { this.anchor.wx -= dx / this.z; this.anchor.wy -= dy / this.z }
  }

  release(vx: number, vy: number) { this.vx = vx; this.vy = vy }

  /**
   * Fits a world rect along the van Wijk–Nuij optimal path: far jumps pull back, glide and dive
   * in; near ones are a plain zoom. Duration follows the path length.
   */
  flyTo(x: number, y: number, w: number, h: number, now: number, fill = 0.85, dur?: number) {
    const z1 = Math.min((this.w * fill) / w, (this.h * fill) / h)
    this.anchor = null
    this.vx = this.vy = 0
    const f = flight(this.x, this.y, this.w / this.z, x + w / 2, y + h / 2, this.w / z1)
    this.fly = { ...f, t0: now, dur: dur ?? Math.min(2600, Math.max(650, 420 + f.S * 260)) }
  }

  /** Advances easing; returns true while the camera is still moving. */
  step(now: number, dt: number): boolean {
    const x0 = this.x, y0 = this.y, lz0 = Math.log(this.z)
    const moving = this.advance(now, dt)
    const s = Math.max(dt, 1) / 1000
    this.zoomRate = (Math.log(this.z) - lz0) / s
    this.panSpeed = Math.hypot(this.x - x0, this.y - y0) * this.z / s
    return moving
  }

  private advance(now: number, dt: number): boolean {
    if (this.fly) {
      const f = this.fly
      const u = Math.min(1, (now - f.t0) / f.dur)
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
      const [cx, cy, vw] = f.at(e * f.S)
      this.x = cx; this.y = cy; this.z = this.w / vw
      this.focusX = this.w / 2; this.focusY = this.h / 2
      if (u >= 1) { this.fly = null; this.targetLogZ = Math.log(this.z) }
      return true
    }
    let moving = false
    const logZ = Math.log(this.z)
    const d = this.targetLogZ - logZ
    if (Math.abs(d) > 1e-4) {
      this.z = Math.exp(logZ + d * (1 - Math.exp(-dt / 70)))
      moving = true
    } else if (d !== 0) {
      this.z = Math.exp(this.targetLogZ)
    }
    if (this.anchor) {
      const a = this.anchor
      this.x = a.wx - (a.sx - this.w / 2) / this.z
      this.y = a.wy - (a.sy - this.h / 2) / this.z
      if (!moving) this.anchor = null
    }
    if (Math.abs(this.vx) + Math.abs(this.vy) > 0.02) {
      this.x -= (this.vx * dt) / this.z
      this.y -= (this.vy * dt) / this.z
      const decay = Math.exp(-dt / 180)
      this.vx *= decay; this.vy *= decay
      moving = true
    } else {
      this.vx = this.vy = 0
    }
    return moving
  }
}

interface Flight {
  t0: number
  dur: number
  /** Path length in the zoom-pan metric. */
  S: number
  /** Centre x, y and view width in world units at path position s in [0, S]. */
  at: (s: number) => [number, number, number]
}

const RHO = 1.42

/**
 * van Wijk & Nuij, "Smooth and efficient zooming and panning" (2003): the path from view
 * (c0, w0) to (c1, w1) that is shortest when zooming out costs as much as panning.
 */
export function flight(x0: number, y0: number, w0: number, x1: number, y1: number, w1: number): Omit<Flight, 't0' | 'dur'> {
  const dx = x1 - x0, dy = y1 - y0
  const u1 = Math.hypot(dx, dy)
  const r2 = RHO * RHO
  if (u1 < 1e-9 * Math.max(w0, w1)) {
    const k = w1 < w0 ? -1 : 1
    const S = Math.abs(Math.log(w1 / w0)) / RHO
    return { S, at: s => [x0 + dx * (S ? s / S : 1), y0 + dy * (S ? s / S : 1), w0 * Math.exp(k * RHO * s)] }
  }
  const b = (i: 0 | 1) => {
    const wi = i ? w1 : w0
    return (w1 * w1 - w0 * w0 + (i ? -1 : 1) * r2 * r2 * u1 * u1) / (2 * wi * r2 * u1)
  }
  const r = (i: 0 | 1) => { const bi = b(i); return Math.log(Math.sqrt(bi * bi + 1) - bi) }
  const r0 = r(0), r1 = r(1)
  const S = (r1 - r0) / RHO
  const c0 = Math.cosh(r0), s0 = Math.sinh(r0)
  return {
    S,
    at: s => {
      const u = (w0 / r2) * (c0 * Math.tanh(RHO * s + r0) - s0)
      return [x0 + (dx * u) / u1, y0 + (dy * u) / u1, (w0 * c0) / Math.cosh(RHO * s + r0)]
    },
  }
}
