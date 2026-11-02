import { BitmapFont, BitmapText, BlurFilter, Container, Graphics, NineSliceSprite, Rectangle, Sprite, Texture, TilingSprite, type Application } from 'pixi.js'
import type { Camera } from './camera'
import { EdgeRouter } from './edges'
import { CARD_W, HEADER, PAD, type World } from './layout'
import { aggregateEdges, type ShownEdge, type Tree } from './model'

const FONT = 'ui'
const FONT_PX = 32
/** A container's children get labels between these on-screen child widths. */
const OPEN_A = 70
const OPEN_B = 120
/** Below this on-screen width a card is a plain coloured pip. */
const PIP = 30
const DESC_WRAP = 500
/** Screen insets the HUD covers; sticky labels and edge chips stay inside them. */
const SAFE = { top: 64, left: 12, right: 12, bottom: 14 }
const BG = 0x0b0f17
const EDGE = 0x8193bd
const OUT = 0xfbbf24
const IN = 0x22d3ee

const PALETTE: Record<string, number> = {
  primary: 0x3b82f6, blue: 0x3b82f6, secondary: 0x0ea5e9, sky: 0x0ea5e9, muted: 0x64748b,
  slate: 0x64748b, gray: 0x6b7280, indigo: 0x6366f1, green: 0x22c55e, amber: 0xf59e0b, red: 0xef4444,
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function mix(a: number, b: number, t: number) {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t
  const bl = (a & 255) * (1 - t) + (b & 255) * t
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)
}

interface NodeView {
  pip?: Sprite
  shadow?: NineSliceSprite
  fill?: NineSliceSprite
  border?: NineSliceSprite
  glow?: NineSliceSprite
  header?: NineSliceSprite
  headerSq?: Sprite
  title?: BitmapText
  sub?: BitmapText
  desc?: BitmapText
  dossier?: BitmapText
}

interface Chip { bg: NineSliceSprite; text: BitmapText }

export interface FrameStats {
  nodes: number
  texts: number
  edges: number
  chips: number
  cpuMs: number
}

/** Edge colour classes, drawn as separate strokes. */
const enum Kind { Thin, Mid, Thick, Out, In }

export class Renderer {
  readonly stage = new Container()
  readonly router: EdgeRouter
  private dots: TilingSprite[] = []
  private cardLayers: Container[] = []
  private textLayers: Container[] = []
  private edgeG = new Graphics()
  private hotEdgeG = new Graphics()
  private chipLayer = new Container()
  private views: (NodeView | undefined)[]
  private shown: number[] = []
  private stamp: Int32Array
  private frameNo = 0
  private openMemo: Float32Array
  private openStamp: Int32Array
  private repMemo: Int32Array
  private repStamp: Int32Array
  /** Frame stamp for nodes tied to the focus: endpoints of its edges and their ancestors. */
  private related: Int32Array
  private endpoint: Int32Array
  /** For endpoints: 1 receives from the focus, 2 sends to it, 3 both. */
  private endKind: Uint8Array
  private colors: Int32Array
  private chips: Chip[] = []
  private labels: Chip[] = []
  private round!: Texture
  private ring!: Texture
  private soft!: Texture
  hover = -1
  /** Clicked element: its relations stay highlighted and everything unrelated dims. */
  selected = -1
  /** HUD panels anchored to the bottom edge, as screen rects x, y, w, h. */
  hud: number[][] = []
  pointer: [number, number] | null = null

