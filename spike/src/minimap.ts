import type { Camera } from './camera'
import type { World } from './layout'
import type { Tree } from './model'

/** Strategy-game minimap: the top two levels, the viewport, click to jump. */
export class Minimap {
  onPick: (wx: number, wy: number) => void = () => {}
  private scale = 1
  private ox = 0
  private oy = 0

  constructor(private canvas: HTMLCanvasElement, private tree: Tree, private world: World) {
    canvas.addEventListener('pointerdown', e => {
      const wx = (e.offsetX - this.ox) / this.scale, wy = (e.offsetY - this.oy) / this.scale
      this.onPick(wx, wy)
    })
  }

  draw(cam: Camera) {
    const c = this.canvas, dpr = devicePixelRatio
    const W = c.clientWidth, H = c.clientHeight
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    const r = this.world.rect
    this.scale = Math.min((W - 12) / r[2], (H - 12) / r[3])
    this.ox = (W - r[2] * this.scale) / 2
    this.oy = (H - r[3] * this.scale) / 2
    for (let i = 1; i < this.tree.size; i++) {
      const d = this.tree.depth[i]
      if (d > 2) continue
      const x = this.ox + r[i * 4] * this.scale, y = this.oy + r[i * 4 + 1] * this.scale
      const w = r[i * 4 + 2] * this.scale, h = r[i * 4 + 3] * this.scale
      g.fillStyle = d === 1 ? 'rgba(96,165,250,0.22)' : 'rgba(148,163,184,0.35)'
      g.fillRect(x, y, w, h)
    }
    const [wx0, wy0] = cam.toWorld(0, 0), [wx1, wy1] = cam.toWorld(cam.w, cam.h)
    const vx = this.ox + wx0 * this.scale, vy = this.oy + wy0 * this.scale
    const vw = (wx1 - wx0) * this.scale, vh = (wy1 - wy0) * this.scale
    g.strokeStyle = '#fbbf24'
    g.lineWidth = 1.5
    if (vw < 6) {
      // Deep zoom: the viewport is a dot, so mark it with a crosshair.
      const cx = vx + vw / 2, cy = vy + vh / 2
      g.beginPath(); g.moveTo(cx - 8, cy); g.lineTo(cx + 8, cy); g.moveTo(cx, cy - 8); g.lineTo(cx, cy + 8); g.stroke()
    } else {
      g.strokeRect(vx, vy, vw, vh)
    }
  }
}
