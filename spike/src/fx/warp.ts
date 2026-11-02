import { Graphics } from 'pixi.js'
import type { Camera } from '../camera'

const STREAKS = 160

/**
 * Hyperspace streaks while the camera moves fast: radial lines rushing out of the zoom focus
 * when diving in, back into it when pulling out. Invisible at ordinary speeds.
 */
export class WarpStreaks {
  readonly view = new Graphics()
  private seeds: { angle: number; phase: number; speed: number; width: number }[] = []
  /** 0..1: how strongly the effect shows; labels fade by it, since nothing is legible at warp speed. */
  level = 0

  constructor() {
    let s = 7
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < STREAKS; i++) this.seeds.push({ angle: r() * Math.PI * 2, phase: r(), speed: 0.6 + r() * 0.8, width: 0.6 + r() * 1.4 })
    this.view.blendMode = 'add'
  }

  update(cam: Camera, time: number, dt: number) {
    // Intensity from zoom rate (log units/s) and pan speed (px/s), eased so it fades smoothly.
    const want = Math.min(1, Math.max(0, (Math.abs(cam.zoomRate) - 1.2) / 3.5) + Math.max(0, (cam.panSpeed - 3000) / 9000))
    this.level += (want - this.level) * (1 - Math.exp(-dt / 120))
    const g = this.view
    g.clear()
    if (this.level < 0.02) return
    const cx = cam.focusX, cy = cam.focusY
    const R = Math.hypot(cam.w, cam.h) * 0.75
    const dir = cam.zoomRate >= 0 ? 1 : -1
    for (const sd of this.seeds) {
      let u = (sd.phase + dir * time * 0.0009 * sd.speed) % 1
      if (u < 0) u += 1
      const r0 = R * u * u + 30
      const len = this.level * (30 + r0 * 0.35)
      const ca = Math.cos(sd.angle), sa = Math.sin(sd.angle)
      g.moveTo(cx + ca * r0, cy + sa * r0).lineTo(cx + ca * (r0 + len), cy + sa * (r0 + len))
      g.stroke({ width: sd.width, color: 0xbfd7ff, alpha: this.level * 0.75 * Math.min(1, u * 3) })
    }
  }
}