  constructor(private app: Application, private tree: Tree, private world: World, private cam: Camera) {
    const n = tree.size
    this.router = new EdgeRouter(tree, world)
    this.views = new Array(n)
    this.stamp = new Int32Array(n)
    this.openMemo = new Float32Array(n)
    this.openStamp = new Int32Array(n).fill(-1)
    this.repMemo = new Int32Array(n)
    this.repStamp = new Int32Array(n).fill(-1)
    this.related = new Int32Array(n).fill(-1)
    this.endpoint = new Int32Array(n).fill(-1)
    this.endKind = new Uint8Array(n)
    this.colors = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      const own = tree.els[i].color
      this.colors[i] = own in PALETTE ? PALETTE[own] : PALETTE.primary
    }
    this.makeTextures()
    for (let k = 0; k < 2; k++) {
      const t = new TilingSprite({ texture: this.dotTexture(), width: 10, height: 10 })
      this.dots.push(t)
      this.stage.addChild(t)
    }
    for (let d = 0; d <= tree.maxDepth; d++) { const c = new Container(); this.cardLayers.push(c); this.stage.addChild(c) }
    this.stage.addChild(this.edgeG, this.hotEdgeG, this.chipLayer)
    for (let d = 0; d <= tree.maxDepth; d++) { const c = new Container(); this.textLayers.push(c); this.stage.addChild(c) }
  }

  static installFont() {
    BitmapFont.install({
      name: FONT,
      style: { fontFamily: 'Segoe UI, Inter, system-ui, sans-serif', fontSize: 48, fill: '#ffffff', fontWeight: '600' },
      chars: [['a', 'z'], ['A', 'Z'], ['0', '9'], ' .,:;!?-_/\\()[]{}&+#@\'"…·→←×|<>=*%$~`^'],
      resolution: 1,
      padding: 6,
    })
  }

  private makeTextures() {
    const r = this.app.renderer
    const frame = new Rectangle(0, 0, 64, 64)
    this.round = r.generateTexture({ target: new Graphics().roundRect(0, 0, 64, 64, 12).fill(0xffffff), frame, resolution: 2, antialias: true })
    this.ring = r.generateTexture({ target: new Graphics().roundRect(1, 1, 62, 62, 11).stroke({ width: 2, color: 0xffffff }), frame, resolution: 2, antialias: true })
    // Soft blob for shadows and glows: a rounded rect blurred inside a padded frame.
    const blob = new Container()
    const g = new Graphics().roundRect(16, 16, 64, 64, 14).fill(0xffffff)
    g.filters = [new BlurFilter({ strength: 8, quality: 4 })]
    blob.addChild(g)
    this.soft = r.generateTexture({ target: blob, frame: new Rectangle(0, 0, 96, 96), resolution: 1, antialias: true })
  }

  private dotTexture() {
    const g = new Graphics().rect(0, 0, 64, 64).fill({ color: 0x000000, alpha: 0 }).circle(32, 32, 2.2).fill(0xffffff)
    return this.app.renderer.generateTexture({ target: g, frame: new Rectangle(0, 0, 64, 64), resolution: 2, antialias: true })
  }

  private nine(tex: Texture, layer: Container, edge = 14) {
    const s = new NineSliceSprite({ texture: tex, leftWidth: edge, topHeight: edge, rightWidth: edge, bottomHeight: edge })
    layer.addChild(s)
    return s
  }

  private text(s: string, layer: Container, wrap = 0) {
    const t = new BitmapText({
      text: s,
      style: { fontFamily: FONT, fontSize: FONT_PX, fill: 0xffffff, wordWrap: wrap > 0, wordWrapWidth: wrap || 100, lineHeight: FONT_PX * 1.25 },
    })
    layer.addChild(t)
    return t
  }

  /** How far container i's children have opened (0..1), from the on-screen size of a child card. */
  open(i: number): number {
    if (i === 0) return 1
    if (this.openStamp[i] === this.frameNo) return this.openMemo[i]
    const s = this.world.content[i * 3 + 2]
    const v = this.tree.children[i].length ? smooth(OPEN_A, OPEN_B, CARD_W * s * this.cam.z) : 0
    this.openMemo[i] = v
    this.openStamp[i] = this.frameNo
    return v
  }

  private screenRect(i: number): [number, number, number, number] {
    const r = this.world.rect, z = this.cam.z
    return [(r[i * 4] - this.cam.x) * z + this.cam.w / 2, (r[i * 4 + 1] - this.cam.y) * z + this.cam.h / 2, r[i * 4 + 2] * z, r[i * 4 + 3] * z]
  }

  private onScreen(i: number, margin = 0) {
    const [x, y, w, h] = this.screenRect(i)
    return x + w > -margin && y + h > -margin && x < this.cam.w + margin && y < this.cam.h + margin
  }

  /**
   * The node that stands in for i on screen: the deepest ancestor whose parent has opened far
   * enough to label it. An end that is off screen collapses to its largest off-screen ancestor,
   * so edges leave the screen toward something nameable.
   */
  rep(i: number): number {
    if (this.repStamp[i] === this.frameNo) return this.repMemo[i]
    const chain: number[] = []
    for (let a = i; a > 0; a = this.tree.parent[a]) chain.push(a)
    let cur = 0
    for (let k = chain.length - 1; k >= 0; k--) {
      const node = chain[k]
      if (this.open(this.tree.parent[node]) < 0.5) break
      cur = node
      if (!this.onScreen(node)) break
    }
    this.repMemo[i] = cur
    this.repStamp[i] = this.frameNo
    return cur
  }

  /** Deepest labelled node under a screen point. */
  pick(sx: number, sy: number): number {
    let cur = 0
    for (;;) {
      if (this.open(cur) < 0.5) return cur
      let next = -1
      for (const c of this.tree.children[cur]) {
        const [x, y, w, h] = this.screenRect(c)
        if (sx >= x && sy >= y && sx <= x + w && sy <= y + h) { next = c; break }
      }
      if (next < 0) return cur
      cur = next
    }
  }

  /** Titles from the root down to the deepest labelled node at the screen centre. */
  breadcrumb(): number[] {
    const out: number[] = []
    let cur = this.pick(this.cam.w / 2, this.cam.h / 2)
    for (; cur > 0; cur = this.tree.parent[cur]) out.unshift(cur)
    return out
  }

  /** Whether node n is the focus, inside it, or contains it. */
  private touches(focus: number, n: number) {
    return focus > 0 && (n === focus || this.tree.isAncestor(focus, n) || this.tree.isAncestor(n, focus))
  }

  frame(): FrameStats {
    const t0 = performance.now()
    this.frameNo++
    const st: FrameStats = { nodes: 0, texts: 0, edges: 0, chips: 0, cpuMs: 0 }
    this.hover = this.pointer ? this.pick(this.pointer[0], this.pointer[1]) : -1
    const focus = this.selected > 0 ? this.selected : this.hover
    const inFocus = focus > 0 ? (i: number) => i === focus || this.tree.isAncestor(focus, i) : undefined
    const edges = aggregateEdges(this.tree, i => this.rep(i), inFocus)
    if (focus > 0) {
      const mark = (n: number) => { for (let a = n; a > 0 && this.related[a] !== this.frameNo; a = this.tree.parent[a]) this.related[a] = this.frameNo }
      mark(focus)
      for (const e of edges) {
        if (!e.out && !e.in) continue
        // The far end is whichever side does not hold the focus: it receives what leaves the focus
        // (1) and sends what enters it (2).
        const far = this.touches(focus, e.s) ? e.t : e.s
        const k = (e.out ? 1 : 0) | (e.in ? 2 : 0)
        if (this.endpoint[far] !== this.frameNo) { this.endpoint[far] = this.frameNo; this.endKind[far] = 0 }
        this.endKind[far] |= k
        mark(e.s); mark(e.t)
      }
    }
    this.drawDots()
    const prev = this.shown
    this.shown = []
    this.visit(0, 1, 1, st)
    for (const i of prev) if (this.stamp[i] !== this.frameNo) this.hide(i)
    this.drawEdges(edges, focus, st)
    st.cpuMs = performance.now() - t0
    return st
  }

  /** World-anchored dot grid in two octaves that crossfade, so zooming never runs out of grid. */
  private drawDots() {
    const z = this.cam.z, W = this.cam.w, H = this.cam.h
    const a = Math.log2(z * 40)
    const f = a - Math.floor(a)
    const ox = (0 - this.cam.x) * z + W / 2, oy = (0 - this.cam.y) * z + H / 2
    for (let k = 0; k < 2; k++) {
      const t = this.dots[k]
      const spacing = 2 ** f * (k === 0 ? 64 : 32)
      t.width = W; t.height = H
      t.tileScale.set(spacing / 64)
      t.tilePosition.set(((ox % spacing) + spacing) % spacing - spacing / 2, ((oy % spacing) + spacing) % spacing - spacing / 2)
      t.tint = 0x94a3b8
      t.alpha = k === 0 ? 0.09 : 0.09 * f
    }
  }

  private hide(i: number) {
    const v = this.views[i]
    if (!v) return
    for (const o of [v.pip, v.shadow, v.fill, v.border, v.glow, v.header, v.headerSq, v.title, v.sub, v.desc, v.dossier]) if (o) o.visible = false
  }

  private visit(i: number, alpha: number, labelAlpha: number, st: FrameStats) {
    const [x, y, w, h] = this.screenRect(i)
    if (w < 1.5 || x + w < 0 || y + h < 0 || x > this.cam.w || y > this.cam.h) return
    if (i > 0) {
      this.stamp[i] = this.frameNo
      this.shown.push(i)
      this.hide(i)
      this.drawCard(i, x, y, w, h, alpha, labelAlpha, st)
    }
    const kids = this.tree.children[i]
    if (!kids.length) return
    const t = this.open(i)
    // Children are always drawn once they are a few px wide, as a faint preview; they brighten
    // and gain labels as the container opens, so detail grows in place instead of popping.
    const childW = CARD_W * this.world.content[i * 3 + 2] * this.cam.z
    if (childW < 1.5) return
    const a = alpha * (i === 0 ? 1 : 0.35 + 0.65 * t)
    for (const c of kids) this.visit(c, a, t, st)
  }

  private drawCard(i: number, x: number, y: number, w: number, h: number, alpha: number, labelAlpha: number, st: FrameStats) {
    st.nodes++
    const d = this.tree.depth[i]
    const v = (this.views[i] ??= {})
    const color = this.colors[i]
    const isContainer = this.tree.children[i].length > 0
    const hot = i === this.hover
    const sel = i === this.selected
    // With a selection, cards unrelated to it fade back; their children decide for themselves.
    const dim = this.selected > 0 && this.related[i] !== this.frameNo ? 0.32 : 1
    const ends = this.endpoint[i] === this.frameNo && !sel
    const endColor = this.endKind[i] === 2 ? IN : OUT
    const cards = this.cardLayers[d]

    if (w < PIP) {
      const p = (v.pip ??= (() => { const s = new Sprite(Texture.WHITE); cards.addChild(s); return s })())
      p.visible = true
      p.position.set(x, y)
      p.width = w; p.height = h
      p.tint = sel ? 0xffffff : ends ? endColor : mix(color, BG, isContainer ? 0.55 : 0.35)
      p.alpha = alpha * dim
      return
    }

    if (!v.fill) {
      // Created together so shadow and glow sit under the fill.
      v.shadow = this.nine(this.soft, cards, 30)
      v.glow = this.nine(this.soft, cards, 30)
      v.fill = this.nine(this.round, cards)
      v.border = this.nine(this.ring, cards)
    }
    const t = isContainer ? this.open(i) : 0
    const shadow = v.shadow!, fill = v.fill, border = v.border!
    if (w > 60) {
      const sp = Math.min(18, w * 0.06)
      shadow.visible = true
      shadow.position.set(x - sp, y - sp * 0.5)
      shadow.width = w + sp * 2; shadow.height = h + sp * 2
      shadow.tint = 0x000000
      shadow.alpha = alpha * dim * 0.55
    }
    fill.visible = true
    fill.position.set(x, y)
    fill.width = w; fill.height = h
    fill.tint = isContainer ? mix(color, BG, 0.86 - 0.04 * t) : mix(color, BG, hot || sel ? 0.5 : 0.66)
    fill.alpha = alpha * dim

    border.visible = true
    border.position.set(x, y)
    border.width = w; border.height = h
    border.tint = sel ? 0xffffff : ends ? endColor : hot ? 0xe2e8f0 : mix(color, 0xffffff, 0.15)
    border.alpha = alpha * (sel || ends ? 1 : hot ? 0.9 : isContainer ? 0.55 : 0.45) * dim

    if (sel || ends) {
      const glow = v.glow!
      const sp = Math.min(26, Math.max(10, w * 0.06))
      glow.visible = true
      glow.position.set(x - sp, y - sp)
      glow.width = w + sp * 2; glow.height = h + sp * 2
      glow.tint = sel ? 0xffffff : endColor
      glow.alpha = alpha * (sel ? 0.75 : 0.6)
    }

    const texts = this.textLayers[d]
    const la = alpha * labelAlpha * (dim < 1 ? 0.6 : 1)
    if (la < 0.02 || w < 44) return

    if (isContainer) {
      const hh = HEADER * h
      const header = (v.header ??= this.nine(this.round, cards))
      const sq = (v.headerSq ??= (() => { const s = new Sprite(Texture.WHITE); cards.addChild(s); return s })())
      header.visible = sq.visible = true
      header.position.set(x, y)
      header.width = w; header.height = Math.max(hh, 28)
      sq.position.set(x, y + hh / 2)
      sq.width = w; sq.height = hh / 2
      header.tint = sq.tint = mix(color, BG, 0.62)
      header.alpha = sq.alpha = alpha * dim
      if (hh < 28) { header.height = hh; header.visible = false; sq.position.set(x, y); sq.height = hh }

      const pad = PAD * w
      const title = (v.title ??= this.text(this.tree.els[i].title, texts))
      const px = Math.min(hh * 0.6, 26, (w * 0.62) / (title.width / FONT_PX || 1))
      if (px >= 6) {
        title.visible = true
        title.scale.set(px / FONT_PX)
        const tw = title.width
        title.position.set(Math.max(x + pad, Math.min(SAFE.left, x + w - pad - tw)), y + (hh - px * 1.25) / 2)
        title.alpha = la
        st.texts++
      }
      const meta = (v.sub ??= this.text(`${this.tree.els[i].kind.toUpperCase()} · ${this.tree.children[i].length}`, texts))
      const mpx = px * 0.62
      if (mpx >= 6 && w > 160) {
        meta.visible = true
        meta.scale.set(mpx / FONT_PX)
        meta.position.set(x + w - pad - meta.width, y + (hh - mpx * 1.25) / 2)
        meta.alpha = la * 0.6
        st.texts++
      }
      return
    }

    const pad = 0.07 * w
    const inner = w - 2 * pad
    const el = this.tree.els[i]
    const title = (v.title ??= this.text(el.title.length > 60 ? el.title.slice(0, 59) + '…' : el.title, texts))
    const px = Math.min(h * 0.15, 24, inner / (title.width / FONT_PX || 1))
    if (px < 6) return
    // Sticky: when the card is bigger than the screen, its text block stays in view.
    const bx = Math.max(x + pad, Math.min(SAFE.left + 8, x + w - pad - inner * 0.5))
    const by = Math.max(y + pad * 0.8, Math.min(SAFE.top + 8, y + h - pad - px * 6))
    title.visible = true
    title.scale.set(px / FONT_PX)
    title.position.set(bx, by)
    title.alpha = la
    st.texts++
    let cy = by + px * 1.3

    const subText = [el.kind, el.technology, ...el.tags.map(t => '#' + t)].filter(Boolean).join(' · ')
    const spx = Math.min(px * 0.62, 14)
    if (spx >= 6 && subText) {
      const sub = (v.sub ??= this.text(subText, texts))
      const s = Math.min(spx, inner / (sub.width / FONT_PX || 1))
      sub.visible = true
      sub.scale.set(s / FONT_PX)
      sub.position.set(bx, cy)
      sub.alpha = la * 0.65
      st.texts++
      cy += s * 1.6
    }

    if (el.description) {
      const dpx = Math.min((FONT_PX * inner) / DESC_WRAP, 14)
      if (dpx >= 6.5) {
        const desc = (v.desc ??= this.text(shortText(el.description, 150), texts, DESC_WRAP))
        const dh = desc.height * (dpx / FONT_PX)
        if (dh <= y + h - pad * 0.6 - cy) {
          desc.visible = true
          desc.scale.set(dpx / FONT_PX)
          desc.position.set(bx, cy)
          desc.alpha = la * 0.8
          st.texts++
          cy += dh + dpx
        }
      }
    }

    // Dossier: once a leaf is most of the screen, it lists what it talks to.
    if (w > 640 && cy < y + h - 80) {
      const dossier = (v.dossier ??= this.text(this.dossierText(i), texts, DESC_WRAP * 1.2))
      const s = 13 / FONT_PX
      if (dossier.text && cy + dossier.height * s < y + h - pad) {
        dossier.visible = true
        dossier.scale.set(s)
        dossier.position.set(bx, cy + 10)
        dossier.alpha = la * 0.75
        st.texts++
      }
    }
  }

  /** Relations crossing element i's boundary: from it or anything inside it, to the outside and back. */
  relationsOf(i: number) {
    const out: { other: number; title: string }[] = [], inn: { other: number; title: string }[] = []
    const r = this.tree.rels
    const inside = (n: number) => n === i || this.tree.isAncestor(i, n)
    for (let k = 0; k < r.length; k += 2) {
      const title = this.tree.relTitles[k >> 1] || 'uses'
      const si = inside(r[k]), ti = inside(r[k + 1])
      if (si && !ti) out.push({ other: r[k + 1], title })
      if (ti && !si) inn.push({ other: r[k], title })
    }
    return { out, inn }
  }

  private dossierText(i: number): string {
    const { out, inn } = this.relationsOf(i)
    const els = this.tree.els
    const cut = (a: string[]) => (a.length > 8 ? [...a.slice(0, 8), `  … ${a.length - 8} more`] : a)
    const o = out.map(r => `→ ${els[r.other].title} · ${r.title}`), n = inn.map(r => `← ${els[r.other].title} · ${r.title}`)
    return [...(o.length ? ['OUTGOING', ...cut(o), ''] : []), ...(n.length ? ['INCOMING', ...cut(n)] : [])].join('\n')
  }

  private drawEdges(edges: ShownEdge[], focus: number, st: FrameStats) {
    const g = this.edgeG, hg = this.hotEdgeG
    g.clear(); hg.clear()
    const W = this.cam.w, H = this.cam.h
    const chipTargets = new Map<number, { x: number; y: number; count: number; kind: Kind }>()
    const labelSpots: { x: number; y: number; s: string; kind: Kind }[] = []
    const paths: number[][][] = [[], [], [], [], []]
    const heads: number[][] = [[], [], [], [], []]
    const sel = this.selected > 0

    const drawn: { e: ShownEdge; kind: Kind; pts: number[]; sOn: boolean; tOn: boolean }[] = []
    for (const e of edges) {
      const sOn = this.onScreen(e.s), tOn = this.onScreen(e.t)
      if (!sOn && !tOn) continue
      const sr = this.screenRect(e.s), tr = this.screenRect(e.t)
      if (Math.max(sr[2], tr[2]) < 6) continue
      // Only relations crossing the focus boundary light up, decided per folded relation.
      const kind = e.out ? Kind.Out : e.in ? Kind.In : e.count >= 5 ? Kind.Thick : e.count >= 2 ? Kind.Mid : Kind.Thin
      const world = this.router.route(e.s, e.t)
      const pts = world ? this.toScreen(world) : straight(sr, tr)
      drawn.push({ e, kind, pts, sOn, tOn })
    }
    const quiet = drawn.length > 24

    for (const { e, kind, pts, sOn, tOn } of drawn) {
      const hot = kind === Kind.Out || kind === Kind.In
      // Clip to the screen; an end that leaves it gets a chip naming where the edge goes.
      let clipped = pts
      if (!tOn || !sOn) {
        const c = clipToScreen(pts, W, H, sOn, SAFE)
        if (!c) continue
        clipped = c
        if (hot || !sel) {
          const off = sOn ? e.t : e.s
          const k = sOn ? clipped.length - 2 : 0
          const chip = chipTargets.get(off)
          if (chip) chip.count += e.count
          else chipTargets.set(off, { x: clipped[k], y: clipped[k + 1], count: e.count, kind })
        }
      }
      paths[kind].push(clipped)
      st.edges++
      const n = pts.length
      if (tOn) heads[kind].push(pts[n - 4], pts[n - 3], pts[n - 2], pts[n - 1])
      if (sOn && e.both) heads[kind].push(pts[2], pts[3], pts[0], pts[1])
      if (sOn && tOn && (hot || !quiet)) {
        const m = longestMid(pts)
        const n = hot ? e.focusCount : e.count, rel = hot ? e.focusRel : e.rel
        if (m[2] > 70) labelSpots.push({ x: m[0], y: m[1], s: n > 1 ? `${n} relations` : this.tree.relTitles[rel], kind })
      }
    }

    // Busy screens get quieter lines; a selection pushes everything else into the background.
    const base = sel ? 0.1 : focus > 0 ? 0.28 : Math.max(0.3, Math.min(0.75, 0.85 - drawn.length / 250))
    const style: [Graphics, number, number, number][] = [
      [g, 1.3, EDGE, base], [g, 2.2, EDGE, base * 1.1], [g, 3.4, EDGE, base * 1.2], [hg, 2.4, OUT, 0.95], [hg, 2.4, IN, 0.95],
    ]
    style.forEach(([gg, width, color, alpha], kind) => {
      for (const p of paths[kind]) {
        gg.moveTo(p[0], p[1])
        for (let k = 2; k < p.length; k += 2) gg.lineTo(p[k], p[k + 1])
      }
      if (paths[kind].length) gg.stroke({ width, color, alpha: Math.min(1, alpha), join: 'round', cap: 'round' })
      arrowHeads(gg, heads[kind], color, Math.min(1, alpha + 0.15), 6 + width * 1.4)
    })

    st.chips = this.drawChips(chipTargets, W, H)
    this.drawLabels(labelSpots)
  }

  private toScreen(world: number[]) {
    const out = new Array<number>(world.length)
    const z = this.cam.z, ox = this.cam.w / 2 - this.cam.x * z, oy = this.cam.h / 2 - this.cam.y * z
    for (let k = 0; k < world.length; k += 2) { out[k] = world[k] * z + ox; out[k + 1] = world[k + 1] * z + oy }
    return out
  }

  private drawChips(targets: Map<number, { x: number; y: number; count: number; kind: Kind }>, W: number, H: number) {
    let k = 0
    const placed: number[][] = []
    for (const [node, c] of targets) {
      if (k >= 24) break
      const label = `${this.tree.els[node].title}${c.count > 1 ? ` ×${c.count}` : ''} →`
      const chip = (this.chips[k] ??= this.makeChip())
      if (chip.text.text !== label) chip.text.text = label
      const px = 12
      chip.text.scale.set(px / FONT_PX)
      const cw = chip.text.width + 16, ch = px * 1.9
      const x = Math.min(Math.max(c.x - cw / 2, SAFE.left), W - cw - SAFE.right)
      let y = Math.min(Math.max(c.y - ch / 2, SAFE.top), H - ch - SAFE.bottom)
      // Lift chips that would sit under the stats panel or the minimap.
      for (const [hx, hy, hw] of this.hud) if (x < hx + hw && hx < x + cw && y + ch > hy) y = hy - ch - 4
      if (placed.some(([px2, py2, w2, h2]) => x < px2 + w2 && px2 < x + cw && y < py2 + h2 && py2 < y + ch)) continue
      placed.push([x, y, cw, ch])
      chip.bg.position.set(x, y)
      chip.bg.width = cw; chip.bg.height = ch
      chip.bg.tint = c.kind === Kind.Out ? mix(OUT, BG, 0.35) : c.kind === Kind.In ? mix(IN, BG, 0.45) : mix(this.colors[node], BG, 0.45)
      chip.bg.alpha = 1
      chip.text.tint = c.kind === Kind.Out || c.kind === Kind.In ? 0x0b0f17 : 0xffffff
      chip.text.position.set(x + 8, y + (ch - px * 1.25) / 2)
      chip.bg.visible = chip.text.visible = true
      k++
    }
    for (let j = k; j < this.chips.length; j++) this.chips[j].bg.visible = this.chips[j].text.visible = false
    return k
  }

  private drawLabels(spots: { x: number; y: number; s: string; kind: Kind }[]) {
    let k = 0
    const placed: number[][] = []
    // Highlighted edges claim label space first.
    spots.sort((a, b) => b.kind - a.kind)
    for (const sp of spots) {
      if (k >= 60 || !sp.s) continue
      const lab = (this.labels[k] ??= this.makeChip())
      if (lab.text.text !== sp.s) lab.text.text = sp.s
      const px = 11
      lab.text.scale.set(px / FONT_PX)
      const cw = lab.text.width + 12, ch = px * 1.8
      const x = sp.x - cw / 2, y = sp.y - ch / 2
      if (placed.some(([px2, py2, w2, h2]) => x < px2 + w2 && px2 < x + cw && y < py2 + h2 && py2 < y + ch)) continue
      placed.push([x, y, cw, ch])
      lab.bg.position.set(x, y)
      lab.bg.width = cw; lab.bg.height = ch
      lab.bg.tint = sp.kind === Kind.Out ? mix(OUT, BG, 0.75) : sp.kind === Kind.In ? mix(IN, BG, 0.75) : 0x111827
      lab.bg.alpha = 0.92
      lab.text.tint = sp.kind === Kind.Out ? OUT : sp.kind === Kind.In ? IN : 0xcbd5e1
      lab.text.position.set(x + 6, y + (ch - px * 1.25) / 2)
      lab.text.alpha = 1
      lab.bg.visible = lab.text.visible = true
      k++
    }
    for (let j = k; j < this.labels.length; j++) this.labels[j].bg.visible = this.labels[j].text.visible = false
  }

  private makeChip(): Chip {
    const bg = new NineSliceSprite({ texture: this.round, leftWidth: 10, topHeight: 10, rightWidth: 10, bottomHeight: 10 })
    const text = new BitmapText({ text: '', style: { fontFamily: FONT, fontSize: FONT_PX, fill: 0xffffff } })
    this.chipLayer.addChild(bg, text)
    return { bg, text }
  }
}

