import { Container, Sprite, Texture } from 'pixi.js'

export interface Flow {
  /** Screen polyline from source to target. */
  pts: number[]
  color: number
  both: boolean
}

const CAP = 2400

function dotTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.75)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  return Texture.from(c)
}

/**
 * Direction on the edges of the focused card: particles run from the card to what it uses (amber)
 * and from its users to it (cyan). Only focused edges move. The data has no call traffic, so motion
 * elsewhere would only suggest some, and arrowheads, widths and counts already show the rest.
 */
export class FlowParticles {
  readonly view = new Container()
  private pool: Sprite[] = []
  private tex = dotTexture()

  update(flows: Flow[], time: number) {
    let k = 0
    for (const f of flows) {
      const p = f.pts
      const segs: number[] = []
      let len = 0
      for (let i = 2; i < p.length; i += 2) { const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); segs.push(l); len += l }
      if (len < 24) continue
      // Evenly spaced along the line, so the dots say "this way" and nothing about volume.
      const n = Math.max(1, Math.min(12, Math.round(len / 120)))
      const speed = 150, size = 10
      for (let j = 0; j < n && k < CAP; j++) {
        let u = (j / n + (time * speed) / 1000 / len) % 1
        // Edges used both ways carry traffic both ways.
        if (f.both && j % 2) u = 1 - u
        let d = u * len, i = 0
        while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i++ }
        const t = segs[i] ? d / segs[i] : 0
        const x = p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * t, y = p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * t
        const s = (this.pool[k] ??= this.make())
        s.visible = true
        s.position.set(x, y)
        s.width = s.height = size
        s.tint = f.color
        // Fade in and out at the ends so particles never pop.
        s.alpha = Math.min(1, u * 8, (1 - u) * 8)
        k++
      }
    }
    for (let j = k; j < this.pool.length; j++) this.pool[j].visible = false
    return k
  }

  private make() {
    const s = new Sprite(this.tex)
    s.anchor.set(0.5)
    s.blendMode = 'add'
    this.view.addChild(s)
    return s
  }
}
