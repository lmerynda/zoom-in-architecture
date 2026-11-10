import { BitmapFont, BitmapText, BlurFilter, Container, Graphics, NineSliceSprite, Rectangle, Sprite, Texture, type Application } from 'pixi.js'
import type { Camera } from './camera'
import { EdgeRouter } from './edges'
import { FlowParticles, type Flow } from './fx/particles'
import { Starfield } from './fx/starfield'
import { FlightSpeed } from './fx/warp'
import type { Hop } from './controls/logic'
import { CODE_W, codeBox, type CodeSlot } from './code'
import { drawGlyph, glyphOf, GLYPHS, type Glyph } from './icons'
import { heatColor, type Lens } from './lens'
import { CARD_W, HEADER, PAD, type World } from './layout'
import { aggregateEdges, type EvidenceJson, type ShownEdge, type Tree } from './model'

const FONT = 'ui'
const FONT_PX = 32
/**
 * A container opens, and its children get labels, between these on-screen child widths: a child
 * narrower than OPEN_A could not carry its name, so until then the container stays a closed card.
 */
const OPEN_A = 120
const OPEN_B = 180
/** Below this on-screen width a card is a plain coloured pip. */
const PIP = 30
const DESC_WRAP = 500
/** Screen insets the HUD covers; sticky labels and edge chips stay inside them. */
// Below the top bar and the breadcrumb, so sticky titles and chips never sit under them.
const SAFE = { top: 104, left: 12, right: 12, bottom: 14 }
const BG = 0x0b0f17
const EDGE = 0x8193bd
const OUT = 0xfbbf24
const IN = 0x22d3ee
const ROUTE = 0x4ade80
const PIN = 0xf472b6
const FLASH_MS = 3200
/** Icon size and the gap after it, in multiples of the title's font size. */
const ICON = 1.05
const ICON_GAP = 0.4
/** The smallest the kind and technology line may get before it is cut short instead. */
const SUB_MIN = 10
/** How far a long title may shrink below its level's size before it is cut with an ellipsis... */
const TITLE_SHRINK = 0.45
/** ...but never below this, in px: a whole name smaller than this is not read. */
const TITLE_MIN = 9

/**
 * A title's size: its level's size (`level`, the same for siblings), shrunk to fit `room` for a
 * title `em` wide, down to TITLE_SHRINK of the level or TITLE_MIN px, whichever is larger. A name
 * is cut only when shrinking that far would not save it: a whole name beats a uniform size.
 */
export function titlePx(level: number, room: number, em: number): number {
  return Math.min(level, Math.max(room / em, Math.min(level, Math.max(TITLE_MIN, level * TITLE_SHRINK))))
}

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
  /** A closed container's list of what it holds. */
  inside?: BitmapText
  dossier?: BitmapText
  metric?: BitmapText
  icon?: Sprite
  /** Width per px of the full sub line, measured once, so cutting it never re-measures. */
  subEm?: number
  /** The same for the full title. */
  titleEm?: number
}

interface Chip { bg: NineSliceSprite; text: BitmapText }

export interface FrameStats {
  nodes: number
  texts: number
  edges: number
  chips: number
  /** Moving dots; only the focused card's edges carry them. */
  particles: number
  cpuMs: number
}

/** Edge colour classes, drawn as separate strokes. */
const enum Kind { Thin, Mid, Thick, Out, In }