/** One line of text, whitespace runs collapsed, cut to `max` characters with an ellipsis. */
export function shortText(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat
}

function straight(a: number[], b: number[]): number[] {
  const ax = a[0] + a[2] / 2, ay = a[1] + a[3] / 2, bx = b[0] + b[2] / 2, by = b[1] + b[3] / 2
  const p = borderPoint(a, bx, by), q = borderPoint(b, ax, ay)
  return [p[0], p[1], q[0], q[1]]
}

function borderPoint(r: number[], tx: number, ty: number): [number, number] {
  const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2
  const dx = tx - cx, dy = ty - cy
  if (!dx && !dy) return [cx, cy]
  const s = Math.min(Math.abs(r[2] / 2 / (dx || 1e-9)), Math.abs(r[3] / 2 / (dy || 1e-9)))
  return [cx + dx * s, cy + dy * s]
}

/** Midpoint of the longest segment and its length: labels sit in gutters, not on cards. */
function longestMid(pts: number[]): [number, number, number] {
  let best = 0, bx = pts[0], by = pts[1]
  for (let k = 2; k < pts.length; k += 2) {
    const l = Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1])
    if (l > best) { best = l; bx = (pts[k] + pts[k - 2]) / 2; by = (pts[k + 1] + pts[k - 1]) / 2 }
  }
  return [bx, by, best]
}

