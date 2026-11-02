import { Container, Sprite, Texture } from 'pixi.js'

export interface Flow {
  /** Screen polyline from source to target. */
  pts: number[]
  color: number
  /** Relations folded into the edge: more traffic, more particles. */
  count: number
  both: boolean
  bright: boolean
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
 * Traffic along edges: glowing particles travel from caller to callee, like goods on a
 * logistics map. Busier edges carry more of them; focused edges run brighter and faster.
 */
export class FlowParticles {
  readonly view = new Container()
  private pool: Sprite[] = []
  private tex = dotTexture()

  update(flows: Flow[], time: number, quiet: boolean) {
    let k = 0
    for (const f of flows) {
      if (quiet && !f.bright) continue
      const p = f.pts
      const segs: number[] = []
      let len = 0
      for (let i = 2; i < p.length; i += 2) { const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); segs.push(l); len += l }
      if (len < 24) continue
      const density = Math.min(2.2, 0.8 + Math.log2(f.count) * 0.35) * (f.bright ? 1.3 : 1)
      const n = Math.max(1, Math.min(18, Math.round((len / 110) * density)))
      const speed = f.bright ? 150 : 85
      const size = f.bright ? 11 : 7
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
        s.alpha = (f.bright ? 1 : 0.7) * Math.min(1, u * 8, (1 - u) * 8)
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