export class Renderer {
  readonly stage = new Container()
  readonly router: EdgeRouter
  private stars = new Starfield()
  private warp = new FlightSpeed()
  private particles = new FlowParticles()
  /** Pulse rings and selection reticle, drawn above cards. */
  private fxG = new Graphics()
  private cardLayers: Container[] = []
  private textLayers: Container[] = []
  private edgeG = new Graphics()
  private hotEdgeG = new Graphics()
  private chipLayer = new Container()
  private views: (NodeView | undefined)[]
  private shown: number[] = []
  /** Lens values drawn this frame, in screen px, so edge labels keep off them. */
  private badges: number[][] = []
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
  /** What each element is, as an icon; people get rounder cards, and external systems outlined ones. */
  private glyphs: (Glyph | null)[]
  private icons = new Map<Glyph, Texture>()
  private pill!: Texture
  private pillRing!: Texture
  private chips: Chip[] = []
  private labels: Chip[] = []
  private round!: Texture
  private ring!: Texture
  private soft!: Texture
  /** Animation clock in ms, from the app's (possibly manual) clock. */
  time = 0
  private dt = 16
  /** Per container: whether it was open last frame, to fire a pulse when it opens. */
  private wasOpen: Uint8Array
  private pulses: { node: number; t0: number }[] = []
  /** When the current selection was made, for the lock-on animation. */
  private selectedAt = 0
  private lastSelected = -1
  /** Called when a container opens on screen, for sound. */
  onOpen: () => void = () => {}
  /** Secondary target, like an MMO's target-of-target: a neighbour of the selection being inspected. */
  target = -1
  /** Route being shown, hop by hop, and the waypoint the camera is on. */
  route: Hop[] | null = null
  routeStep = -1
  /** Pinned elements, like quest markers. */
  pins: number[] = []
  private routeG = new Graphics()
  private markers: Chip[] = []
  /** Cards changed by a live model update glow for a while: green added, amber changed. */
  flash = new Map<number, { color: number; t0: number }>()
  /** Active lens, or null for the structure view. */
  lens: Lens | null = null
  hover = -1
  /** Clicked element: its relations stay highlighted and everything unrelated dims. */
  selected = -1
  /** HUD panels anchored to the bottom edge, as screen rects x, y, w, h. */
  hud: number[][] = []
  pointer: [number, number] | null = null
  /** File cards big enough to show their source this frame; the page draws the code over them. */
  codeSlots: CodeSlot[] = []

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
    this.wasOpen = new Uint8Array(n)
    this.colors = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      const own = tree.els[i].color
      this.colors[i] = own in PALETTE ? PALETTE[own] : PALETTE.primary
    }
    this.glyphs = tree.els.map((e, i) => (i ? glyphOf(e) : null))
    this.makeTextures()
    this.stage.addChild(this.stars.back)
    for (let d = 0; d <= tree.maxDepth; d++) { const c = new Container(); this.cardLayers.push(c); this.stage.addChild(c) }
    this.stage.addChild(this.edgeG, this.hotEdgeG, this.routeG, this.particles.view, this.stars.front, this.fxG, this.chipLayer)
    for (let d = 0; d <= tree.maxDepth; d++) { const c = new Container(); this.textLayers.push(c); this.stage.addChild(c) }
  }

  static installFont() {
    BitmapFont.install({
      name: FONT,
      style: { fontFamily: 'Segoe UI, Inter, system-ui, sans-serif', fontSize: 48, fill: '#ffffff', fontWeight: '600' },
      chars: [['a', 'z'], ['A', 'Z'], ['0', '9'], ' .,:;!?-_/\\()[]{}&+#@\'"…·→←↑↓×|<>=*%$~`^◆●▲▼◀▶'],
      resolution: 1,
      padding: 6,
    })
  }

  private makeTextures() {
    const r = this.app.renderer
    const frame = new Rectangle(0, 0, 64, 64)
    this.round = r.generateTexture({ target: new Graphics().roundRect(0, 0, 64, 64, 12).fill(0xffffff), frame, resolution: 2, antialias: true })
    this.ring = r.generateTexture({ target: new Graphics().roundRect(1, 1, 62, 62, 11).stroke({ width: 2, color: 0xffffff }), frame, resolution: 2, antialias: true })
    this.pill = r.generateTexture({ target: new Graphics().roundRect(0, 0, 64, 64, 28).fill(0xffffff), frame, resolution: 2, antialias: true })
    this.pillRing = r.generateTexture({ target: new Graphics().roundRect(1, 1, 62, 62, 27).stroke({ width: 2, color: 0xffffff }), frame, resolution: 2, antialias: true })
    for (const name of GLYPHS) this.icons.set(name, r.generateTexture({ target: drawGlyph(name), frame, resolution: 2, antialias: true }))
    // Soft blob for shadows and glows: a rounded rect blurred inside a padded frame.
    const blob = new Container()
    const g = new Graphics().roundRect(16, 16, 64, 64, 14).fill(0xffffff)
    g.filters = [new BlurFilter({ strength: 8, quality: 4 })]
    blob.addChild(g)
    this.soft = r.generateTexture({ target: blob, frame: new Rectangle(0, 0, 96, 96), resolution: 1, antialias: true })
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
    // Created hidden: a label made for a card too small to show it must not appear at (0, 0).
    t.visible = false
    layer.addChild(t)
    return t
  }

  /** How far container i's children have opened (0..1), from the on-screen size of a child card. */
  open(i: number): number {
    if (i === 0) return 1
    if (this.openStamp[i] === this.frameNo) return this.openMemo[i]
    const v = this.tree.children[i].length ? smooth(OPEN_A, OPEN_B, CARD_W * this.world.content[i * 3 + 2] * this.cam.z) : 0
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

  /**
   * The card the pointer is about: a file or a closed card under it, or an open container only by
   * its header. The pointer always rests somewhere, so the background of an open container is
   * space between cards, not a reason to light up every edge crossing it.
   */
  hoverAt(sx: number, sy: number): number {
    const i = this.pick(sx, sy)
    if (i <= 0 || !this.tree.children[i].length || this.open(i) <= 0) return i
    const [, y, , h] = this.screenRect(i)
    return sy <= y + Math.max(HEADER * h, 28) ? i : -1
  }

  /** Titles from the root down to the deepest labelled node at the screen centre. */
  /**
   * Where the reader is: the chain of cards under the screen centre that fill most of the screen.
   * A small card that happens to sit under the centre is something you look at, not a place you
   * are in, so the chain stops above it.
   */
  breadcrumb(): number[] {
    const chain: number[] = []
    for (let cur = this.pick(this.cam.w / 2, this.cam.h / 2); cur > 0; cur = this.tree.parent[cur]) chain.unshift(cur)
    const k = chain.findIndex(i => { const [, , w, h] = this.screenRect(i); return w < this.cam.w * 0.55 && h < this.cam.h * 0.55 })
    return k < 0 ? chain : chain.slice(0, k)
  }

  /** Whether node n is the focus, inside it, or contains it. */
  private touches(focus: number, n: number) {
    return focus > 0 && (n === focus || this.tree.isAncestor(focus, n) || this.tree.isAncestor(n, focus))
  }

  frame(now = performance.now()): FrameStats {
    const t0 = performance.now()
    this.dt = Math.min(100, Math.max(1, now - this.time))
    this.time = now
    this.frameNo++
    if (this.selected !== this.lastSelected) { this.lastSelected = this.selected; this.selectedAt = now }
    const st: FrameStats = { nodes: 0, texts: 0, edges: 0, chips: 0, particles: 0, cpuMs: 0 }
    this.hover = this.pointer ? this.hoverAt(this.pointer[0], this.pointer[1]) : -1
    const focus = this.selected > 0 ? this.selected : this.hover
    const inFocus = focus > 0 ? (i: number) => i === focus || this.tree.isAncestor(focus, i) : undefined
    const edges = aggregateEdges(this.tree, i => this.rep(i), inFocus)
    const mark = (n: number) => { for (let a = n; a > 0 && this.related[a] !== this.frameNo; a = this.tree.parent[a]) this.related[a] = this.frameNo }
    if (this.route) for (const h of this.route) { mark(h.from); mark(h.to) }
    if (this.target > 0) mark(this.target)
    if (focus > 0) {
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
    this.stars.update(this.cam, now)
    this.fxG.clear()
    this.codeSlots = []
    const prev = this.shown
    this.shown = []
    this.badges = []
    this.visit(0, 1, 1, st)
    for (const i of prev) if (this.stamp[i] !== this.frameNo) this.hide(i)
    this.drawEdges(edges, focus, st)
    this.warp.update(this.cam, this.dt)
    this.drawRoute()
    this.drawPulses()
    this.drawReticles()
    this.drawPins()
    st.cpuMs = performance.now() - t0
    return st
  }

  private hide(i: number) {
    const v = this.views[i]
    if (!v) return
    for (const o of [v.pip, v.shadow, v.fill, v.border, v.glow, v.header, v.headerSq, v.title, v.sub, v.desc, v.inside, v.dossier, v.metric, v.icon]) if (o) o.visible = false
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
    if (i > 0) {
      if (t > 0.97 && !this.wasOpen[i]) {
        this.wasOpen[i] = 1
        if (w > 160) { this.pulses.push({ node: i, t0: this.time }); this.onOpen() }
      } else if (t < 0.3) this.wasOpen[i] = 0
    }
    // Children appear as the container starts to open, faint at first; they brighten and gain
    // labels as it opens, so detail grows in place instead of popping. Before that the container
    // is a closed card with a readable name, not a box of unlabelled tiles. The reveal runs as a
    // wave outward from the zoom focus.
    const childW = CARD_W * this.world.content[i * 3 + 2] * this.cam.z
    if (childW < 1.5 || (i > 0 && t <= 0)) return
    const diag = Math.hypot(this.cam.w, this.cam.h)
    for (const c of kids) {
      let r = t
      if (i > 0 && t > 0 && t < 1) {
        const [cx, cy, cw, ch] = this.screenRect(c)
        const d = Math.hypot(cx + cw / 2 - this.cam.focusX, cy + ch / 2 - this.cam.focusY) / diag
        r = Math.min(1, Math.max(0, t * 1.8 - d * 0.8))
      }
      // Names come first: a drawn child carries its name at full strength from the start (its box
      // fades in), so an opening container shows names or nothing, never ghosts or blank boxes.
      this.visit(c, alpha * (i === 0 ? 1 : 0.35 + 0.65 * r), 1, st)
    }
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
    const dim = (this.selected > 0 || this.route) && this.related[i] !== this.frameNo ? 0.32 : 1
    const ends = this.endpoint[i] === this.frameNo && !sel
    const endColor = this.endKind[i] === 2 ? IN : OUT
    const fl = this.flash.get(i)
    const flashA = fl ? Math.max(0, 1 - (this.time - fl.t0) / FLASH_MS) : 0
    const cards = this.cardLayers[d]

    const heat = this.lens ? heatColor(this.lens.heat[i]) : -1
    if (w < PIP) {
      const p = (v.pip ??= (() => { const s = new Sprite(Texture.WHITE); cards.addChild(s); return s })())
      p.visible = true
      p.position.set(x, y)
      p.width = w; p.height = h
      p.tint = sel ? 0xffffff : ends ? endColor : flashA > 0.05 ? fl!.color : heat >= 0 ? mix(heat, BG, isContainer ? 0.45 : 0.15) : mix(color, BG, isContainer ? 0.55 : 0.35)
      p.alpha = alpha * dim
      return
    }

    const glyph = this.glyphs[i]
    const person = glyph === 'person', outside = glyph === 'external'
    if (!v.fill) {
      // Created together so shadow and glow sit under the fill.
      v.shadow = this.nine(this.soft, cards, 30)
      v.glow = this.nine(this.soft, cards, 30)
      v.fill = person ? this.nine(this.pill, cards, 28) : this.nine(this.round, cards)
      v.border = person ? this.nine(this.pillRing, cards, 28) : this.nine(this.ring, cards)
    }
    const t = isContainer ? this.open(i) : 0
    const shadow = v.shadow!, fill = v.fill, border = v.border!
    if (w > 60 && !outside) {
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
    // Under a lens the heat sits on the cards you are looking at: closed ones carry the colour,
    // deep enough that white titles stay readable on the hot (pale yellow) end; open containers
    // fade to a dark frame so their children carry it.
    fill.tint = heat >= 0
      ? mix(heat, BG, isContainer ? 0.32 + 0.6 * t : hot || sel ? 0.45 : 0.58)
      : isContainer ? mix(color, BG, 0.86 - 0.04 * t) : mix(color, BG, hot || sel ? 0.5 : 0.66)
    // An external system is outside what was mapped: an outline over the background.
    fill.alpha = alpha * dim * (outside && heat < 0 && !hot && !sel ? 0.3 : 1)

    border.visible = true
    border.position.set(x, y)
    border.width = w; border.height = h
    border.tint = sel ? 0xffffff : ends ? endColor : flashA > 0.05 ? fl!.color : hot ? 0xe2e8f0 : heat >= 0 ? heat : mix(color, 0xffffff, 0.15)
    border.alpha = alpha * (sel || ends ? 1 : hot ? 0.9 : outside ? 0.8 : isContainer ? 0.55 : 0.45) * dim

    if (sel || ends || flashA > 0.02) {
      const glow = v.glow!
      const sp = Math.min(26, Math.max(10, w * 0.06))
      glow.visible = true
      glow.position.set(x - sp, y - sp)
      glow.width = w + sp * 2; glow.height = h + sp * 2
      glow.tint = sel ? 0xffffff : ends ? endColor : fl!.color
      glow.alpha = alpha * (sel ? 0.75 : ends ? 0.6 : 0.85 * flashA * (0.75 + 0.25 * Math.sin(this.time / 120)))
    }

    const texts = this.textLayers[d]
    const la = alpha * labelAlpha * (dim < 1 ? 0.6 : 1) * (1 - this.warp.level * 0.9)
    if (la < 0.02 || w < 44) return

    // Lens value badge in the bottom-right corner.
    if (this.lens && w > 90) {
      const label = `${compact(this.lens.raw[i])} ${this.lens.raw[i] === 1 ? this.lens.unit.replace(/s$/, '') : this.lens.unit}`
      const badge = (v.metric ??= this.text(label, texts))
      if (badge.text !== label) badge.text = label
      const bpx = Math.min(h * 0.1, 14)
      badge.scale.set(bpx / FONT_PX)
      // A value wider than its card would be cut ("37 relatio"); it waits until the card has room.
      if (bpx >= 7 && badge.width <= w * 0.88) {
        badge.visible = true
        badge.tint = heatColor(Math.min(1, this.lens.heat[i] + 0.25))
        // Inside the card and inside the screen: a card running off the edge keeps its value in view.
        let bx = Math.max(x + w * 0.06, Math.min(x + w - w * 0.06 - badge.width, this.cam.w - SAFE.right - badge.width))
        const by = Math.max(y + h * 0.3, Math.min(y + h - h * 0.08 - bpx * 1.25, this.cam.h - SAFE.bottom - bpx * 1.4))
        // Out from under the minimap and the panels, which sit over the map; if that leaves the card, it waits.
        for (const [hx, hy, hw, hh] of this.hud) if (hw && bx < hx + hw && hx < bx + badge.width && by < hy + hh && hy < by + bpx * 1.3) bx = hx - badge.width - 6
        if (bx < x + w * 0.04) badge.visible = false
        badge.position.set(bx, by)
        if (badge.visible) this.badges.push([bx, by, badge.width, bpx * 1.3])
        badge.alpha = la
      }
    }

    // A container shows its header and contents once it starts to open; before, it is drawn as a
    // closed card below, its name as large as any card of its size.
    if (isContainer && this.open(i) > 0) {
      const hh = HEADER * h
      const header = (v.header ??= this.nine(this.round, cards))
      const sq = (v.headerSq ??= (() => { const s = new Sprite(Texture.WHITE); cards.addChild(s); return s })())
      header.visible = sq.visible = true
      header.position.set(x, y)
      header.width = w; header.height = Math.max(hh, 28)
      sq.position.set(x, y + hh / 2)
      sq.width = w; sq.height = hh / 2
      header.tint = sq.tint = heat >= 0 ? mix(heat, BG, 0.3 + 0.35 * t) : mix(color, BG, 0.62)
      header.alpha = sq.alpha = alpha * dim
      if (hh < 28) { header.height = hh; header.visible = false; sq.position.set(x, y); sq.height = hh }

      const pad = PAD * w
      const full = this.tree.els[i].title
      const title = (v.title ??= this.text(full, texts))
      v.titleEm ??= em(title)
      const lead = glyph ? ICON + ICON_GAP : 0
      // As on closed cards: a name shrinks a little before it is cut. It may use the width the
      // kind and count on the right would take; they give way to it.
      const level = Math.min(hh * 0.6, 26), room = w - 2 * pad
      const px = titlePx(level, room, v.titleEm + lead)
      const roomy = (v.titleEm + lead) * px <= w * 0.62
      let titleRight = 0
      if (px >= 6) {
        const shown = fitText(full, v.titleEm, room - lead * px, px)
        if (title.text !== shown) title.text = shown
        title.visible = true
        title.scale.set(px / FONT_PX)
        const tw = title.width + lead * px
        const tx = Math.max(x + pad, Math.min(SAFE.left, x + w - pad - tw))
        titleRight = tx + tw
        title.position.set(tx + lead * px, y + (hh - px * 1.25) / 2)
        title.alpha = la
        if (glyph) this.icon(v, glyph, texts, tx, y + (hh - px * ICON) / 2, px * ICON, color, la)
        st.texts++
      }
      const meta = (v.sub ??= this.text(`${this.tree.els[i].kind.toUpperCase()} · ${this.tree.children[i].length}`, texts))
      const mpx = level * 0.62
      // Beside the title, never under it: a header held at the screen edge can reach its right side.
      meta.scale.set(mpx / FONT_PX)
      if (mpx >= 6 && w > 160 && roomy && titleRight + 16 < x + w - pad - meta.width) {
        meta.visible = true
        meta.position.set(x + w - pad - meta.width, y + (hh - mpx * 1.25) / 2)
        meta.alpha = la * 0.6
        st.texts++
      }
      return
    }

    const pad = 0.07 * w
    const inner = w - 2 * pad
    const el = this.tree.els[i]
    const full = el.title.length > 60 ? el.title.slice(0, 59) + '…' : el.title
    const title = (v.title ??= this.text(full, texts))
    v.titleEm ??= em(title)
    const lead = glyph ? ICON + ICON_GAP : 0
    const px = titlePx(Math.min(h * 0.15, 24), inner, v.titleEm + lead)
    if (px < 6) return
    // Reading a file: its code reaches up under the top bar, and the breadcrumb names it. A title
    // held on screen there would sit on the code, so the card's text scrolls away with its top.
    if (el.metadata?.path && w >= CODE_W && codeBox(x, y, w, h).y < SAFE.top) {
      this.codeSlots.push({ i, ...codeBox(x, y, w, h), alpha: la })
      return
    }
    const shownTitle = fitText(full, v.titleEm, inner - lead * px, px)
    if (title.text !== shownTitle) title.text = shownTitle
    // Sticky: when the card is bigger than the screen, its text block stays in view.
    const bx = Math.max(x + pad, Math.min(SAFE.left + 8, x + w - pad - inner * 0.5))
    const by = Math.max(y + pad * 0.8, Math.min(SAFE.top + 8, y + h - pad - px * 6))
    title.visible = true
    title.scale.set(px / FONT_PX)
    title.position.set(bx + lead * px, by)
    if (glyph) this.icon(v, glyph, texts, bx, by + (px * 1.25 - px * ICON) / 2, px * ICON, color, la)
    title.alpha = la
    st.texts++
    let cy = by + px * 1.3

    // A file says how big it is and in what, not just that it is code.
    const lines = Number(el.metadata?.lines), ext = el.metadata?.path?.match(/\.(\w+)$/)?.[1]
    const inside = this.tree.children[i].length
    const kind = el.metadata?.path && lines > 0 ? `${lines} line${lines === 1 ? '' : 's'}${ext ? ` · ${ext}` : ''}` : inside ? `${el.kind} · ${inside} inside` : el.kind
    const subText = [kind, el.technology, ...el.tags.map(t => '#' + t)].filter(Boolean).join(' · ')
    const spx = Math.min(px * 0.62, 14)
    if (spx >= 6 && subText) {
      const sub = (v.sub ??= this.text(subText, texts))
      v.subEm ??= em(sub)
      // A long technology list is cut short rather than shrunk past reading; the panel has it all.
      const s = Math.max(Math.min(spx, inner / v.subEm), Math.min(spx, SUB_MIN))
      const shown = fitText(subText, v.subEm, inner, s)
      if (sub.text !== shown) sub.text = shown
      sub.visible = true
      sub.scale.set(s / FONT_PX)
      sub.position.set(bx, cy)
      sub.alpha = la * 0.65
      st.texts++
      cy += s * 1.6
    }

    // Past its last level a file shows its own source, anchored to the card so zooming reads it.
    const code = el.metadata?.path && w >= CODE_W ? codeBox(x, y, w, h) : null
    if (code) this.codeSlots.push({ i, ...code, alpha: la })
    const bottom = code ? code.y - pad * 0.4 : y + h - pad * 0.6

    // Under a lens the card speaks in its value; a description would run under it.
    if (el.description && !this.lens) {
      const dpx = Math.min((FONT_PX * inner) / DESC_WRAP, 14)
      if (dpx >= 9) {
        const desc = (v.desc ??= this.text(shortText(el.description, 150), texts, DESC_WRAP))
        // Measured at scale 1: the text keeps last frame's scale until it is set again below.
        const dh = (desc.height / (desc.scale.y || 1)) * (dpx / FONT_PX)
        if (dh <= bottom - cy) {
          desc.visible = true
          desc.scale.set(dpx / FONT_PX)
          desc.position.set(bx, cy)
          desc.alpha = la * 0.8
          st.texts++
          cy += dh + dpx
        }
      }
    }

    // A closed container lists what it holds, so its card says what opening it will show.
    const kids = this.tree.children[i]
    if (kids.length && !this.lens) {
      const ipx = Math.min((FONT_PX * inner) / DESC_WRAP, 13)
      if (ipx >= 9) {
        const list = (v.inside ??= this.text(shortText(`Inside: ${kids.map(k => this.tree.els[k].title).join(' · ')}`, 170), texts, DESC_WRAP))
        const ih = (list.height / (list.scale.y || 1)) * (ipx / FONT_PX)
        if (ih <= bottom - cy) {
          list.visible = true
          list.scale.set(ipx / FONT_PX)
          list.position.set(bx, cy)
          list.alpha = la * 0.6
          st.texts++
          cy += ih + ipx
        }
      }
    }

    // Dossier: once a leaf is most of the screen, it lists what it talks to (a file shows its code instead).
    if (!code && w > 640 && cy < y + h - 80) {
      const dossier = (v.dossier ??= this.text(this.dossierText(i), texts, DESC_WRAP * 1.2))
      const s = 13 / FONT_PX
      if (dossier.text && cy + (dossier.height / (dossier.scale.y || 1)) * s < y + h - pad) {
        dossier.visible = true
        dossier.scale.set(s)
        dossier.position.set(bx, cy + 10)
        dossier.alpha = la * 0.75
        st.texts++
      }
    }
  }

  private icon(v: NodeView, glyph: Glyph, layer: Container, x: number, y: number, size: number, color: number, alpha: number) {
    const s = (v.icon ??= (() => { const sp = new Sprite(this.icons.get(glyph)!); layer.addChild(sp); return sp })())
    s.visible = true
    s.position.set(x, y)
    s.width = s.height = size
    s.tint = mix(color, 0xffffff, 0.45)
    s.alpha = alpha * 0.9
  }

  /** Relations crossing element i's boundary: from it or anything inside it, to the outside and back. */
  relationsOf(i: number) {
    type Rel = { other: number; title: string; evidence?: EvidenceJson[] }
    const out: Rel[] = [], inn: Rel[] = []
    const r = this.tree.rels
    const inside = (n: number) => n === i || this.tree.isAncestor(i, n)
    for (let k = 0; k < r.length; k += 2) {
      const title = this.tree.relTitles[k >> 1] || 'uses', evidence = this.tree.relEvidence[k >> 1]
      const si = inside(r[k]), ti = inside(r[k + 1])
      if (si && !ti) out.push({ other: r[k + 1], title, evidence })
      if (ti && !si) inn.push({ other: r[k], title, evidence })
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
    const labelSpots: { x: number; y: number; s: string; kind: Kind; weight: number }[] = []
    const paths: number[][][] = [[], [], [], [], []]
    const heads: number[][] = [[], [], [], [], []]
    const sel = this.selected > 0

    const drawn: { e: ShownEdge; kind: Kind; pts: number[]; sOn: boolean; tOn: boolean }[] = []
    const flows: Flow[] = []
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
    // Inside a file the screen is its code: chips naming off-screen ends would sit on it, so only
    // the focused card's chips stay.
    const crumb = this.breadcrumb(), here = crumb[crumb.length - 1] ?? 0
    const reading = here > 0 && !this.tree.children[here].length

    for (const { e, kind, pts, sOn, tOn } of drawn) {
      const hot = kind === Kind.Out || kind === Kind.In
      // Clip to the screen; an end that leaves it gets a chip naming where the edge goes.
      let clipped = pts
      if (!tOn || !sOn) {
        const c = clipToScreen(pts, W, H, sOn, SAFE)
        if (!c) continue
        clipped = c
        if (hot || (!sel && !reading)) {
          const off = sOn ? e.t : e.s
          const k = sOn ? clipped.length - 2 : 0
          const chip = chipTargets.get(off)
          if (chip) chip.count += e.count
          else chipTargets.set(off, { x: clipped[k], y: clipped[k + 1], count: e.count, kind })
        }
      }
      paths[kind].push(clipped)
      if (hot) flows.push({ pts: clipped, color: kind === Kind.Out ? OUT : IN, both: e.both })
      st.edges++
      const n = pts.length
      if (tOn) heads[kind].push(pts[n - 4], pts[n - 3], pts[n - 2], pts[n - 1])
      if (sOn && e.both) heads[kind].push(pts[2], pts[3], pts[0], pts[1])
      // Every edge with room says what it carries, on its own last stretch beside the card it
      // reaches: the middle of a route is often a trunk many edges share, where a count could
      // belong to any of them. Busier edges claim the space first (drawLabels).
      if (sOn && tOn) {
        const m = endStretch(pts)
        const n = hot ? e.focusCount : e.count, rel = hot ? e.focusRel : e.rel
        // One import named after the card it reaches says nothing the arrow does not.
        const s = n > 1 ? `${n} relations` : this.tree.relTitles[rel]
        if (m && s && s !== this.tree.els[e.t].title && s !== this.tree.els[e.s].title) labelSpots.push({ x: m[0], y: m[1], s, kind, weight: n })
      }
    }

    // Busy screens get quieter lines; a selection pushes everything else into the background.
    // Many edges at rest fade to faint strokes (96 in a busy component); focus draws its own bright.
    const base = sel ? 0.1 : focus > 0 ? 0.22 : Math.max(0.14, Math.min(0.75, 0.85 - drawn.length / 130))
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
    // A dot where a line leaves a shared trunk, so a branch reads as a join, not as an edge from
    // the card beside it. Quiet lines are dotted together, highlighted ones in their own colour.
    const dots: [Graphics, number[][], number, number, number][] = [
      [g, [...paths[Kind.Thin], ...paths[Kind.Mid], ...paths[Kind.Thick]], EDGE, Math.min(1, base * 1.6), 3],
      [hg, paths[Kind.Out], OUT, 1, 3.6], [hg, paths[Kind.In], IN, 1, 3.6],
    ]
    for (const [gg, ps, color, alpha, r] of dots) {
      const j = junctions(ps)
      for (let k = 0; k < j.length; k += 2) gg.circle(j[k], j[k + 1], r)
      if (j.length) gg.fill({ color, alpha })
    }

    st.particles = this.particles.update(flows, this.time)
    st.chips = this.drawChips(chipTargets, W, H)
    this.drawLabels(labelSpots)
  }

  /** Expanding rings around containers that just opened: the map acknowledging a new level. */
  private drawPulses() {
    const g = this.fxG
    this.pulses = this.pulses.filter(p => this.time - p.t0 < 750)
    for (const p of this.pulses) {
      const u = (this.time - p.t0) / 750
      const e = 1 - (1 - u) ** 3
      const [x, y, w, h] = this.screenRect(p.node)
      const grow = 6 + e * 46
      g.roundRect(x - grow, y - grow, w + grow * 2, h + grow * 2, 14 + grow * 0.5)
      g.stroke({ width: 2.5 * (1 - u) + 0.5, color: 0x7dd3fc, alpha: (1 - u) * 0.8 })
    }
  }

  /** Targeting brackets: hover gets a thin set, selection locks on with a snap and breathes. */
  private drawReticles() {
    const g = this.fxG
    const corners = (i: number, pad: number, len: number, width: number, color: number, alpha: number) => {
      const [x, y, w, h] = this.screenRect(i)
      if (w < 8 || x + w < -50 || y + h < -50 || x > this.cam.w + 50 || y > this.cam.h + 50) return
      const L = Math.min(len, w * 0.3, h * 0.3)
      const x0 = x - pad, y0 = y - pad, x1 = x + w + pad, y1 = y + h + pad
      g.moveTo(x0, y0 + L).lineTo(x0, y0).lineTo(x0 + L, y0)
      g.moveTo(x1 - L, y0).lineTo(x1, y0).lineTo(x1, y0 + L)
      g.moveTo(x1, y1 - L).lineTo(x1, y1).lineTo(x1 - L, y1)
      g.moveTo(x0 + L, y1).lineTo(x0, y1).lineTo(x0, y1 - L)
      g.stroke({ width, color, alpha, cap: 'square' })
    }
    if (this.hover > 0 && this.hover !== this.selected) corners(this.hover, 5, 18, 1.5, 0xcbd5e1, 0.7)
    if (this.target > 0 && this.target !== this.selected) corners(this.target, 7 + Math.sin(this.time / 180) * 2, 22, 2, IN, 0.95)
    if (this.selected > 0) {
      const u = Math.min(1, (this.time - this.selectedAt) / 280)
      const snap = 1 - (1 - u) ** 3
      const pad = 8 + (1 - snap) * 60 + Math.sin(this.time / 260) * 2 * snap
      corners(this.selected, pad, 28, 2.5, 0xfbbf24, 0.35 + 0.65 * snap)
    }
  }

  /** The route as a lit path through the gutters, with numbered waypoints on the cards it visits. */
  private drawRoute() {
    const g = this.routeG
    g.clear()
    if (!this.route) { for (const m of this.markers) m.bg.visible = m.text.visible = false; return }
    const stops: number[] = [this.route[0].from, ...this.route.map(h => h.to)]
    const paths: number[][] = []
    for (const h of this.route) {
      const a = this.rep(h.from), b = this.rep(h.to)
      if (a === b || this.tree.isAncestor(a, b) || this.tree.isAncestor(b, a)) continue
      const world = h.reversed ? this.router.route(b, a) : this.router.route(a, b)
      paths.push(world ? this.toScreen(world) : straight(this.screenRect(a), this.screenRect(b)))
    }
    for (const [width, alpha] of [[9, 0.18], [3, 0.95]] as const) {
      for (const p of paths) { g.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) g.lineTo(p[k], p[k + 1]) }
      g.stroke({ width, color: ROUTE, alpha, join: 'round', cap: 'round' })
    }
    // Waypoint numbers: one per stop, on the card that stands for it now.
    let k = 0
    const seen = new Set<number>()
    stops.forEach((n, i) => {
      const r = this.rep(n)
      if (seen.has(r) || !this.onScreen(r)) return
      seen.add(r)
      const [x, y, w] = this.screenRect(r)
      const m = (this.markers[k] ??= this.makeChip())
      const label = `${i + 1}`
      if (m.text.text !== label) m.text.text = label
      m.text.scale.set(13 / FONT_PX)
      const cw = Math.max(22, m.text.width + 12), ch = 22
      const cx = Math.min(Math.max(x + w / 2 - cw / 2, SAFE.left), this.cam.w - cw - SAFE.right), cy = Math.max(y - ch / 2, SAFE.top)
      m.bg.position.set(cx, cy)
      m.bg.width = cw; m.bg.height = ch
      m.bg.tint = i === this.routeStep ? 0xffffff : ROUTE
      m.bg.alpha = 1
      m.text.tint = 0x052e16
      m.text.position.set(cx + (cw - m.text.width) / 2, cy + (ch - 13 * 1.25) / 2)
      m.bg.visible = m.text.visible = true
      k++
    })
    for (let j = k; j < this.markers.length; j++) this.markers[j].bg.visible = this.markers[j].text.visible = false
  }

  /** Pins: a marker on the card, or at the screen edge pointing the way when it is off screen. */
  private drawPins() {
    const g = this.fxG
    const W = this.cam.w, H = this.cam.h
    this.pins.forEach((p, i) => {
      const r = this.rep(p)
      const [x, y, w, h] = this.screenRect(r)
      const label = this.tree.els[p].title
      if (this.onScreen(r) && w > 6) {
        const mx = x + w - 4, my = y + 4, s = 9
        g.poly([mx, my - s, mx + s * 0.8, my, mx, my + s, mx - s * 0.8, my]).fill({ color: PIN }).stroke({ width: 1.5, color: 0x1f0614 })
        if (w > 120) this.pinLabel(i, label, mx + 12, my - 9, false)
        else this.pinLabel(i, '', 0, 0, true)
      } else {
        // Off screen: clamp the direction to the target onto the screen border.
        const cx = W / 2, cy = H / 2, tx = x + w / 2, ty = y + h / 2
        const dx = tx - cx, dy = ty - cy
        const k = Math.min((W / 2 - 60) / Math.abs(dx || 1e-9), (H / 2 - 70) / Math.abs(dy || 1e-9))
        const ex = cx + dx * k, ey = cy + dy * k
        const a = Math.atan2(dy, dx)
        g.poly([ex + Math.cos(a) * 14, ey + Math.sin(a) * 14, ex + Math.cos(a + 2.4) * 9, ey + Math.sin(a + 2.4) * 9, ex + Math.cos(a - 2.4) * 9, ey + Math.sin(a - 2.4) * 9]).fill({ color: PIN })
        this.pinLabel(i, `◆ ${label}`, ex - Math.cos(a) * 18, ey - Math.sin(a) * 18, false, true)
      }
    })
    for (let j = this.pins.length; j < this.pinChips.length; j++) this.pinChips[j].bg.visible = this.pinChips[j].text.visible = false
  }

  private pinChips: Chip[] = []
  private pinLabel(i: number, label: string, x: number, y: number, hide: boolean, centred = false) {
    const c = (this.pinChips[i] ??= this.makeChip())
    if (hide || !label) { c.bg.visible = c.text.visible = false; return }
    if (c.text.text !== label) c.text.text = shortText(label, 40)
    c.text.scale.set(12 / FONT_PX)
    const cw = c.text.width + 14, ch = 20
    const px = Math.min(Math.max(centred ? x - cw / 2 : x, SAFE.left), this.cam.w - cw - SAFE.right)
    const py = Math.min(Math.max(centred ? y - ch / 2 : y, SAFE.top), this.cam.h - ch - SAFE.bottom)
    c.bg.position.set(px, py)
    c.bg.width = cw; c.bg.height = ch
    c.bg.tint = mix(PIN, BG, 0.25)
    c.bg.alpha = 1
    c.text.tint = 0x1f0614
    c.text.position.set(px + 7, py + (ch - 12 * 1.25) / 2)
    c.bg.visible = c.text.visible = true
  }

  /** Removes everything this renderer drew, when a new model version replaces it. */
  destroy() {
    this.stage.destroy({ children: true })
  }

  /** Screen rect of a node, for overlays positioned by the controls. */
  screenRectOf(i: number) { return this.screenRect(i) }

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
      let x = Math.min(Math.max(c.x - cw / 2, SAFE.left), W - cw - SAFE.right)
      let y = Math.min(Math.max(c.y - ch / 2, SAFE.top), H - ch - SAFE.bottom)
      // Keep chips off the HUD: lift them above the panels along the bottom (the minimap), and
      // step them past any along the side; then back inside the screen.
      // A few passes: lifting a chip above the help line can put it under the minimap.
      for (let pass = 0; pass < 4; pass++) {
        let moved = false
        for (const [hx, hy, hw, hh] of this.hud) {
          if (!hw || !(x < hx + hw && hx < x + cw && y + ch > hy && y < hy + hh)) continue
          if (hy > H / 2) y = hy - ch - 4
          else x = hx < W / 2 ? hx + hw + 4 : hx - cw - 4
          moved = true
        }
        if (!moved) break
      }
      x = Math.min(Math.max(x, SAFE.left), W - cw - SAFE.right)
      y = Math.min(Math.max(y, SAFE.top), H - ch - SAFE.bottom)
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

  private drawLabels(spots: { x: number; y: number; s: string; kind: Kind; weight: number }[]) {
    let k = 0
    const placed: number[][] = []
    // Highlighted edges claim label space first, then the busiest.
    spots.sort((a, b) => b.kind - a.kind || b.weight - a.weight)
    for (const sp of spots) {
      if (k >= 60 || !sp.s) continue
      const lab = (this.labels[k] ??= this.makeChip())
      // Labels sit in gutters, so they stay short; the details panel has the full text.
      const label = shortText(sp.s, 34)
      if (lab.text.text !== label) lab.text.text = label
      const px = 11
      lab.text.scale.set(px / FONT_PX)
      const cw = lab.text.width + 12, ch = px * 1.8
      const x = sp.x - cw / 2, y = sp.y - ch / 2
      // A label cut by the screen edge or under the HUD reads as noise ("2 re"): it waits for room.
      if (x < SAFE.left || y < SAFE.top || x + cw > this.cam.w - SAFE.right || y + ch > this.cam.h - SAFE.bottom) continue
      if (this.hud.some(([hx, hy, hw, hh]) => hw && x < hx + hw && hx < x + cw && y < hy + hh && hy < y + ch)) continue
      if (this.badges.some(([bx, by, bw, bh]) => x < bx + bw && bx < x + cw && y < by + bh && by < y + ch)) continue
      // Labels live in the gutters: never on a card someone is reading (a closed card or a file).
      if (this.shown.some(c => {
        if (this.tree.children[c].length && this.open(c) > 0) return false
        const [cx, cy, cw2, ch2] = this.screenRect(c)
        return x < cx + cw2 && cx < x + cw && y < cy + ch2 && cy < y + ch
      })) continue
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

/** 1234 → 1.2k, for badges. */
function compact(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n))
}

/** Width of a label per px of font size, independent of how it is scaled right now. */
function em(t: BitmapText) {
  return t.width / (t.scale.x || 1) / FONT_PX || 1
}

/** One line of text, whitespace runs collapsed, cut to `max` characters with an ellipsis. */
/**
 * Where lines branch: bends of one polyline that sit on another line, so that three or more
 * directions meet. Plain crossings have no bend there and are left out. Returns x, y pairs.
 */
export function junctions(paths: number[][], eps = 0.75): number[] {
  // Axis-aligned segments indexed by their fixed coordinate, so each bend checks only its row and column.
  const vert = new Map<number, number[]>(), horiz = new Map<number, number[]>()
  const add = (m: Map<number, number[]>, key: number, a: number, b: number) => { const k = Math.round(key); (m.get(k) ?? m.set(k, []).get(k)!).push(key, Math.min(a, b), Math.max(a, b)) }
  for (const p of paths) for (let k = 2; k < p.length; k += 2) {
    const x0 = p[k - 2], y0 = p[k - 1], x1 = p[k], y1 = p[k + 1]
    if (Math.abs(x0 - x1) < eps) add(vert, x0, y0, y1)
    else if (Math.abs(y0 - y1) < eps) add(horiz, y0, x0, x1)
  }
  const near = (m: Map<number, number[]>, key: number) => [...(m.get(Math.round(key) - 1) ?? []), ...(m.get(Math.round(key)) ?? []), ...(m.get(Math.round(key) + 1) ?? [])]
  const out: number[] = [], seen = new Set<string>()
  for (const p of paths) for (let k = 2; k < p.length - 2; k += 2) {
    const x = p[k], y = p[k + 1]
    const id = `${Math.round(x)},${Math.round(y)}`
    if (seen.has(id)) continue
    // Directions leaving the point: 1 up, 2 right, 4 down, 8 left.
    let mask = 0
    const v = near(vert, x)
    for (let s = 0; s < v.length; s += 3) {
      if (Math.abs(v[s] - x) >= eps || y < v[s + 1] - eps || y > v[s + 2] + eps) continue
      if (y > v[s + 1] + eps) mask |= 1
      if (y < v[s + 2] - eps) mask |= 4
    }
    const h = near(horiz, y)
    for (let s = 0; s < h.length; s += 3) {
      if (Math.abs(h[s] - y) >= eps || x < h[s + 1] - eps || x > h[s + 2] + eps) continue
      if (x > h[s + 1] + eps) mask |= 8
      if (x < h[s + 2] - eps) mask |= 2
    }
    if ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1) >= 3) { seen.add(id); out.push(x, y) }
  }
  return out
}

/** `s` cut with an ellipsis to fit `width` at font size `px`, given its full width per px. */
export function fitText(s: string, emFull: number, width: number, px: number): string {
  // A pixel of slack: a title sized to fill its room exactly must not be cut by rounding.
  if (emFull * px <= width + 1) return s
  return shortText(s, Math.max(2, Math.floor((s.length * width) / (emFull * px))))
}

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
/**
 * Where an edge's label goes: the middle of the last stretch long enough to hold it, counting back
 * from the card it reaches, or null when the edge has none.
 */
function endStretch(pts: number[]): [number, number] | null {
  for (let k = pts.length - 2; k >= 2; k -= 2) {
    const l = Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1])
    if (l >= 56) return [(pts[k] + pts[k - 2]) / 2, (pts[k + 1] + pts[k - 1]) / 2]
  }
  return null
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
