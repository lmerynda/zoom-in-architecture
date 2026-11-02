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

  private targetLogZ = 0
  private anchor: { sx: number; sy: number; wx: number; wy: number } | null = null
  private vx = 0
  private vy = 0
  private fly: { t0: number; dur: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null = null

  resize(w: number, h: number) { this.w = w; this.h = h }

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.z + this.w / 2, (wy - this.y) * this.z + this.h / 2]
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [this.x + (sx - this.w / 2) / this.z, this.y + (sy - this.h / 2) / this.z]
  }

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
    this.targetLogZ += Math.log(factor)
  }

  panBy(dx: number, dy: number) {
    this.fly = null
    this.anchor = null
    this.targetLogZ = Math.log(this.z)
    this.x -= dx / this.z
    this.y -= dy / this.z
  }

  release(vx: number, vy: number) { this.vx = vx; this.vy = vy }

  /** Fits a world rect. Large zoom changes run as a zoom about one fixed point, like the wheel. */
  flyTo(x: number, y: number, w: number, h: number, now: number, fill = 0.85, dur = 750) {
    const z1 = Math.min((this.w * fill) / w, (this.h * fill) / h)
    this.anchor = null
    this.vx = this.vy = 0
    this.fly = { t0: now, dur, x0: this.x, y0: this.y, z0: this.z, x1: x + w / 2, y1: y + h / 2, z1 }
  }

  /** Advances easing; returns true while the camera is still moving. */
  step(now: number, dt: number): boolean {
    if (this.fly) {
      const f = this.fly
      const u = Math.min(1, (now - f.t0) / f.dur)
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
      this.z = Math.exp(Math.log(f.z0) + (Math.log(f.z1) - Math.log(f.z0)) * e)
      const r = f.z0 / f.z1
      if (Math.abs(Math.log(r)) > 0.2) {
        // Fixed point P with c1 = P + (c0 - P) * r; the centre follows c(t) = P + (c0 - P) * z0 / z(t).
        const px = (f.x1 - f.x0 * r) / (1 - r), py = (f.y1 - f.y0 * r) / (1 - r)
        const k = f.z0 / this.z
        this.x = px + (f.x0 - px) * k
        this.y = py + (f.y0 - py) * k
      } else {
        this.x = f.x0 + (f.x1 - f.x0) * e
        this.y = f.y0 + (f.y1 - f.y0) * e
      }
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
