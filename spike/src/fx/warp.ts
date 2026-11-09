import type { Camera } from '../camera'

/**
 * How fast the camera moves, as 0..1: labels fade by it during a fast flight, since nothing is
 * legible at that speed. It draws nothing; the map itself shows the motion.
 */
export class FlightSpeed {
  level = 0

  update(cam: Camera, dt: number) {
    // From zoom rate (log units/s) and pan speed (px/s), eased so it fades smoothly.
    const want = Math.min(1, Math.max(0, (Math.abs(cam.zoomRate) - 1.2) / 3.5) + Math.max(0, (cam.panSpeed - 3000) / 9000))
    this.level += (want - this.level) * (1 - Math.exp(-dt / 120))
  }
}
