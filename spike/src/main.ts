import { Application } from 'pixi.js'
import { Camera } from './camera'
import { CodeView } from './code'
import { installControls } from './controls/install'
import { relationsAcross, renderDetails, renderEdge, renderLines, renderOutline, type PanelActions, type PanelRows } from './details'
import { LensBar, ago } from './hud'
import { CARD_W, importance, layoutJobs, placeWorld, rankKey, ranks, siblingPartners, type World } from './layout'
import { runLayout } from './layoutPool'
import { buildLenses, type LensName } from './lens'
import { Minimap } from './minimap'
import { renderModelTabs } from './models'
import { describeDiff, diffModels, reuseLayouts, stableOrder, startRects } from './live'
import { Tree, type ModelJson } from './model'
import { placeUrl, Places } from './places'
import { Reader } from './reader'
import { OPEN_A, Renderer, safeTop, setSafeTop } from './render'
import { synthetic } from './synthetic'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const modelName = new URLSearchParams(location.search).get('model') ?? 'acme'
/** A second view of the same import, such as its requests; it reads code from the import's repo. */
const view = new URLSearchParams(location.search).get('view')
/** The Connections view lays out the architecture model by connection; other views have their own model. */
const coupling = view === 'connections'
const modelFile = view && !coupling ? `${modelName}.${view}` : modelName
/** The largest on-screen font size the wheel zooms code on the map to. */
const MAX_READ_PX = 28
const TYPES_KEY = 'zoom.showTypes'

/** After the breadcrumb, what an uploaded map was built from, so an old map does not pass for a current one. */
function provenance(p: ModelJson['published'], uploaded: boolean): HTMLElement[] {
  const s = document.createElement('span')
  s.className = 'provenance'
  // An upload from before uploads recorded their commit says so, rather than passing for a current one.
  if (!p) {
    if (!uploaded) return []
    s.textContent = 'age unknown'
    s.title = 'Uploaded before uploads recorded their commit; publishing it again shows when and from what it was built'
    return [s]
  }
  s.textContent = [p.commit ? `${p.commit.slice(0, 7)}${p.dirty ? '+' : ''}` : 'no commit', ago(p.at)].filter(Boolean).join(' · ')
  s.title = `Uploaded ${new Date(p.at).toLocaleString()} from ${p.commit ? `commit ${p.commit}${p.dirty ? ' plus uncommitted changes' : ''}` : 'a folder outside git'}`
  // The viewer never reads the project, so it cannot know of newer commits: past a fortnight an
  // upload is flagged as likely behind its code.
  if (Date.now() - Date.parse(p.at) > STALE_DAYS * 86400_000) {
    s.classList.add('stale')
    s.title += `. Over ${STALE_DAYS} days old: the code has likely moved on; publishing again brings the map up to date.`
  }
  return [s]
}
/** An upload older than this many days is flagged as likely behind its code. */
const STALE_DAYS = 14

async function loadModel(): Promise<ModelJson> {
  if (modelName === 'synthetic') return synthetic(Number(new URLSearchParams(location.search).get('n') ?? 1000))
  const res = await fetch(`${import.meta.env.BASE_URL}models/${modelFile}.json`)
  // A dev server answers an unknown file with its page: no JSON is no map, as a 404 is.
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error(`model ${modelFile}: ${res.ok ? 404 : res.status}`)
  return res.json()
}

const ring = (n: number) => ({ a: new Float64Array(n), k: 0, full: false })
type Ring = ReturnType<typeof ring>
const push = (r: Ring, v: number) => { r.a[r.k] = v; r.k = (r.k + 1) % r.a.length; if (!r.k) r.full = true }
const values = (r: Ring) => Array.from(r.full ? r.a : r.a.slice(0, r.k))
const pct = (v: number[], p: number) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

const INTRO_SEEN = 'zoom.introSeen'
/**
 * On a first visit, a short welcome: what the map shows, its counts (parts, files, features), how
 * to go in, and its features as places to start. It stays until Got it, at any width.
 */