function arrowHeads(g: Graphics, segs: number[], color: number, alpha: number, L: number) {
  if (!segs.length) return
  for (let k = 0; k < segs.length; k += 4) {
    const [x0, y0, x1, y1] = [segs[k], segs[k + 1], segs[k + 2], segs[k + 3]]
    const a = Math.atan2(y1 - y0, x1 - x0), sp = 0.45
    g.poly([x1, y1, x1 - L * Math.cos(a - sp), y1 - L * Math.sin(a - sp), x1 - L * Math.cos(a + sp), y1 - L * Math.sin(a + sp)])
  }
  g.fill({ color, alpha })
}

/**
 * Cuts a polyline at the screen edge (inset), keeping the on-screen part. `fromStart` says the
 * start is on screen and the end leaves; otherwise the start is off screen.
 */
export function clipToScreen(pts: number[], W: number, H: number, fromStart: boolean, inset = { top: 10, left: 10, right: 10, bottom: 10 }): number[] | null {
  const L = inset.left, T = inset.top, R = W - inset.right, B = H - inset.bottom
  const inside = (x: number, y: number) => x >= L && y >= T && x <= R && y <= B
  const p = fromStart ? pts : reversePts(pts)
  const out: number[] = [p[0], p[1]]
  for (let k = 2; k < p.length; k += 2) {
    const x0 = p[k - 2], y0 = p[k - 1], x1 = p[k], y1 = p[k + 1]
    if (inside(x1, y1)) { out.push(x1, y1); continue }
    // Leaving the box on this segment: find the exit parameter.
    let u = 1
    if (x1 < L) u = Math.min(u, (L - x0) / (x1 - x0))
    if (x1 > R) u = Math.min(u, (R - x0) / (x1 - x0))
    if (y1 < T) u = Math.min(u, (T - y0) / (y1 - y0))
    if (y1 > B) u = Math.min(u, (B - y0) / (y1 - y0))
    u = Math.max(0, Math.min(1, u))
    out.push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u)
    break
  }
  if (out.length < 4) return null
  return fromStart ? out : reversePts(out)
}

function reversePts(p: number[]) {
  const out: number[] = []
  for (let k = p.length - 2; k >= 0; k -= 2) out.push(p[k], p[k + 1])
  return out
}