function showIntro(tree: Tree, feature: (name: string) => void) {
  let seen = false
  try { seen = localStorage.getItem(INTRO_SEEN) === '1' } catch { /* storage blocked: show it this time */ }
  if (seen) return
  const box = $('welcome')
  const files = tree.els.filter(e => e.metadata?.path).length, parts = tree.children[0].length
  const features = [...new Set(tree.els.flatMap(e => e.features ?? []))]
  const p = document.createElement('p'), b = document.createElement('b')
  b.textContent = tree.els[0].title
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  p.append(b, ` is mapped here: ${[n(parts, 'part'), ...(files ? [n(files, 'file')] : []), ...(features.length ? [n(features.length, 'feature')] : [])].join(', ')}. Cards are its parts, arrows show what uses what (thicker carries more). Scroll into a card to open it, double-click a file to read it, ? for every control.`)
  const chips = document.createElement('div')
  chips.className = 'chips'
  if (features.length) {
    const h = document.createElement('span')
    h.textContent = 'Start with a feature:'
    chips.append(h, ...features.slice(0, 10).map(f => { const c = document.createElement('button'); c.textContent = f; c.onclick = () => feature(f); return c }))
  }
  const ok = document.createElement('button')
  ok.className = 'ok'
  ok.textContent = 'Got it'
  ok.onclick = () => { try { localStorage.setItem(INTRO_SEEN, '1') } catch { /* private mode */ } box.hidden = true }
  box.replaceChildren(p, ...(features.length ? [chips] : []), ok)
  box.hidden = false
}

/** Says, in the map's place, why there is no map to show: an unknown name or view, or a failed load. */
async function cannotOpen(e: unknown) {
  const box = $('failed')
  const h = document.createElement('h2'), p = document.createElement('p')
  const status = String(e).match(/: (\d{3})$/)?.[1]
  h.textContent = status === '404' ? (view ? `“${modelName}” has no ${view} view` : `No map named “${modelName}”`) : 'The map could not be opened'
  p.textContent = status === '404' ? 'Open one of these instead:' : String(e)
  const list = document.createElement('div')
  list.className = 'maps'
  try {
    const index: { name: string; title: string }[] = await (await fetch(`${import.meta.env.BASE_URL}models/index.json`)).json()
    if (view && index.some(m => m.name === modelName)) { const a = document.createElement('a'); a.href = `?model=${encodeURIComponent(modelName)}`; a.textContent = `${modelName}: Architecture`; list.append(a) }
    for (const m of index) { const a = document.createElement('a'); a.href = `?model=${encodeURIComponent(m.name)}`; a.textContent = m.title; list.append(a) }
  } catch { /* no index: the message stands alone */ }
  box.replaceChildren(h, p, list)
  box.hidden = false
}

/** The most recently uploaded map, for a visit that names none; null when only samples exist. */
async function latestUpload(): Promise<string | null> {
  try {
    const index: { name: string; source: string; at?: string }[] = await (await fetch(`${import.meta.env.BASE_URL}models/index.json`, { cache: 'no-store' })).json()
    const uploads = index.filter(e => e.source === 'import').sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    return uploads[0]?.name ?? null
  } catch { return null }
}

async function main() {
  // A visit that names no map opens the latest upload, a real project, rather than a sample.
  if (!new URLSearchParams(location.search).has('model')) {
    const latest = await latestUpload()
    if (latest) { location.replace(`?model=${encodeURIComponent(latest)}`); return }
  }
  const t0 = performance.now()
  // Whether the open model is a project's upload (not a sample), for its provenance in the breadcrumb.
  let uploaded = false, crumbsStale = false
  void renderModelTabs($('models'), $('views'), modelName, new URLSearchParams(location.search).get('n'), view)
    .then(entry => { uploaded = entry?.source === 'import'; crumbsStale = true })
  const model = await loadModel()
  // The current model version; live updates replace all four.
  // Type-only imports are drawn only when asked (the arrow legend's toggle), remembered per viewer.
  let showTypes = false
  try { showTypes = localStorage.getItem(TYPES_KEY) === '1' } catch { /* storage blocked */ }
  /** The model as last loaded, so the toggle can lay it out again with or without type-only imports. */
  let raw = model
  let tree = new Tree(model, { types: showTypes })
  let published = model.published
  let jobs = layoutJobs(tree, coupling)
  const tLayout = performance.now()
  let local = await runLayout(jobs)
  const layoutMs = performance.now() - tLayout
  let world: World = placeWorld(tree, local)

  const app = new Application()
  await app.init({ resizeTo: $('stage'), background: '#04060c', antialias: true, autoDensity: true, resolution: devicePixelRatio, preference: 'webgl' })
  $('stage').appendChild(app.canvas)
  // The map takes keyboard focus like any control, so its keys act only when it has it.
  app.canvas.tabIndex = 0
  app.canvas.setAttribute('aria-label', 'Map: arrow keys move, + and − zoom, ? lists the controls')
  Renderer.installFont()
  const cam = new Camera()
  let renderer = new Renderer(app, tree, world, cam)
  // In the Connections view each card shows its rank among its siblings and how connected it is.
  const rankFor = (t: Tree) => { if (!coupling) return null; const w = importance(t); return { weight: w, rank: ranks(t, rankKey(t)), partners: siblingPartners(t) } }
  renderer.ranking = rankFor(tree)
  app.stage.addChild(renderer.stage)
  const minimapEl = $<HTMLCanvasElement>('minimap'), emptyHint = $('empty')
  const minimap = new Minimap(minimapEl, tree, world)
  $('fitall').onclick = () => controls.go(0)
  const code = new CodeView($('code'), modelName, tree)
  // Reduced motion: no flights, the view cuts to where it goes.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const motion = () => { cam.maxFlightMs = reduced.matches ? 0 : 700 }
  motion()
  reduced.addEventListener('change', motion)

  // The clock: real time normally; a recorder can switch to manual and step frames exactly.
  let manual = false, simNow = performance.now()
  const now = () => (manual ? simNow : performance.now())

  /**
   * The camera that shows node i in the screen the panels leave free: below the top bar and the
   * breadcrumb, left of the details panel, and beside or above the minimap, whichever leaves it
   * larger. A container fills that space; a single file is shown among its neighbours.
   */
  const frameFor = (i: number) => {
    const r = world.rect, W = cam.w, H = cam.h
    const box = (id: string) => { const e = document.getElementById(id); return e && !e.hidden && e.getClientRects().length ? e.getBoundingClientRect() : null }
    const top = box('top'), panel = box('details'), mini = box('minimap')
    const t = (top?.bottom ?? 0) + 8
    // A panel over the map (narrow: the bottom sheet) takes its share; a column beside it is off the map already.
    const sheet = panel && panel.top > H / 2 ? panel : null
    const right = panel && !sheet && panel.left < W ? panel.left - 12 : W, bottom = sheet ? sheet.top - 12 : H - 28
    const over = mini && mini.left < W ? mini : null
    const frames: [number, number, number, number][] = [[0, t, right, bottom]]
    if (over && !panel) frames[0] = [0, t, right, over.top - 8]
    if (over) frames.push([0, t, Math.min(right, over.left - 8), bottom])
    const fill = i === 0 ? 0.96 : tree.children[i].length ? 0.9 : 0.4
    const w = r[i * 4 + 2], h = r[i * 4 + 3]
    // A crowded level framed with a margin can come out too small to open: it uses the margin, up
    // to filling its frame, so its children are drawn with their names.
    const opens = i > 0 && tree.children[i].length ? (OPEN_A + 12) / (CARD_W * world.content[i * 3 + 2]) : 0
    let best = { z: 0, x: 0, y: 0 }
    for (const [l, tt, rr, bb] of frames) {
      const fw = Math.max(40, rr - l), fh = Math.max(40, bb - tt)
      const whole = Math.min(fw / w, fh / h)
      const z = Math.min(whole, Math.max(fill * whole, opens))
      if (z <= best.z) continue
      // The target's centre goes to the frame's centre.
      best = { z, x: r[i * 4] + w / 2 - ((l + rr) / 2 - W / 2) / z, y: r[i * 4 + 1] + h / 2 - ((tt + bb) / 2 - H / 2) / z }
    }
    return best
  }
  const fit = (i = 0) => {
    const f = frameFor(i), vw = cam.w / f.z, vh = cam.h / f.z
    cam.flyTo(f.x - vw / 2, f.y - vh / 2, vw, vh, now(), 1)
  }
  const resize = () => {
    cam.resize(app.screen.width, app.screen.height)
    measureHud()
  }
  // Where the panels over the map are, so chips and labels keep off them: measured again on a timer,
  // since the details panel opens and closes and layout settles after the first frame.
  const measureHud = () => {
    renderer.hud = ['stats', 'minimap', 'help', 'details'].map(id => { const e = document.getElementById(id) ?? document.querySelector(`.${id}`); const r = e && !e.hidden ? e.getBoundingClientRect() : null; return r ? [r.x, r.y, r.width, r.height] : [0, 0, 0, 0] })
  }
  {
    cam.resize(app.screen.width, app.screen.height)
    const f = frameFor(0)
    cam.set(f.x, f.y, f.z)
  }
  // Pixi applies a window resize a frame later; reading the screen before that keeps the old
  // size, and everything outside it is culled as off-screen.
  app.renderer.on('resize', resize)
  // The bar wraps on a phone: what sits under it (the reader, the lens legend) follows its height.
  new ResizeObserver(() => {
    const h = $('top').getBoundingClientRect().height
    document.documentElement.style.setProperty('--bar', `${h}px`)
    setSafeTop(h)
  }).observe($('top'))

  // Selection: click a card to focus its relations; the panel lists them, each a jump.
  const details = $('details')
  let controls: ReturnType<typeof installControls>
  /**
   * How far the wheel may zoom in at a screen point: a file until its code reads comfortably (or,
   * with no code to show, to a screen and a half); empty space in a card until that card is a
   * screen and a half wide, so a wheel on a gutter never dives into nothing. Pointing at a card
   * inside goes on.
   */
  const zoomLimit = (sx: number, sy: number) => {
    const i = renderer.pick(sx, sy)
    if (i > 0 && !tree.children[i].length) {
      const font = code.fontOf(i)
      if (font) return (cam.z * MAX_READ_PX) / font
    }
    // Empty space in a container: on until its smallest card is most of a screen wide, so the
    // wheel never strands you in a gap, yet always reaches readable names.
    const c = Math.max(0, i), kids = tree.children[c]
    const smallest = kids.length ? Math.min(...kids.map(k => world.rect[k * 4 + 2])) : world.rect[c * 4 + 2]
    return Math.max((cam.w * 1.5) / world.rect[c * 4 + 2], (cam.w * 0.6) / smallest)
  }
  /** How far the wheel may zoom out: a little past the whole landscape. */
  const zoomFloor = () => 0.5 * Math.min((cam.w * 0.92) / world.rect[2], (cam.h * 0.92) / world.rect[3])
  /**
   * The card showing a file, nearest element `near`: in the Requests view one file is a step of
   * many endpoints, and a line cited in this endpoint opens in this endpoint's card.
   */
  const cardOf = (path: string, near: number) => {
    let best = -1, depth = -1
    for (let i = 1; i < tree.size; i++) {
      if (tree.els[i].metadata?.path !== path) continue
      const d = near > 0 ? tree.depth[tree.lca(i, near)] : 0
      if (d > depth) { best = i; depth = d }
    }
    return best
  }
  /** Where a card's own code starts: the part of the file it stands for, else its first line. */
  const startOf = (i: number) => Number(tree.els[i].metadata?.span?.split('-')[0]) || 1
  /** The file being read and its line, while its card is the selection or the place you are in. */
  let reading: { id: string; line: number } | null = null
  const reader = new Reader()
  reader.onLine = line => { if (reading) reading.line = line }
  reader.onClose = () => { reading = null; document.body.classList.remove('reading'); app.canvas.focus({ preventScroll: true }) }
  /**
   * Reads card i's file at a line: the card is selected and framed among its neighbours, and its
   * code opens over the map in one scrolling column. Double-click, Enter, Read code and a cited
   * line all come here.
   */
  const openCode = async (i: number, line: number) => {
    const path = tree.els[i]?.metadata?.path
    if (i <= 0 || !path) return
    if (renderer.selected !== i) controls.goSelect(i)
    // Fetching and preparing a big file takes a moment; say so at once.
    controls.toast.show(`Opening ${path.split('/').pop()}:${line}`)
    const src = await code.prepared(i)
    reading = { id: tree.els[i].id, line }
    document.body.classList.add('reading')
    reader.open(path, tree.els[i].title, tree.els[tree.parent[i]].title, line, src, () => void openCode(i, line))
  }
  const actions: PanelActions = {
    go: j => controls.goSelect(j),
    openPath: (path, line, near) => { const j = cardOf(path, near); if (j > 0) void openCode(j, line) },
    read: j => void openCode(j, startOf(j)),
    inspect: (a, b) => {
      const from = renderer.selected
      pickEdge({ s: a, t: b }, relationsAcross(tree, a, b))
      edgeFrom = from
      const h = details.querySelector<HTMLElement>('h2')
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) }
    },
  }
  /** In the Connections view, why a card ranks where it does among its siblings. */
  const rankText = (i: number) => {
    const rk = renderer.ranking
    if (!rk || i <= 0) return undefined
    const peers = tree.children[tree.parent[i]].length
    return `#${rk.rank[i]} of ${peers} · reaches ${rk.partners[i]} of ${peers - 1} peer${peers === 2 ? '' : 's'} · ${rk.weight[i]} relation${rk.weight[i] === 1 ? '' : 's'}`
  }
  let rows: PanelRows = { uses: [], usedBy: [], mark: () => {} }
  /** The place the outline shows, while nothing is selected. */
  let outlined = -1
  const showDetails = () => {
    rows = renderDetails(details, tree, j => renderer.relationsOf(j), renderer.selected, actions, rankText(renderer.selected))
    outlined = -1
    if (renderer.selected <= 0) showOutline()
  }
  /** With nothing selected, the panel outlines the place you are in (renderOutline). */
  const showOutline = () => {
    const path = renderer.breadcrumb(), here = path[path.length - 1] ?? 0
    if (renderer.selected > 0 || here === outlined) return
    outlined = here
    // Keyboard focus in the outline stays on the same card across a redraw.
    const focused = details.contains(document.activeElement) ? (document.activeElement as HTMLElement).textContent : null
    renderOutline(details, tree, here, j => renderer.relationsOf(j), j => controls.goSelect(j))
    if (focused) [...details.querySelectorAll<HTMLElement>('.d-outline button')].find(b => b.textContent === focused)?.focus()
  }
  const select = (i: number) => {
    // Focus in the panel is lost when it redraws: it moves to the new heading instead of the page,
    // and back to the card's row in the outline when the selection is put down.
    const inPanel = details.contains(document.activeElement)
    const was = renderer.selected
    renderer.selected = i > 0 ? i : -1
    renderer.edge = null
    showDetails()
    if (i <= 0) {
      if (was > 0) $('announce').textContent = 'Selection cleared'
      if (inPanel) {
        // Its row when the outline lists it; else the outline's heading, so focus stays in the panel.
        const row = [...details.querySelectorAll<HTMLElement>('.d-outline button')].find(b => b.querySelector('b')?.textContent === tree.els[was]?.title)
        const heading = details.querySelector<HTMLElement>('h2')
        if (heading) heading.tabIndex = -1
        ;(row ?? heading ?? app.canvas).focus()
      }
      return
    }
    const heading = details.querySelector<HTMLElement>('h2')
    if (heading) heading.tabIndex = -1
    if (inPanel) { heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: 'nearest' }) }
    // A screen reader hears what was selected and how connected it is.
    $('announce').textContent = `Selected ${tree.els[i].title}: uses ${rows.uses.length}, used by ${rows.usedBy.length}`
  }
  /** Picks a line for the panel: what it carries and why, relation by relation. Null puts it down. */
  /** The selection an arrow was inspected from, by keyboard: putting the arrow down returns to it. */
  let edgeFrom = -1
  /**
   * Picks a line for the panel: what it carries and why, relation by relation. Several lines (a
   * shared trunk) list the arrows there, heaviest first, to pick one. Null puts it down.
   */
  const pickEdge = (l: { s: number; t: number } | { s: number; t: number; count: number }[] | null, rels?: number[]) => {
    const back = edgeFrom
    edgeFrom = -1
    if (Array.isArray(l) && l.length === 1) l = l[0]
    renderer.selected = -1
    if (!l) {
      renderer.edge = null
      if (back > 0) { select(back); const h = details.querySelector<HTMLElement>('h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) } return }
      return showDetails()
    }
    rows = { uses: [], usedBy: [], mark: () => {} }
    outlined = -1
    if (Array.isArray(l)) {
      const lines = [...l].sort((a, b) => b.count - a.count)
      renderer.edge = { s: lines[0].s, t: lines[0].t }
      return renderLines(details, tree, lines, one => pickEdge(one))
    }
    renderer.edge = { s: l.s, t: l.t }
    renderEdge(details, tree, l.s, l.t, rels ?? renderer.relationsBetween(l.s, l.t), actions)
  }

  // Lenses: strategy-game overlays colouring every card by one measure.
  const lenses = buildLenses(tree)
  const lensBar = new LensBar(lenses)
  const setLens = (name: LensName) => {
    renderer.lens = lenses.find(l => l.name === name) ?? null
    lensBar.show(renderer.lens)
  }
  lensBar.onPick = setLens
  lensBar.show(null)

  const places = new Places(v => {
    const r = reading && (v.selected === reading.id || v.here === reading.id) ? reading : null
    const path = r ? tree.els[tree.byId.get(r.id) ?? 0]?.metadata?.path : null
    return { at: v.selected, in: v.here, file: path, line: r?.line, lens: renderer.lens?.name ?? null }
  }, () => cam.w)
  controls = installControls({ app, tree, world, cam, renderer, minimap, lenses, connections: coupling, setLens, select, fit, now, zoomLimit, zoomFloor, read: i => void openCode(i, startOf(i)), rows: () => rows, places, pickEdge, closeTop: () => { if (!reader.isOpen) return false; reader.close(); return true } })
  resize()
  showIntro(tree, name => controls.feature(name))

  /**
   * What the arrows are: runtime calls, uses in code, and type-only imports, with the toggle that
   * shows or hides the last. Shown only for the kinds this map has.
   */
  const arrowLegend = () => {
    const box = $('arrows')
    const kinds = new Set(raw.relations.map(r => r.kind ?? (r.evidence ? 'runtime' : 'code')))
    const item = (cls: string, text: string) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s }
    // On a phone the legend folds into one button that opens it; wide, it is a heading.
    const toggle = document.createElement('button')
    toggle.className = 'a-toggle'
    toggle.textContent = 'Arrows'
    toggle.setAttribute('aria-expanded', String(box.classList.contains('open')))
    toggle.onclick = () => toggle.setAttribute('aria-expanded', String(box.classList.toggle('open')))
    const parts: HTMLElement[] = [item('a-head', 'Arrows'), toggle, item('a-code', 'uses in code')]
    if (kinds.has('runtime')) parts.push(item('a-runtime', 'calls at runtime'))
    // A map traced with the project's own tests tells the calls it could have seen and no test made,
    // when there are any: the dash is named only where one can be drawn.
    if (tree.relTraceable.some((t, k) => t && !tree.relSeen[k])) parts.push(item('a-unseen', 'calls not seen in tests'))
    if (kinds.has('types')) {
      parts.push(item('a-types', 'type-only imports'))
      const b = document.createElement('button')
      b.textContent = showTypes ? 'Hide' : 'Show'
      b.title = showTypes ? 'Hide type-only imports: compile-time coupling, not use' : 'Show type-only imports, dashed'
      b.setAttribute('aria-label', showTypes ? 'Hide type-only imports' : 'Show type-only imports')
      b.onclick = () => {
        showTypes = !showTypes
        try { localStorage.setItem(TYPES_KEY, showTypes ? '1' : '0') } catch { /* private mode */ }
        void swapModel(raw, 0, showTypes ? 'Type-only imports shown, dashed' : 'Type-only imports hidden')
      }
      parts.push(b)
    }
    box.replaceChildren(...parts)
    box.hidden = false
  }
  arrowLegend()

  // A link names a place: open there. The selection (`at`) is framed among its neighbours, a place
  // (`in`) fills the view; `file` finds a file's card (the Requests view has its own ids), and
  // `line` opens it there.
  {
    const q = new URLSearchParams(location.search)
    const lens = q.get('lens')
    if (lens && lenses.some(l => l.name === lens)) setLens(lens as LensName)
    const at = tree.byId.get(q.get('at') ?? '') ?? -1, inside = tree.byId.get(q.get('in') ?? '') ?? -1
    const file = q.get('file'), line = Number(q.get('line')) || 0
    const target = at > 0 ? at : file ? cardOf(file, inside) : inside
    if (target > 0) {
      // Selected first, so the frame leaves room for the panel it opens.
      if (at > 0 || file) select(target)
      const f = frameFor(at > 0 || file ? target : inside)
      cam.set(f.x, f.y, f.z)
      if (file && line) void openCode(target, line)
    }
    places.update(controls.view())
  }
  /**
   * The view switch keeps your subject: Architecture and Connections share ids; the Requests view
   * has its own, so the subject crosses to or from it by its file.
   */
  const viewLinks = () => {
    const v = controls.view()
    const subject = tree.byId.get(v.selected ?? v.here ?? '') ?? -1
    const file = subject > 0 ? tree.els[subject].metadata?.path ?? null : null
    for (const a of document.querySelectorAll<HTMLAnchorElement>('#views a')) {
      const base = (a.dataset.base ??= a.getAttribute('href') ?? '')
      const crossing = (new URLSearchParams(base).get('view') === 'requests') !== (view === 'requests')
      a.href = crossing ? placeUrl(base, { at: null, file }) : placeUrl(base, { at: v.selected, in: v.here, lens: renderer.lens?.name ?? null })
    }
  }

  // Live models: the dev server pushes an event when a workspace's LikeC4 files change. The new
  // version replaces the old in place: unchanged containers keep their layout, survivors glide
  // to their new places, new cards grow out of their parent, and changes glow for a moment.
  let morph: { t0: number; dur: number; from: { rect: Float64Array; content: Float64Array }; to: World; cam0: [number, number, number]; cam1: [number, number, number] } | null = null
  let liveVersion = 0
  const swapModel = async (json: ModelJson, buildMs = 0, said?: string) => {
    raw = json
    const swapStart = performance.now()
    const next = new Tree(json, { types: showTypes })
    const nextJobs = layoutJobs(next, coupling)
    stableOrder(tree, jobs, next, nextJobs)
    const { reused, rerun } = reuseLayouts(tree, jobs, local, next, nextJobs)
    const fresh = rerun.length ? await runLayout(rerun) : new Map()
    const nextLocal = new Map([...reused, ...fresh])
    const target = placeWorld(next, nextLocal)
    const diff = diffModels(tree, next)
    const start = startRects(world, next, target, diff.oldIndex)
    const live: World = { rect: start.rect.slice(), content: start.content.slice(), local: nextLocal }

    // Keep what you are looking at where it is on screen, the selection if there is one, else
    // what is under the screen centre: the camera moves with it.
    const cam0: [number, number, number] = [cam.x, cam.y, cam.z]
    let cam1 = cam0
    let anchor = renderer.selected > 0 ? renderer.selected : renderer.pick(cam.w / 2, cam.h / 2)
    while (anchor > 0 && !next.byId.has(tree.els[anchor].id)) anchor = tree.parent[anchor]
    if (anchor > 0) {
      const o = world.rect, n = target.rect, a = next.byId.get(tree.els[anchor].id)!
      const z1 = cam.z * (o[anchor * 4 + 2] / n[a * 4 + 2])
      const [sx, sy] = cam.toScreen(o[anchor * 4], o[anchor * 4 + 1])
      cam1 = [n[a * 4] - (sx - cam.w / 2) / z1, n[a * 4 + 1] - (sy - cam.h / 2) / z1, z1]
    }

    const prev = renderer
    const remap = (i: number) => (i > 0 ? next.byId.get(tree.els[i].id) ?? -1 : -1)
    const nextRenderer = new Renderer(app, next, live, cam)
    nextRenderer.ranking = rankFor(next)
    nextRenderer.hud = prev.hud
    nextRenderer.pointer = prev.pointer
    nextRenderer.selected = remap(prev.selected)
    nextRenderer.target = remap(prev.target)
    const t = now()
    for (const i of diff.changed) nextRenderer.flash.set(i, { color: 0xfbbf24, t0: t })
    for (const i of diff.added) nextRenderer.flash.set(i, { color: 0x4ade80, t0: t })
    app.stage.removeChild(prev.stage)
    app.stage.addChildAt(nextRenderer.stage, 0)
    prev.destroy()

    tree = next; jobs = nextJobs; local = nextLocal; world = live; renderer = nextRenderer
    lenses.splice(0, lenses.length, ...buildLenses(next))
    renderer.lens = lenses.find(l => l.name === prev.lens?.name) ?? null
    minimap.tree = next; minimap.world = live
    code.reset(next)
    controls.swap({ tree: next, world: live, renderer })
    showDetails()
    morph = { t0: t, dur: 700, from: start, to: target, cam0, cam1 }
    liveVersion++
    // An update that changed nothing (a file written twice) says nothing, so it never hides one that did.
    const changed = diff.added.length + diff.removed.length + diff.changed.length + diff.arrowsAdded + diff.arrowsRemoved + diff.evidenceChanged > 0
    if (said || changed) controls.toast.show(said ?? `Map updated · ${describeDiff(diff, next)}`)
    arrowLegend()
    console.info(`live update: ${rerun.length} of ${nextJobs.length} layouts redone · build ${buildMs} ms · swap ${Math.round(performance.now() - swapStart)} ms`)
  }
  /** Advances the morph: positions and the camera move together from the old version to the new. */
  const stepMorph = (t: number) => {
    if (!morph) return
    const u = Math.min(1, (t - morph.t0) / morph.dur)
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
    const r = world.rect, c = world.content, fr = morph.from.rect, fc = morph.from.content, tr = morph.to.rect, tc = morph.to.content
    for (let k = 0; k < r.length; k++) r[k] = fr[k] + (tr[k] - fr[k]) * e
    for (let k = 0; k < c.length; k++) c[k] = fc[k] + (tc[k] - fc[k]) * e
    const [x0, y0, z0] = morph.cam0, [x1, y1, z1] = morph.cam1
    if (!cam.flying && (x0 !== x1 || y0 !== y1 || z0 !== z1)) {
      const z = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * e)
      cam.set(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, z)
    }
    renderer.router.invalidate()
    if (u >= 1) morph = null
  }
  let pending: Promise<void> = Promise.resolve()
  import.meta.hot?.on('model:update', ({ name }: { name: string }) => {
    if (name !== modelFile) return
    // One swap at a time, in order.
    pending = pending.then(async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}models/${name}.json?v=${Date.now()}`)
      if (res.ok) { const json = await res.json(); published = json.published; lastCrumb = null; await swapModel(json, json.buildMs ?? 0) }
    }).catch(e => console.error(e))
  })
  // A newly published map gets its tab without a reload.
  import.meta.hot?.on('models:index', () => renderModelTabs($('models'), $('views'), modelName, new URLSearchParams(location.search).get('n'), view))

  // Frame loop: animations run every frame, so the scene always renders.
  const cpu = ring(240), delta = ring(240)
  let last = renderer.frame(now())
  const crumbs = $('crumbs'), stats = $('stats')
  let lastCrumb: string | null = null
  // The age in the breadcrumb is read again each minute.
  setInterval(() => { lastCrumb = null }, 60_000)
  const tick = (dt: number) => {
    const start = performance.now()
    const t = now()
    controls.tick(dt, t)
    cam.step(t, dt)
    stepMorph(t)
    last = renderer.frame(t)
    code.update(renderer.codeSlots, cam.w, cam.h)
    const path = renderer.breadcrumb()
    // Reading a file on the map, the minimap steps back: still there to click, no longer over the code.
    const here = path[path.length - 1] ?? 0
    const readingCode = here > 0 && !tree.children[here].length && !!tree.els[here].metadata?.path
    minimapEl.classList.toggle('faint', readingCode)
    // Nothing but a card's empty inside on screen (a drag went past its children): say how back.
    emptyHint.hidden = last.inView > 0 || readingCode || cam.flying
    const key = path.join('/')
    if (key !== lastCrumb || crumbsStale) {
      crumbsStale = false
      lastCrumb = key
      crumbs.replaceChildren(...[0, ...path].map((i, k) => {
        const b = document.createElement('button')
        b.textContent = tree.els[i].title
        b.title = tree.els[i].title
        b.onclick = () => controls.go(i)
        if (k === path.length) { b.className = 'here'; b.setAttribute('aria-current', 'location') }
        return b
      }), ...provenance(published, uploaded))
      // A long path gives way in its middle: the map, the place you are in and its parent stay.
      const buttons = [...crumbs.querySelectorAll('button')]
      for (let k = 1; k < buttons.length - 2 && crumbs.scrollWidth > crumbs.clientWidth + 1; k++) { buttons[k].textContent = '…'; buttons[k].style.flex = 'none' }
      document.title = here > 0 ? `${tree.els[here].title} · ${tree.els[0].title}` : tree.els[0].title
      if (!cam.flying) showOutline()
    }
    if (!cam.flying && outlined !== here && renderer.selected <= 0 && !renderer.edge) showOutline()
    push(cpu, performance.now() - start)
    push(delta, dt)
  }
  app.ticker.add(t => { if (!manual) tick(t.deltaMS) })

  setInterval(() => {
    const d = values(delta), c = values(cpu)
    stats.textContent = [
      `${tree.size - 1} elements · ${tree.rels.length / 2} relations · layout ${layoutMs.toFixed(0)} ms`,
      `fps ${(1000 / (d.reduce((a, b) => a + b, 0) / (d.length || 1))).toFixed(0)} · frame p50 ${pct(c, 0.5).toFixed(1)} ms · p95 ${pct(c, 0.95).toFixed(1)} ms`,
      `drawn ${last.nodes} cards · ${last.texts} labels · ${last.edges} edges · ${last.chips} off-screen`,
    ].join('\n')
    // The minimap is for finding your way once the whole map is no longer in view.
    const whole = renderer.breadcrumb().length === 0 && cam.z <= (frameFor(0).z * 1.15)
    minimapEl.classList.toggle('whole', whole)
    if (!whole) minimap.draw(cam)
    if (!cam.flying) { places.update(controls.view()); viewLinks() }
    measureHud()
  }, 250)

  // Frame stats are for developers: shown while loading, then only with ?stats in the address.
  $('stats').hidden = !new URLSearchParams(location.search).has('stats')
  const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info')
  Object.assign(window, {
    __spike: {
      ready: true, cam, controls, layoutMs, loadMs: performance.now() - t0,
      get tree() { return tree }, get world() { return world }, get renderer() { return renderer },
      get liveVersion() { return liveVersion }, get morphing() { return morph != null }, swapModel,
      gpu: dbg && gl ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      fit, safeTop, fly: (i: number) => controls.go(i), select, setLens, unhover: () => { renderer.pointer = null }, last: () => last, id: (s: string) => tree.byId.get(s) ?? -1,
      frames: () => ({ cpu: values(cpu), delta: values(delta) }),
      resetFrames: () => { cpu.k = delta.k = 0; cpu.full = delta.full = false },
      /** Recording: stop real time, then advance the scene by exact steps. */
      manual: (on: boolean) => { manual = on; simNow = performance.now(); if (on) app.ticker.stop(); else app.ticker.start() },
      advance: (ms: number) => { simNow += ms; tick(ms); app.render() },
      now,
    },
  })
}

main().catch(e => {
  $('stats').hidden = true
  void cannotOpen(e)
  console.error(e)
})
