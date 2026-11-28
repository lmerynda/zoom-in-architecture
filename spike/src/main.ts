import { Application } from 'pixi.js'
import { Camera } from './camera'
import { changeCount, renderChanges, sinceText } from './changes'
import { CodeView } from './code'
import { installControls } from './controls/install'
import { endpointsUnder, relationsAcross, stepRole, renderApi, renderDetails, renderEdge, renderFeature, renderLines, renderOutline, surfaceLead, type PanelActions, type PanelRows, type Surface } from './details'
import { buildApi, callsIn, endpointOf, featureFacts, isPage, markedEntries, topCounts, type ApiFilter } from './endpoints'
import { LensBar, ago } from './hud'
import { CARD_W, importance, layoutJobs, openScale, placeWorld, rankKey, ranks, siblingPartners, type LocalLayout, type World } from './layout'
import { runLayout } from './layoutPool'
import { buildLenses, type LensName } from './lens'
import { Minimap } from './minimap'
import { renderModelTabs } from './models'
import { describeDiff, diffModels, reuseLayouts, stableOrder, startRects } from './live'
import { Tree, type ModelJson } from './model'
import { placeUrl, Places, type PlaceWords } from './places'
import { findProblem, findProblems, problemKey, problemNote, problemsAt, problemsSection, type ProblemKey, type ProblemReport } from './problems'
import { Reader } from './reader'
import { count, OPEN_A, OPEN_B, Renderer, safeTop, setSafeTop } from './render'
import { synthetic } from './synthetic'
import './endpoints.css'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const modelName = new URLSearchParams(location.search).get('model') ?? 'acme'
/** A second view of the same import, such as its requests; it reads code from the import's repo. */
const view = new URLSearchParams(location.search).get('view')
/** The Architecture view laid out by coupling instead of map order: a layout of the same model. */
const coupling = !view && new URLSearchParams(location.search).get('layout') === 'coupling'
const modelFile = view ? `${modelName}.${view}` : modelName
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
  const json = await res.json()
  return view === 'requests' ? named(json) : json
}

/** The Requests model by the map's own name: its title adds "· requests", which the view says already. */
const named = (m: ModelJson): ModelJson => (m.title ? { ...m, title: m.title.replace(/ · requests$/, '') } : m)

const ring = (n: number) => ({ a: new Float64Array(n), k: 0, full: false })
type Ring = ReturnType<typeof ring>
const push = (r: Ring, v: number) => { r.a[r.k] = v; r.k = (r.k + 1) % r.a.length; if (!r.k) r.full = true }
const values = (r: Ring) => Array.from(r.full ? r.a : r.a.slice(0, r.k))
const pct = (v: number[], p: number) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

const INTRO_SEEN = 'zoom.introSeen'
/** Set while the page crosses to another view, so the new page focuses what it opens at. */
const CROSSED = 'zoom.crossed'
/**
 * On a first visit, a short welcome: what the map holds, counted as a reader names it (apps,
 * databases, people, endpoints, features), the API in one press, and the features as places to
 * start. The controls are in Help. It stays until Got it, at any width; it is drawn again when the
 * endpoints arrive, if it is still up.
 */
function showIntro(tree: Tree, surface: Surface, feature: (name: string) => void, seeApi: () => void, again = false) {
  let seen = false
  try { seen = localStorage.getItem(INTRO_SEEN) === '1' } catch { /* storage blocked: show it this time */ }
  const box = $('welcome')
  if (seen || (again && box.hidden)) return
  const features = [...new Set(tree.els.flatMap(e => e.features ?? []))]
  const endpoints = surface.api?.endpoints.length ?? 0
  const p = document.createElement('p'), b = document.createElement('b')
  b.textContent = tree.els[0].title
  const n = (k: number, w: string) => `${count(k)} ${w}${k === 1 ? '' : 's'}`
  const counts = [...topCounts(tree.children[0].map(i => tree.els[i].kind)), ...(endpoints ? [n(endpoints, 'endpoint')] : []), ...(features.length ? [n(features.length, 'feature')] : [])]
  p.append(b, ` is mapped here: ${counts.join(', ')}. Cards are its parts, arrows show what uses what (thicker carries more). ${matchMedia('(pointer: coarse)').matches ? 'Help lists every gesture.' : 'Help (?) lists every control.'}`)
  const chips = document.createElement('div')
  chips.className = 'chips'
  if (endpoints) {
    const api = document.createElement('button')
    api.className = 'api'
    api.textContent = `See the API · ${endpoints}`
    api.onclick = seeApi
    chips.append(api)
  }
  if (features.length) {
    const h = document.createElement('span')
    h.textContent = 'Start with a feature:'
    chips.append(h, ...features.slice(0, 10).map(f => { const c = document.createElement('button'); c.textContent = f; c.onclick = () => feature(f); return c }))
    if (features.length > 10) chips.append(Object.assign(document.createElement('span'), { textContent: `${features.length - 10} more in Search` }))
  }
  // The same button across a redraw (the other view's model arriving adds its counts): a tap or a
  // focus on Got it never lands on a button that was just replaced.
  const ok = box.querySelector<HTMLButtonElement>(':scope > .ok') ?? document.createElement('button')
  ok.className = 'ok'
  ok.textContent = 'Got it'
  ok.onclick = () => { try { localStorage.setItem(INTRO_SEEN, '1') } catch { /* private mode */ } box.hidden = true }
  const focused = document.activeElement === ok
  box.replaceChildren(p, ...(chips.childElementCount ? [chips] : []), ok)
  if (focused) ok.focus()
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
  void renderModelTabs($('models'), $('views'), modelName, new URLSearchParams(location.search).get('n'), view, coupling)
    .then(entry => { uploaded = entry?.source === 'import'; crumbsStale = true })
  const model = await loadModel()
  // The current model version; live updates replace all four.
  // Type-only imports are drawn only when asked (the arrow legend's toggle), remembered per viewer.
  let showTypes = false
  try { showTypes = localStorage.getItem(TYPES_KEY) === '1' } catch { /* storage blocked */ }
  /** The model as last loaded, so the toggle can lay it out again with or without type-only imports. */
  let raw = model
  let tree = new Tree(model, { types: showTypes })
  /** The map's own name, the same in every view (loadModel and live updates drop " · requests"). */
  const mapTitle = () => tree.els[0].title
  /** How the map is shown, for the tab and the page's heading. */
  const shownAs = view === 'requests' ? 'Requests' : coupling ? 'Architecture, laid out by coupling' : 'Architecture'
  let published = model.published
  // Problems in the map's structure (problems.ts); a request's steps are not parts, so the Requests view has none.
  const problemsOf = (t: Tree): ProblemReport | null => (view === 'requests' ? null : findProblems(t))
  let problems = problemsOf(tree)
  /** The problem whose arrow was opened last (] and [ go on from it), and whether the outline's Problems list is open. */
  let problemAt = -1, problemsOpen = false
  // A phone held upright lays the whole map out tall, to fill its screen rather than a strip of it.
  /**
   * The whole map is laid out for the room it is shown in: the stage below the top bar, left of a
   * wide screen's details column, above the arrow legend or a narrow screen's folded sheet. A wide
   * screen fills its stage rather than its middle, and a phone, upright or on its side, its width.
   */
  const stageAspect = () => {
    const stage = $('stage').getBoundingClientRect(), top = $('top').getBoundingClientRect().bottom + 8
    const bottom = stage.bottom - (innerWidth < 1100 ? 58 : 28)
    return Math.min(4, Math.max(0.45, stage.width / Math.max(1, bottom - top)))
  }
  let rootAspect = stageAspect()
  let jobs = layoutJobs(tree, coupling, rootAspect)
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
  app.canvas.setAttribute('role', 'application')
  $('stage').setAttribute('role', 'main')
  Renderer.installFont()
  const cam = new Camera()
  let renderer = new Renderer(app, tree, world, cam)
  // Laid out by coupling, each card shows its rank among its siblings and how connected it is.
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
  /** The screen's free frames, as [left, top, right, bottom]: below the bar, beside or above the panel, beside or above the minimap. */
  const freeFrames = () => {
    const W = cam.w, H = cam.h
    const box = (id: string) => { const e = document.getElementById(id); return e && !e.hidden && e.getClientRects().length ? e.getBoundingClientRect() : null }
    const top = box('top'), panel = box('details'), mini = box('minimap'), hello = box('welcome')
    const t = (top?.bottom ?? 0) + 8
    // A panel over the map (narrow: the bottom sheet) takes its share; a column beside it is off the map already.
    // A folded sheet frames as the bar it is. So does an outline that is about to fold: a search
    // that puts the selection down frames its find before the outline replaces the open sheet
    // (its grip, folded, comes with the next redraw). An outline the reader opened stays open.
    const d = $('details'), folding = d.classList.contains('outline') && !d.querySelector(':scope > .d-grip')
    const sheet = panel && panel.top > H / 2 ? (d.classList.contains('collapsed') || folding ? { top: H - 46 } : panel) : null
    const right = panel && !sheet && panel.left < W ? panel.left - 12 : W, bottom = Math.min(sheet ? sheet.top - 12 : H - 28, hello && hello.top > H / 2 ? hello.top - 12 : Infinity)
    const over = mini && mini.left < W ? mini : null
    const frames: [number, number, number, number][] = [[0, t, right, bottom]]
    if (over && !panel) frames[0] = [0, t, right, over.top - 8]
    if (over) frames.push([0, t, Math.min(right, over.left - 8), bottom])
    return frames
  }
  // `m`: a live update moving `w0` into place. A container that was open before it has a scale of
  // its own all the way; one opening from nothing (a card becoming a container) has a near-zero one
  // halfway, so it takes the scale it ends with, in proportion to its size now.
  const frameFor = (i: number, w0: World = world, m: typeof morph = null) => {
    const r = w0.rect, W = cam.w, H = cam.h
    const scaleOf = (k: number) => (!m || m.wasOpen[k] ? openScale(w0, k) : openScale(m.to, k) * (r[k * 4 + 2] / m.to.rect[k * 4 + 2]))
    const frames = freeFrames()
    const fill = i === 0 ? 0.96 : tree.children[i].length ? 0.9 : 0.4
    const w = r[i * 4 + 2], h = r[i * 4 + 3]
    // A crowded level framed with a margin can come out too small to open: it uses the margin, up
    // to filling its frame, so its children are drawn with their names.
    const opens = i > 0 && tree.children[i].length ? (OPEN_A + 12) / (CARD_W * scaleOf(i)) : 0
    let best = { z: 0, x: 0, y: 0 }
    // A container too crowded to open even filling the screen (a phone, a level of many cards) is
    // framed at the zoom where its cards are open and named, from its top-left corner: a pan away
    // from the rest, rather than a closed card that no tap opens.
    const full = opens ? (OPEN_B + 6) / (CARD_W * scaleOf(i)) : 0
    {
      const [l, tt, rr, bb] = frames[0], fw = Math.max(40, rr - l), fh = Math.max(40, bb - tt)
      if (full && opens > Math.min(fw / w, fh / h)) {
        // The cards, not the container's padding: centred on an axis where they fit, from their
        // first row and column where they do not. The container's own header stays in view above.
        const kids = tree.children[i]
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const k of kids) { x0 = Math.min(x0, r[k * 4]); y0 = Math.min(y0, r[k * 4 + 1]); x1 = Math.max(x1, r[k * 4] + r[k * 4 + 2]); y1 = Math.max(y1, r[k * 4 + 1] + r[k * 4 + 3]) }
        // From the container's own top: its whole header, title and kind, below the bar (half of it went under).
        y0 = Math.min(y0, r[i * 4 + 1])
        const z = full, cw = x1 - x0, ch = y1 - y0, m = 12 / z
        const x = cw * z + 24 <= fw ? x0 + cw / 2 - ((l + rr) / 2 - W / 2) / z : x0 - m - (l - W / 2) / z
        const y = ch * z + 8 <= fh ? y0 + ch / 2 - ((tt + bb) / 2 - H / 2) / z : y0 - (tt + 4 - H / 2) / z
        return { z, x, y }
      }
    }
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
  /**
   * A live update moving into place (swapModel, stepMorph). With nothing framed, the camera moves
   * from cam0 to cam1 with what it shows, until the reader moves it (handsOff).
   */
  // e: its eased progress. wasOpen: per card, whether it was a container already before the update (frameFor).
  // gap: how far the camera stood from its framing as the move began (the new version may frame it
  // otherwise: a container emptied fits where it did not), closed by the end; for that framing only.
  let morph: { t0: number; dur: number; e: number; from: { rect: Float64Array; content: Float64Array }; to: World; wasOpen: Uint8Array; cam0: [number, number, number]; cam1: [number, number, number]; handsOff: boolean; gap: { of: Intent; d: [number, number, number] } | null } | null = null
  /**
   * What the reader asked to see: a card (by id, since a live update may number the cards anew),
   * the whole map, or nothing framed: a camera they moved by hand, or one a jump left somewhere
   * no framing names (Back, a problem, a feature). The camera follows a framing wherever it is
   * worked out again: a resize, the bar settling, the map laid out again, a live update moving into
   * place (each step of it, a repeated update included), and a flight to it under way. It ends only
   * when the reader moves the camera themselves (Camera.onHand) or asks for something else.
   */
  type Intent = { kind: 'card'; id: string } | { kind: 'whole' } | { kind: 'free' }
  let intent: Intent = { kind: 'free' }
  /** The card the reader asked to see, in the current tree: 0 for the whole map, -1 for none. */
  const intended = () => (intent.kind === 'whole' ? 0 : intent.kind === 'card' ? tree.byId.get(intent.id) ?? -1 : -1)
  cam.onHand = () => { intent = { kind: 'free' }; if (morph) morph.handsOff = true }
  /**
   * The camera that frames several cards together in the largest free frame, no closer than any one
   * of them alone, and close enough that every container they sit in is open, so each is drawn as
   * itself: on a narrow screen that can leave them past its edges, centred on the space between.
   */
  const frameCards = (nodes: number[]) => {
    const r = world.rect
    const box = (ns: number[]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const n of ns) { x0 = Math.min(x0, r[n * 4]); y0 = Math.min(y0, r[n * 4 + 1]); x1 = Math.max(x1, r[n * 4] + r[n * 4 + 2]); y1 = Math.max(y1, r[n * 4 + 1] + r[n * 4 + 3]) }
      return { x0, y0, x1, y1 }
    }
    const most = Math.min(...nodes.map(n => frameFor(n).z))
    // A card is drawn as itself, its arrows ending at it, once its parent is half open (render.ts rep()).
    let opens = 0
    for (const n of nodes) for (let c = tree.parent[n]; c > 0; c = tree.parent[c]) opens = Math.max(opens, ((OPEN_A + OPEN_B) / 2 + 6) / (CARD_W * openScale(world, c)))
    let best = { z: 0, x: 0, y: 0 }
    for (const [l, t, rr, b] of freeFrames()) {
      const all = box(nodes), fw = Math.max(40, rr - l) - 32, fh = Math.max(40, b - t) - 32
      const fits = Math.min(most, fw / Math.max(1e-9, all.x1 - all.x0), fh / Math.max(1e-9, all.y1 - all.y0))
      // Too far apart to show both open: the first (a problem's flagged side) is framed in half the
      // space, so its arrow has room to leave it toward the other.
      const on = fits >= opens ? all : box(nodes.slice(0, 1))
      const room = on === all ? 1 : 2
      const z = Math.max(opens, Math.min(most, fw / room / Math.max(1e-9, on.x1 - on.x0), fh / room / Math.max(1e-9, on.y1 - on.y0)))
      if (z <= best.z) continue
      // Only the flagged card shows open: the view is centred a third of the frame along its arrow's
      // own route from it, so the card and where the arrow leaves it are both in view.
      let cx = (on.x0 + on.x1) / 2, cy = (on.y0 + on.y1) / 2
      const route = on !== all && nodes.length > 1 ? renderer.router.route(nodes[0], nodes[1]) : null
      if (route && route.length >= 4) {
        let left = Math.min(fw, fh) / 3 / z
        cx = route[0]; cy = route[1]
        for (let j = 2; j < route.length && left > 0; j += 2) {
          const dx = route[j] - cx, dy = route[j + 1] - cy, d = Math.hypot(dx, dy), u = Math.min(1, left / Math.max(1e-9, d))
          cx += dx * u; cy += dy * u; left -= d
        }
        // Not so far that the card's name leaves the view: its top-left corner, and its heading's
        // first stretch, stay inside the frame. The arrow's first 24 px come first, though: on a
        // narrow screen a wide card may lose the start of its name rather than its arrow.
        const hw = (fw + 32) / 2 / z, hh = (fh + 32) / 2 / z, m = 12 / z
        // On a screen narrower than the card open, its name and the arrow's far end cannot both show: the name does.
        cx = Math.min(on.x0 + hw - m, Math.max(on.x0 + Math.min(on.x1 - on.x0, 160 / z) - hw + m, cx))
        cy = Math.min(on.y0 + hh - m, Math.max(on.y0 + Math.min(on.y1 - on.y0, 40 / z) - hh + m, cy))
        let px = route[0], py = route[1], need = 24 / z
        for (let j = 2; j < route.length && need > 0; j += 2) {
          const dx = route[j] - px, dy = route[j + 1] - py, d = Math.hypot(dx, dy), u = Math.min(1, need / Math.max(1e-9, d))
          px += dx * u; py += dy * u; need -= d
        }
        for (const [x, y] of [[route[0], route[1]], [px, py]]) {
          cx = Math.min(x + hw - m, Math.max(x - hw + m, cx))
          cy = Math.min(y + hh - m, Math.max(y - hh + m, cy))
        }
      }
      best = { z, x: cx - ((l + rr) / 2 - cam.w / 2) / z, y: cy - ((t + b) / 2 - cam.h / 2) / z }
    }
    return best
  }
  /** Flies to card i (0: the whole map), which becomes what the reader asked to see. */
  const fit = (i = 0) => {
    const f = frameNow(i), vw = cam.w / f.z, vh = cam.h / f.z
    if (i === 0) renderer.wholeZ = f.z
    cam.steer(() => cam.flyTo(f.x - vw / 2, f.y - vh / 2, vw, vh, now(), 1))
    intent = i > 0 ? { kind: 'card', id: tree.els[i].id } : { kind: 'whole' }
  }
  /** Frames card i at once, no flight (on load), and it becomes what the reader asked to see. */
  const setFrame = (i: number) => {
    intent = i > 0 ? { kind: 'card', id: tree.els[i].id } : { kind: 'whole' }
    reframe()
  }
  const setWhole = () => setFrame(0)
  /**
   * Works the camera out again from what the reader asked to see, for the map and the screen as
   * they are now: set there, or a flight under way sent there. False when nothing is framed (the
   * camera is the reader's) or the card asked for is gone.
   */
  /**
   * The framing of card i now. During a live update's move, framings are worked out only for the
   * layouts it runs between (halfway, a container's framing would switch from crowded to roomy in
   * one frame, or open from nothing): how each frames the card, relative to the card (offset and
   * on-screen size in card widths), is blended by the move's progress and laid on the card where it is.
   */
  const frameNow = (i: number) => {
    const m = morph
    if (!m) return frameFor(i)
    const rel = (f: { x: number; y: number; z: number }, r: Float64Array) => { const w = r[i * 4 + 2]; return [(f.x - r[i * 4] - w / 2) / w, (f.y - r[i * 4 + 1] - r[i * 4 + 3] / 2) / w, f.z * w] }
    const end = frameFor(i, m.to), b = rel(end, m.to.rect)
    // A card that grows from nothing (added) is framed throughout as it ends. Sizes are compared with
    // zero itself: deep in a map a card a screen wide is 1e-10 world units across.
    const a = m.from.rect[i * 4 + 2] > 0 ? rel(frameFor(i, { ...m.to, ...m.from }, m), m.from.rect) : b
    const r = world.rect, w = r[i * 4 + 2], e = m.e
    if (!(w > 0)) return end
    const ox = a[0] + (b[0] - a[0]) * e, oy = a[1] + (b[1] - a[1]) * e, s = Math.exp(Math.log(a[2]) + (Math.log(b[2]) - Math.log(a[2])) * e)
    return { x: r[i * 4] + w / 2 + ox * w, y: r[i * 4 + 1] + r[i * 4 + 3] / 2 + oy * w, z: s / w }
  }
  const reframe = () => {
    const i = intended()
    if (i < 0) return false
    const f = frameNow(i)
    if (i === 0) renderer.wholeZ = f.z
    cam.steer(() => {
      if (cam.aim(f.x, f.y, f.z)) return
      // During a move, the gap it began with, closing as it goes: no jump when the new version frames the card otherwise.
      const g = morph?.gap?.of === intent ? morph.gap.d : null, k = g ? 1 - morph!.e : 0
      // A container open before the move stays open through it, at its opening scale now (render.ts draws its cards from there).
      const open = morph && morph.wasOpen[i] && tree.children[i].length ? (OPEN_A + 12) / (CARD_W * openScale(world, i)) : 0
      cam.set(f.x + (g ? g[0] * k : 0), f.y + (g ? g[1] * k : 0), Math.max(open, f.z * (g ? Math.exp(g[2] * k) : 1)))
    })
    return true
  }
  /**
   * The panels over the map changed (a phone's sheet opened, the code reader closed): the card the
   * reader asked to see is framed again for them, a flight or a live update's move to it sent there,
   * else flown to if that framing is elsewhere.
   */
  const refit = () => {
    const i = intended()
    if (i < 0) return
    if (cam.flying || morph) { reframe(); return }
    const f = frameNow(i)
    if (Math.hypot(f.x - cam.x, f.y - cam.y) * cam.z > 1 || Math.abs(f.z / cam.z - 1) > 1e-3) fit(i)
  }
  const resize = () => {
    const z0 = cam.z
    cam.resize(app.screen.width, app.screen.height)
    // A live update moving a free camera scales its path with the window, as the camera did.
    // The gap a framing's move began with was to the old screen's framing: on this one it is framed as it is.
    if (morph) { const k = cam.z / z0; morph.cam0[2] *= k; morph.cam1[2] *= k; morph.gap = null }
    measureHud()
    // The whole map's zoom on this screen, which says when you are at the whole map (breadcrumb).
    renderer.wholeZ = frameFor(0).z
    reframe()
    reshape()
  }
  /** Lays the whole map out again once the stage's shape has changed by more than a seventh and settled. */
  let reshaping: ReturnType<typeof setTimeout> | undefined, relaying = false
  /** Live updates being laid out: a relayout waits for them, and they for nothing. */
  let swapping = 0
  const reshape = () => {
    clearTimeout(reshaping)
    reshaping = setTimeout(() => void relayout(), 300)
  }
  /**
   * A new shape for the stage lays out only the whole map's own level again, in place: the model,
   * the selection and the panel (an arrow being inspected) stay. The reader stays where they were:
   * on what they asked to see (a card, the whole map), framed again; else on the selection, or
   * the card at the screen's centre.
   */
  const relayout = async () => {
    const next = stageAspect()
    if (Math.abs(Math.log(next / rootAspect)) < Math.log(1.15)) return
    // A live update or another relayout in flight: try again once it is done.
    if (morph || relaying || swapping) return reshape()
    relaying = true
    const before = tree
    rootAspect = next
    try {
      const nextJobs = layoutJobs(tree, coupling, rootAspect)
      const { reused, rerun } = reuseLayouts(tree, jobs, local, tree, nextJobs)
      const fresh = rerun.length ? await runLayout(rerun) : new Map<number, LocalLayout>()
      // A live update replaced the model meanwhile: it was laid out for this shape already.
      if (tree !== before) return
      jobs = nextJobs
      local = new Map([...reused, ...fresh])
      // The card the camera is about: where a flight under way is going (a card picked, a crumb,
      // Enter), else the selection, else the card at the screen's centre.
      const r = world.rect, dest = cam.destination
      const deepestAt = (wx: number, wy: number) => {
        for (let cur = 0; ;) {
          const next = tree.children[cur].find(k => wx >= r[k * 4] && wy >= r[k * 4 + 1] && wx <= r[k * 4] + r[k * 4 + 2] && wy <= r[k * 4 + 1] + r[k * 4 + 3])
          if (next == null) return cur
          cur = next
        }
      }
      const anchor = dest ? deepestAt(dest[0], dest[1]) : renderer.selected > 0 ? renderer.selected : renderer.pick(cam.w / 2, cam.h / 2)
      const a = anchor * 4, [ax, ay, aw] = [r[a], r[a + 1], r[a + 2]]
      const placed = placeWorld(tree, local)
      world.rect.set(placed.rect)
      world.content.set(placed.content)
      world.local = local
      renderer.router.reset()
      // What the reader asked to see is framed again in the new layout, or a flight to it sent
      // there; a camera that is theirs moves with that card, a flight or a wheel zoom under way included.
      if (!reframe() && anchor > 0) cam.remap(ax, ay, r[a], r[a + 1], r[a + 2] / aw)
      renderer.wholeZ = frameFor(0).z
    } finally { relaying = false }
  }
  // Where the panels over the map are, so chips and labels keep off them: measured again on a timer,
  // since the details panel opens and closes and layout settles after the first frame.
  const measureHud = () => {
    // Both legends: the arrows' at the foot, the lens's under the bar.
    renderer.hud = ['stats', 'minimap', 'help', 'details', 'arrows', 'lens-legend'].map(id => { const e = document.getElementById(id) ?? document.querySelector(`.${id}`); const r = e && !e.hidden ? e.getBoundingClientRect() : null; return r ? [r.x, r.y, r.width, r.height] : [0, 0, 0, 0] })
  }
  cam.resize(app.screen.width, app.screen.height)
  setWhole()
  // Pixi applies a window resize a frame later; reading the screen before that keeps the old
  // size, and everything outside it is culled as off-screen.
  app.renderer.on('resize', resize)
  // The bar wraps on a phone: what sits under it (the reader, the lens legend) follows its height.
  new ResizeObserver(() => {
    const h = $('top').getBoundingClientRect().height
    document.documentElement.style.setProperty('--bar', `${h}px`)
    setSafeTop(h)
    // A bar that wraps to another row, or unwraps once the views are listed, changes the stage:
    // what was framed (the whole map, or the card a link opened at) is framed again for it while you have not moved.
    if (morph) morph.gap = null
    reframe()
    reshape()
  }).observe($('top'))

  // Whether the last input was a key (focus rings show) or a pointer (they need not).
  addEventListener('keydown', e => { if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') document.body.classList.add('kbd') }, true)
  addEventListener('pointerdown', () => document.body.classList.remove('kbd'), true)

  // Selection: click a card to focus its relations; the panel lists them, each a jump.
  const details = $('details')
  /**
   * Narrow, the panel is a bottom sheet with a grip: a button naming what the sheet holds that folds
   * it to a bar and opens it again. The outline starts folded, so the map keeps the screen; a
   * selection starts open. Folded, everything below the grip is hidden from pointer, Tab and screen
   * reader alike, so a tap on the bar never lands on a row that slid under the finger.
   */
  let focusInPanel = false
  details.addEventListener('focusin', () => { focusInPanel = true })
  details.addEventListener('focusout', ev => { if (!details.contains(ev.relatedTarget as Node | null)) focusInPanel = false })
  const setSheet = (open: boolean) => {
    details.classList.toggle('collapsed', !open)
    const g = details.querySelector<HTMLButtonElement>(':scope > .d-grip')
    if (g) { g.setAttribute('aria-expanded', String(open)); g.querySelector('i')!.textContent = open ? 'Hide' : 'Show' }
  }
  const addGrip = () => {
    if (details.hidden || details.firstElementChild?.classList.contains('d-grip')) return
    const kind = details.querySelector('.d-kind')?.textContent ?? '', title = details.querySelector('h2')?.textContent ?? ''
    const g = document.createElement('button')
    g.className = 'd-grip'
    g.append(Object.assign(document.createElement('b'), { textContent: title }), Object.assign(document.createElement('span'), { textContent: kind }), document.createElement('i'))
    g.setAttribute('aria-controls', 'details')
    g.onclick = () => { setSheet(details.classList.contains('collapsed')); measureHud() }
    const wasFocused = focusInPanel && !details.contains(document.activeElement)
    details.prepend(g)
    setSheet(!details.classList.contains('outline'))
    // A redraw of a folded sheet would drop focus to the page: it goes to the new grip.
    if (wasFocused && details.classList.contains('collapsed')) g.focus({ preventScroll: true })
  }
  new MutationObserver(addGrip).observe(details, { childList: true })
  // Focus taken elsewhere (search, the map) cancels a problem row's pending return of focus.
  addEventListener('focusin', e => { if (!details.contains(e.target as Node)) problemFocus = null })
  // So does the reader's own Tab or press on the way there.
  addEventListener('keydown', e => { if (e.key === 'Tab') problemFocus = null }, true)
  addEventListener('pointerdown', () => { problemFocus = null }, true)
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
  // Closed, the panels it hid come back (a phone's sheet): what the reader asked to see is framed for them.
  reader.onClose = () => { reading = null; document.body.classList.remove('reading'); $('stage').inert = false; app.canvas.focus({ preventScroll: true }); requestAnimationFrame(refit) }
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
    // The map under the reader takes no focus or keys while the code covers it.
    $('stage').inert = true
    const slow = setTimeout(() => controls.toast.show(`Opening ${path.split('/').pop()}:${line}`), 400)
    const src = await code.prepared(i)
    clearTimeout(slow)
    reading = { id: tree.els[i].id, line }
    document.body.classList.add('reading')
    // "← back to POST /market/{id}/buy" goes to the endpoint it names, selected; Close and Esc stay on the file.
    // Resolved by id when pressed: a live update may have renumbered the cards meanwhile.
    const fileId = tree.els[i].id
    reader.onBack = () => {
      const f = tree.byId.get(fileId) ?? -1, p = f > 0 ? tree.parent[f] : -1
      if (p > 0) controls.goSelect(p)
      else if (p === 0) { select(-1); fit(0) }
    }
    reader.open(path, tree.els[i].title, tree.els[tree.parent[i]].title, line, src, () => void openCode(i, line))
  }
  /** Opens the page at another view of this map, at a place: Requests for an endpoint, Architecture for a part. */
  // The page it opens puts keyboard focus on what it opens at, as a selection here would.
  const cross = (to: string | null, w: PlaceWords) => {
    try { sessionStorage.setItem(CROSSED, '1') } catch { /* storage blocked: focus stays where the page puts it */ }
    location.assign(placeUrl(`?model=${encodeURIComponent(modelName)}${to ? `&view=${to}` : ''}`, w))
  }
  /** Sources fetched for reading a handler's parameters, by path. */
  const sources = new Map<string, Promise<string | null>>()
  /**
   * An endpoint by its Requests id: selected here in the Requests view, where it is a card; across
   * to Requests from the other views. Opened from the endpoint list, its panel leads back to it.
   */
  const openEndpoint = (id: string, from?: ApiFilter) => {
    if (view !== 'requests') return cross('requests', { at: id })
    const j = tree.byId.get(id) ?? -1
    if (j <= 0) return
    backToList = from ? { id, filter: from } : null
    controls.goSelect(j)
  }
  const actions: PanelActions = {
    go: j => controls.goSelect(j),
    // A file this view does not show (a scheduled job, from Requests) opens in Architecture.
    openPath: (path, line, near) => { const j = cardOf(path, near); if (j > 0) void openCode(j, line); else if (view === 'requests') cross(null, { at: null, file: path, line }) },
    part: id => { if (view === 'requests') return cross(null, { at: id }); const j = tree.byId.get(id) ?? -1; if (j > 0) controls.goSelect(j) },
    callingPages: async id => { const ids = (await pageCalls()).get(id) ?? []; const t = new Map(archEls().map(e => [e.id, e.title])); return ids.map(p => ({ id: p, title: t.get(p) ?? p })) },
    source: path => {
      if (!sources.has(path)) sources.set(path, fetch(`${import.meta.env.BASE_URL}source/${encodeURIComponent(modelName)}?path=${encodeURIComponent(path)}`).then(r => (r.ok ? r.text() : null), () => null).then(t => { if (t == null) sources.delete(path); return t }))
      // A failed read is not kept: the next selection asks again.
      return sources.get(path)!
    },
    read: j => void openCode(j, startOf(j)),
    inspect: (a, b) => { pickEdge({ s: a, t: b }, { rels: relationsAcross(tree, a, b) }); focusHeading() },
    enter: j => controls.enterPlace(j),
    endpoint: id => openEndpoint(id),
    list: f => showApi(f),
  }
  /** Laid out by coupling, why a card ranks where it does among its siblings. */
  const rankText = (i: number) => {
    const rk = renderer.ranking
    if (!rk || i <= 0) return undefined
    const peers = tree.children[tree.parent[i]].length
    return `#${rk.rank[i]} of ${peers} · reaches ${rk.partners[i]} of ${peers - 1} peer${peers === 2 ? '' : 's'} · ${rk.weight[i]} relation${rk.weight[i] === 1 ? '' : 's'}`
  }
  /**
   * The map's surface, for both views: its endpoints, read from the Requests model (this one in
   * Requests, the one beside it otherwise), and the routes and jobs its code marks (from the
   * Architecture model once loaded). `other` is the model of the other view.
   */
  let other: ModelJson | null = null
  const surface: Surface = { api: null, requests: view === 'requests', marks: { route: [], schedule: [], message: [], socket: [], main: [] } }
  /** Per card, its surface in words: drawn on the card under its kind. */
  let surfaceText = new Map<number, string>()
  const cardSurface = () => {
    const out = new Map<number, string>(), api = surface.api
    const n = (k: number, w: string) => `${count(k)} ${w}${k === 1 ? '' : 's'}`
    for (const i of tree.children[0]) {
      const id = tree.els[i].id
      const served = api ? api.endpoints.filter(ep => ep.app === id).length : 0
      const calls = api ? api.endpoints.filter(ep => (api.callers.get(ep.id) ?? []).some(c => c.top === id)).length : 0
      // A browser app's own timers and handlers are left out where the marks are read (markedEntries).
      const ways = (k: 'schedule' | 'message' | 'socket') => surface.marks[k].filter(m => m.top === id).length
      const jobs = ways('schedule'), handlers = ways('message'), sockets = ways('socket')
      const words = [served ? n(served, 'endpoint') : '', calls ? `calls ${n(calls, 'endpoint')}` : '', jobs ? n(jobs, 'scheduled job') : '', handlers ? n(handlers, 'event handler') : '', sockets ? n(sockets, 'socket entry point') : ''].filter(Boolean)
      if (words.length) out.set(i, words.join(' · '))
    }
    // Inside a part (not in Requests, whose cards are the endpoints): a component's endpoints, by the handlers in it; a file's, served.
    if (api && view !== 'requests') {
      const byPath = new Map<string, number>()
      for (const ep of api.endpoints) if (ep.handler) byPath.set(ep.handler.path, (byPath.get(ep.handler.path) ?? 0) + 1)
      const acc = new Int32Array(tree.size)
      for (const i of tree.dfs().reverse()) {
        const p = tree.els[i].metadata?.path
        if (p) acc[i] += byPath.get(p) ?? 0
        if (tree.parent[i] > 0) acc[tree.parent[i]] += acc[i]
      }
      for (let i = 1; i < tree.size; i++) if (acc[i] && tree.parent[i] > 0) out.set(i, tree.els[i].metadata?.path ? `serves ${n(acc[i], 'endpoint')}` : n(acc[i], 'endpoint'))
    }
    return out
  }
  /** Reads the surface again (a model arrived or changed) and redraws what shows it. */
  const refreshSurface = () => {
    const req = view === 'requests' ? raw : other
    const api = req ? buildApi(req) : null
    surface.api = api?.endpoints.length ? api : null
    const arch = view === 'requests' && other ? other : raw
    // Sample and synthetic models list no entry points; a published map always does.
    surface.marks = markedEntries(arch.elements, arch.entryPoints ?? [])
    surfaceText = cardSurface()
    callsRead = null
    renderer.surface = i => surfaceText.get(i) ?? ''
    if (held?.kind === 'api') showApi(held.filter)
    else if (held?.kind === 'feature') showFeature(held.name)
    else if (!edgeOpen()) {
      // Focus in the panel goes to the redrawn heading, not to the page.
      const inPanel = details.contains(document.activeElement)
      showDetails()
      if (inPanel) focusHeading()
    }
  }
  let rows: PanelRows = { uses: [], usedBy: [], mark: () => {} }
  /** The place the outline shows, while nothing is selected. */
  let outlined = -1
  const showDetails = () => {
    rows = renderDetails(details, tree, j => renderer.relationsOf(j), renderer.selected, actions, rankText(renderer.selected), surface)
    outlined = -1
    if (renderer.selected <= 0) return showOutline()
    // An endpoint opened from the list leads back to it.
    if (backToList && tree.els[renderer.selected].id === backToList.id) {
      const f = backToList.filter
      backButton('Endpoints', () => showApi(f))
    }
  }
  /** A "← Back to …" at the head of the panel. */
  const backButton = (to: string, run: () => void) => {
    const b = document.createElement('button')
    b.className = 'd-back'
    b.textContent = `← Back to ${to}`
    b.onclick = () => { details.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true }); run() }
    details.querySelector('.d-head')?.prepend(b)
  }
  /** With nothing selected, the panel outlines the place you are in (renderOutline). */
  const showOutline = () => {
    const path = renderer.breadcrumb(), here = path[path.length - 1] ?? 0
    if (renderer.selected > 0 || here === outlined) return
    outlined = here
    // Keyboard focus in the outline stays on the same card across a redraw.
    const focused = details.contains(document.activeElement) ? (document.activeElement as HTMLElement).textContent : null
    const focusedProblem = details.contains(document.activeElement) ? Number((document.activeElement as HTMLElement).dataset.problem ?? -1) : -1
    const was = outlinedBefore
    outlinedBefore = here
    // Under the Changed lens the panel lists what changed since the upload before, wherever you are.
    let problemRow: HTMLElement | null | undefined = null
    if (renderer.lens?.name === 'changed') { renderChanges(details, tree, { select: j => controls.goSelect(j), inspect: actions.inspect }); problemsPlace = -1 }
    else {
      renderOutline(details, tree, here, j => renderer.relationsOf(j), j => controls.goSelect(j), surfaceLead(tree, here, surface, actions))
      // The problems listed here; the row of the one just left takes focus back.
      // The problem being returned to, else the one its run started from; else the row that had focus.
      const wanted = problems && problemFocus ? [findProblem(tree, problems, problemFocus), findProblem(tree, problems, originKey)] : [focusedProblem]
      const listed = problems && problemsSection(tree, problems, here, problemsOpen, { open: k => openProblem(k), toggle: o => { problemsOpen = o; markProblems() } }, wanted)
      if (listed) { details.append(listed); problemsPlace = here }
      else problemsPlace = -1
      problemRow = wanted.map(k => (k >= 0 ? listed?.querySelector<HTMLElement>(`[data-problem="${k}"]`) : null)).find(Boolean)
    }
    // A pending return keeps until the frame loop lands it (an outline drawn before a flight is not the last).
    if (problemRow) problemRow.focus()
    // Or, when that card is not listed here, the outline's heading: focus stays in the panel.
    else if (focused != null) {
      const row = [...details.querySelectorAll<HTMLElement>('.d-outline button')].find(b => b.textContent === focused)
      const h = details.querySelector<HTMLElement>('h2')
      if (h) h.tabIndex = -1
      ;(row ?? h)?.focus({ preventScroll: true })
    }
    // A screen reader hears the place when it changes.
    if (here !== was) $('announce').textContent = here > 0 ? `In ${tree.els[here].title}: ${tree.children[here].length} inside` : `Whole map: ${tree.children[0].length} parts`
  }
  /** The place the outline last named, to announce only a change of place. */
  let outlinedBefore = -1
  const select = (i: number) => {
    edgeReturn = { selected: -1, list: null }
    held = null
    if (backToList && tree.els[i]?.id !== backToList.id) backToList = null
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
    requestAnimationFrame(() => {
      if (renderer.selected !== i) return
      // The card the reader asked to see: framed again for the sheet now open.
      if (intended() === i) return refit()
      const sheet = details.getBoundingClientRect(), bar = $('top').getBoundingClientRect().bottom
      const r = renderer.screenRectOf(i), cy = r[1] + Math.min(r[3], sheet.top - bar) / 2
      if (!details.hidden && !details.classList.contains('collapsed') && sheet.top > cam.h / 2 && (cy > sheet.top - 16 || r[1] + r[3] < bar + 16)) {
        const vw = cam.w / cam.z, vh = cam.h / cam.z, want = (bar + sheet.top) / 2
        if (!cam.flying) cam.flyTo(cam.x - vw / 2, cam.y + (cy - want) / cam.z - vh / 2, vw, vh, now(), 1)
      }
    })
    // A screen reader hears what was selected and how connected it is.
    $('announce').textContent = `Selected ${tree.els[i].title}: uses ${rows.uses.length}, used by ${rows.usedBy.length}`
  }
  /** Picks a line for the panel: what it carries and why, relation by relation. Null puts it down. */
  /**
   * Where putting an arrow down returns: the selection it was picked over, and the list of arrows
   * on a shared trunk when it was chosen from one. Reset by any new selection or model.
   */
  type Picked = { s: number; t: number; rels: number[] }
  let edgeReturn: { selected: number; list: Picked[] | null } = { selected: -1, list: null }
  /**
   * What the panel holds in place of a card: the endpoint list (with its filter) or a feature. Like
   * an arrow, it keeps the outline from taking the panel back, and Esc puts it down.
   */
  let held: { kind: 'api'; filter: ApiFilter } | { kind: 'feature'; name: string } | null = null
  /** The endpoint opened from the list, and the list's filter, so its panel leads back to the list. */
  let backToList: { id: string; filter: ApiFilter } | null = null
  /** An arrow, the list of arrows on a trunk, the endpoint list or a feature is in the panel: the outline waits. */
  const edgeOpen = () => renderer.edge != null || details.querySelector('.d-lines') != null || held != null
  /** The panel is about to hold something other than a card: where Esc returns, and nothing selected meanwhile. */
  const hold = (h: NonNullable<typeof held>) => {
    if (!edgeOpen()) edgeReturn = { selected: renderer.selected, list: null }
    held = h
    renderer.selected = -1
    renderer.edge = null
    rows = { uses: [], usedBy: [], mark: () => {} }
    outlined = -1
  }
  /**
   * The endpoint list in the panel. Focus that was on a filter stays on it across the redraw;
   * focus elsewhere in the panel goes to the heading.
   */
  const showApi = (f: ApiFilter) => {
    if (!surface.api) return controls.toast.show('This map has no Requests view, so its endpoints are not known')
    const active = document.activeElement as HTMLElement | null
    const inPanel = !!active && details.contains(active)
    const chip = inPanel && active!.closest('.d-filters') ? active!.textContent?.split(' · ')[0] : null
    hold({ kind: 'api', filter: f })
    renderApi(details, surface, f, { endpoint: id => openEndpoint(id, f), list: showApi, filter: showApi, close: () => { pickEdge(null); focusHeading() } })
    // On a phone the sheet opens now, not after this task, so focus can land in it.
    addGrip()
    if (edgeReturn.selected > 0) { const back = edgeReturn.selected; backButton(tree.els[back].title, () => pickEdge(null)) }
    $('announce').textContent = details.querySelector('h2')?.textContent ?? ''
    const again = chip && [...details.querySelectorAll<HTMLElement>('.d-filters button')].find(b => b.textContent?.split(' · ')[0] === chip)
    if (again) again.focus({ preventScroll: true })
    else if (inPanel) focusHeading()
  }
  /**
   * Which pages call which endpoints, read once from the pages' uploaded code (see callsIn): endpoint
   * id → the Architecture cards of the pages that call it. Read again when the surface changes.
   */
  let callsRead: Promise<Map<string, string[]>> | null = null
  const pageCalls = (): Promise<Map<string, string[]>> => {
    const api = surface.api, pages = archEls().filter(e => e.metadata?.path && isPage(e.metadata.path))
    if (!api || !pages.length) return Promise.resolve(new Map())
    return (callsRead ??= Promise.all(pages.map(async p => ({ id: p.id, eps: callsIn((await actions.source(p.metadata!.path)) ?? '', api.endpoints) }))).then(list => {
      const m = new Map<string, string[]>()
      for (const { id, eps } of list) for (const e of eps) m.set(e, [...(m.get(e) ?? []), id])
      return m
    }))
  }
  /** The elements features are read from: the Architecture model's, which carries them. */
  const archEls = () => (view === 'requests' ? other?.elements ?? [] : raw.elements)
  /**
   * A feature in the panel: its pages, its endpoints with their effects, the tables they touch and
   * the parts that carry it. False when the map has nothing for it.
   */
  const showFeature = (name: string, calls: Map<string, string[]> = new Map()): boolean => {
    const els = archEls()
    const facts = featureFacts(els, surface.api, name, calls)
    if (!facts.parts.length && !facts.pages.length && !facts.endpoints.length) return false
    const inPanel = details.contains(document.activeElement)
    hold({ kind: 'feature', name })
    const titles = new Map(els.map(e => [e.id, e.title]))
    renderFeature(details, name, facts, id => titles.get(id) ?? id, { part: actions.part, endpoint: id => openEndpoint(id), list: showApi })
    // Once the pages' code is read, the routes they call join the feature (drawn again, focus kept).
    if (!calls.size) void pageCalls().then(m => { if (m.size && held?.kind === 'feature' && held.name === name) { const f = details.contains(document.activeElement); showFeature(name, m); if (f) focusHeading() } })
    $('announce').textContent = `Feature ${name}: ${facts.pages.length} page${facts.pages.length === 1 ? '' : 's'}, ${facts.endpoints.length} endpoint${facts.endpoints.length === 1 ? '' : 's'}`
    if (inPanel) focusHeading()
    return true
  }
  const focusHeading = () => { const h = details.querySelector<HTMLElement>('h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); h.scrollIntoView({ block: 'nearest' }) } }
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  /**
   * Picks a line for the panel: what it carries and why, relation by relation. Several lines (a
   * shared trunk) list the arrows there, heaviest first, to pick one; each keeps the relations it
   * carried when clicked, however the map regroups after. Null puts it down: back to the list it was
   * chosen from, else the selection it was picked over. Focus in the panel stays in the panel.
   */
  const pickEdge = (l: { s: number; t: number } | { s: number; t: number }[] | null, opts: { rels?: number[]; from?: Picked[] } = {}) => {
    const inPanel = details.contains(document.activeElement)
    const inEdge = edgeOpen()
    if (!inEdge) edgeReturn = { selected: renderer.selected, list: null }
    held = null
    if (Array.isArray(l) && l.length === 1) l = l[0]
    if (!l && inPanel && problemShown()) problemFocus = problemKey(tree, problems!.list[problemAt])
    if (!l) {
      const back = edgeReturn
      renderer.edge = null
      if (back.list) { const list = back.list; edgeReturn = { ...back, list: null }; showList(list); if (inPanel) focusHeading(); return }
      edgeReturn = { selected: -1, list: null }
      if (back.selected > 0) { select(back.selected); if (inPanel) focusHeading(); return }
      renderer.selected = -1
      return showDetails()
    }
    if (Array.isArray(l)) {
      // The relations each line carries now, before the selection goes and the map regroups.
      const picked = l.map(x => ({ s: x.s, t: x.t, rels: renderer.relationsBetween(x.s, x.t) })).filter(x => x.rels.length).sort((a, b) => b.rels.length - a.rels.length)
      renderer.selected = -1
      showList(picked)
      if (inPanel) focusHeading()
      return
    }
    const rels = opts.rels ?? renderer.relationsBetween(l.s, l.t)
    const ends = { s: renderer.rep(l.s), t: renderer.rep(l.t) }
    edgeReturn.list = opts.from ?? null
    renderer.selected = -1
    renderer.edge = ends
    rows = { uses: [], usedBy: [], mark: () => {} }
    outlined = -1
    renderEdge(details, tree, l.s, l.t, rels, actions)
    const backTo = edgeReturn.list ? 'the arrows on this line' : edgeReturn.selected > 0 ? tree.els[edgeReturn.selected].title : ''
    if (backTo) {
      const b = document.createElement('button')
      b.className = 'd-back'
      b.textContent = `← Back to ${backTo}`
      b.onclick = () => { details.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true }); pickEdge(null) }
      details.querySelector('.d-head')?.prepend(b)
    }
    $('announce').textContent = `Arrow ${tree.els[l.s].title} ↔ ${tree.els[l.t].title}: ${plural(rels.length, 'relation')}`
    if (inPanel) focusHeading()
  }
  /** The arrows on a shared trunk, nothing drawn as picked until one is chosen. */
  const showList = (picked: Picked[]) => {
    renderer.edge = null
    rows = { uses: [], usedBy: [], mark: () => {} }
    outlined = -1
    renderLines(details, tree, picked.map(p => ({ s: p.s, t: p.t, count: p.rels.length, rels: p.rels })), (_, k) => pickEdge(picked[k], { rels: picked[k].rels, from: picked }))
    $('announce').textContent = `${picked.length} arrows share this line`
  }

  /**
   * Where Back to the list returns: the place the first problem of a run was opened from (the part
   * holding it, when that was a file, which lists none), and that problem, whose row takes focus when
   * the one open now has none there. Kept by identity: a live update may reorder the list.
   */
  let listHome: { id: string; view: ReturnType<typeof controls.view>; version: number; size: string } | null = null, originKey: ProblemKey | null = null
  /** A problem whose row takes keyboard focus once the outline lists it again (after Esc or Back to the list), the flight there done. */
  let problemFocus: ProblemKey | null = null
  /** The place whose problems the outline's list shows (-1: none shown): the map marks those. */
  let problemsPlace = 0
  /** Problem k in the panel: its arrow (every relation between its two cards, with their lines), why it is listed above, its flagged uses first. */
  const showProblem = (k: number) => {
    const p = problems!.list[k]
    pickEdge({ s: p.a, t: p.b }, { rels: relationsAcross(tree, p.a, p.b) })
    // Named by the cards themselves: the frame flown to shows them, whatever stood for them before.
    renderer.edge = { s: p.a, t: p.b }
    details.querySelector('.d-head')?.after(problemNote(tree, p, k, problems!.list.length, { step: d => void stepProblem(d), list: backToProblems }))
    const flagged = new Set(p.kind === 'coupling' ? [] : p.rels)
    for (const li of [...details.querySelectorAll<HTMLElement>('.d-edge li[data-rel]')].reverse()) {
      if (!flagged.has(Number(li.dataset.rel))) continue
      li.classList.add('d-flagged')
      li.querySelector('.d-why')?.prepend(Object.assign(document.createElement('em'), { className: 'd-flag', textContent: 'flagged' }))
      li.parentElement!.prepend(li)
    }
  }
  /**
   * Opens problem k: its arrow in the panel, and its two cards framed together in the space the
   * panel leaves. Back returns to where it was opened from.
   */
  const openProblem = (k: number) => {
    const p = problems?.list[k]
    if (!p || !problems) return
    if (!problemShown()) {
      const path = renderer.breadcrumb()
      let home = path[path.length - 1] ?? 0
      while (home > 0 && !tree.children[home].length) home = tree.parent[home]
      // The view it was opened from shows that outline when nothing has moved since; the part's id finds it otherwise.
      listHome = { id: tree.els[home].id, view: { ...controls.view(), selected: null }, version: liveVersion, size: `${cam.w}x${cam.h}` }
      originKey = problemKey(tree, p)
    }
    controls.leave()
    problemAt = k
    problemsOpen = true
    problemFocus = null
    showProblem(k)
    $('announce').textContent = `Problem ${k + 1} of ${problems.list.length}: ${p.title}. ${p.why}`
    controls.toast.show(`Problem ${k + 1}/${problems.list.length} · ${p.title}`, '] next · [ previous')
    markProblems()
    // Once the panel has settled (a phone's sheet opens with the arrow), so the frame keeps clear of it.
    queueMicrotask(() => { const f = frameCards([p.a, p.b]), vw = cam.w / f.z, vh = cam.h / f.z; cam.flyTo(f.x - vw / 2, f.y - vh / 2, vw, vh, now(), 1) })
  }
  /** ] and [ with nothing selected: the next or previous problem, on from the last one opened; 0 the first. False when the map has none. */
  const stepProblem = (dir: 1 | -1 | 0) => {
    const n = problems?.list.length ?? 0
    if (!n) return false
    openProblem(dir === 0 ? 0 : problemAt < 0 ? (dir > 0 ? 0 : n - 1) : (problemAt + dir + n) % n)
    return true
  }
  /** Back to the list: the place the run of problems started from, its outline, focus on the problem's row. */
  const backToProblems = () => {
    // Going into the place puts the arrow down and shows its outline and list, its row expanded for focus.
    problemFocus = problemKey(tree, problems!.list[problemAt])
    const home = listHome, at = home ? tree.byId.get(home.id) ?? 0 : 0
    // The view it was opened from, when the map and the window are as they were then; else the whole
    // part in view, which keeps it the place (going into a crowded part frames a card inside it).
    const same = home && home.version === liveVersion && home.size === `${cam.w}x${cam.h}` && home.view.here === (at > 0 ? home.id : null)
    // The whole map as it always frames; a part whole in the largest space the panels leave.
    const r = world.rect
    let fit = frameFor(0)
    if (at > 0) {
      fit = { z: 0, x: 0, y: 0 }
      for (const [l, t, rr, b] of freeFrames()) {
        // No smaller than render.ts still reads as the place (55% of the screen one way), even if then
        // some of it runs under the panel.
        const z = Math.max(Math.min((rr - l - 16) / r[at * 4 + 2], (b - t - 16) / r[at * 4 + 3]), Math.min((cam.w * 0.57) / r[at * 4 + 2], (cam.h * 0.57) / r[at * 4 + 3]))
        if (z <= fit.z) continue
        // Over the screen's centre, where render.ts reads the place from, even if that sets it lower in its frame.
        const half = (v: number) => (v * z) / 2, along = (lo: number, hi: number, size: number, mid: number) => Math.max(mid - half(size) + 8, Math.min(mid + half(size) - 8, (lo + hi) / 2))
        const sx = along(l, rr, r[at * 4 + 2], cam.w / 2)
        // Its title below the bar, where that still leaves it over the screen's centre.
        let sy = along(t, b, r[at * 4 + 3], cam.h / 2)
        const hh = half(r[at * 4 + 3])
        if (sy - hh < t + 4 && t + 4 <= cam.h / 2 - 8 && t + 4 + 2 * hh >= cam.h / 2 + 8) sy = t + 4 + hh
        fit = { z, x: r[at * 4] + r[at * 4 + 2] / 2 - (sx - cam.w / 2) / z, y: r[at * 4 + 1] + r[at * 4 + 3] / 2 - (sy - cam.h / 2) / z }
      }
    }
    const whole = { ...fit, selected: null, here: at > 0 ? tree.els[at].id : null }
    controls.visit(same ? home!.view : whole)
    controls.remember(at)
  }
  /** Whether the panel shows a problem's arrow now. */
  const problemShown = () => problemAt >= 0 && details.querySelector('.d-problem') != null
  /**
   * The map marks the problems the outline lists while that list is open (faint), and the one open
   * (strong); the arrow legend names the mark only while something is marked.
   */
  let marked = ''
  const markProblems = () => {
    const shown = problemShown()
    const inPanel = details.querySelector('.d-problems') != null
    const key = `${problemsOpen}|${problemsPlace}|${inPanel}|${shown ? problemAt : -1}|${liveVersion}`
    if (key === marked) return
    marked = key
    const all = problems && problemsOpen && problemsPlace >= 0 && (inPanel || shown) ? problemsAt(tree, problems, problemsPlace).flatMap(k => problems!.list[k].rels) : []
    const open = problems && shown ? problems.list[problemAt].rels : []
    renderer.warn = all.length || open.length ? { all: new Set(all), open: new Set(open) } : null
    arrowLegend()
  }

  /**
   * Beside the breadcrumb, how much changed since the upload before, when it can be told: a button
   * that turns the Changed lens on (and off again). Kept, not redrawn, so focus stays on it.
   */
  const changesChip = () => {
    const n = changeCount(tree.changed)
    $('changes').hidden = !n
    if (!n) return
    const b = $('changes')
    const on = renderer.lens?.name === 'changed'
    b.textContent = `${n} change${n === 1 ? '' : 's'}`
    b.title = on ? 'Back to the structure view' : `Show what changed since the upload before (${sinceText(tree.changed!.since)})`
    b.setAttribute('aria-pressed', String(on))
    b.onclick = () => setLens(on ? 'structure' : 'changed')
  }
  // Lenses: strategy-game overlays colouring every card by one measure.
  const lenses = buildLenses(tree)
  const lensBar = new LensBar(lenses)
  const setLens = (name: LensName) => {
    renderer.lens = lenses.find(l => l.name === name) ?? null
    lensBar.show(renderer.lens)
    // The Changed lens brings its list into the panel, over a selection or an arrow; leaving it
    // brings the outline back.
    outlined = -1
    if (name === 'changed' && (renderer.selected > 0 || edgeOpen())) select(-1)
    else if (renderer.selected <= 0 && !edgeOpen()) showOutline()
    changesChip()
  }
  lensBar.onPick = setLens
  lensBar.show(null)
  changesChip()

  const places = new Places(v => {
    const r = reading && (v.selected === reading.id || v.here === reading.id) ? reading : null
    const path = r ? tree.els[tree.byId.get(r.id) ?? 0]?.metadata?.path : null
    // The request carried from the Requests view stays in the other views' address; Requests names its own.
    return { at: v.selected, in: v.here, file: path, line: r?.line, lens: renderer.lens?.name ?? null, req: view === 'requests' ? null : undefined }
  }, () => cam.w)
  controls = installControls({
    app, tree, world, cam, renderer, minimap, lenses, coupling, setLens, select, fit, now, zoomLimit, zoomFloor, read: i => void openCode(i, startOf(i)), rows: () => rows, places, pickEdge, edgeOpen, stepProblem, focusPanel: () => focusHeading(), closeTop: () => { if (!reader.isOpen) return false; reader.close(); return true },
    api: () => surface.api, requests: view === 'requests', endpoint: id => openEndpoint(id), list: f => showApi(f), showFeature,
  })
  resize()
  // See the API on a narrow screen puts the welcome away: there it would stand over the list it opened.
  const intro = (again = false) => showIntro(tree, surface, name => controls.feature(name), () => { if (matchMedia('(max-width: 1099px)').matches) $('welcome').querySelector<HTMLButtonElement>('.ok')?.click(); showApi({}); focusHeading() }, again)
  refreshSurface()
  intro()
  // The other view's model: the Requests model gives Architecture its endpoints, Architecture gives Requests its features and marks.
  if (modelName !== 'synthetic') void (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}models/${view === 'requests' ? modelName : `${modelName}.requests`}.json`)
      if (res.ok && res.headers.get('content-type')?.includes('json')) other = await res.json()
    } catch { /* no other view: the surface is what this model has */ }
    if (!other) return
    refreshSurface()
    intro(true)
  })()
  // The heading and the browser tab both name the map and how it is shown.
  $('title').textContent = document.title = `${mapTitle()}: ${shownAs}`
  // The welcome is up now: the first frame keeps clear of it.
  if (!$('welcome').hidden) setWhole()

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
    if (renderer.warn) parts.push(item('a-problem', 'problems'))
    if (kinds.has('types')) {
      parts.push(item('a-types', 'type-only imports'))
      const b = document.createElement('button')
      b.textContent = showTypes ? 'Hide' : 'Show'
      b.title = showTypes ? 'Hide type-only imports: compile-time coupling, not use' : 'Show type-only imports, dotted'
      b.setAttribute('aria-label', showTypes ? 'Hide type-only imports' : 'Show type-only imports')
      b.onclick = () => {
        showTypes = !showTypes
        try { localStorage.setItem(TYPES_KEY, showTypes ? '1' : '0') } catch { /* private mode */ }
        void swapModel(raw, 0, showTypes ? 'Type-only imports shown, dotted' : 'Type-only imports hidden')
      }
      parts.push(b)
    }
    box.replaceChildren(...parts)
    box.hidden = false
  }
  arrowLegend()

  /** In the Requests view, the endpoint card i is or is in; -1 outside any. */
  const requestOf = (i: number) => { for (let a = i; a > 0; a = tree.parent[a]) if (endpointOf(tree.els[a])) return a; return -1 }
  // A link names a place: open there. The place (`in`) fills the view and the selection (`at`) is
  // selected in it; with only a selection, it is framed among its neighbours. `file` finds a file's
  // card (the Requests view has its own ids), and `line` opens it there.
  {
    const q = new URLSearchParams(location.search)
    const lens = q.get('lens')
    if (lens && lenses.some(l => l.name === lens)) setLens(lens as LensName)
    const at = tree.byId.get(q.get('at') ?? '') ?? -1, inside = tree.byId.get(q.get('in') ?? '') ?? -1
    const file = q.get('file'), line = Number(q.get('line')) || 0
    // Back from another view with the Requests card left (`req`): that card, when it shows the file or stands for it (an endpoint, its response).
    const left = view === 'requests' ? tree.byId.get(q.get('req') ?? '') ?? -1 : -1
    const leftOk = left > 0 && !!file && (tree.els[left].metadata?.path === file || (!tree.els[left].metadata?.path && requestOf(left) > 0 && tree.children[requestOf(left)].some(k => stepRole(tree.els[k]) === 'step' && tree.els[k].metadata?.path === file)))
    const target = at > 0 ? at : leftOk ? left : file ? cardOf(file, left > 0 ? left : inside) : -1
    // Selected first, so the frame leaves room for the panel it opens.
    if (target > 0) select(target)
    const framed = inside > 0 ? inside : target
    if (framed > 0) setFrame(framed)
    if (target > 0 && file && line) void openCode(target, line)
    places.update(controls.view())
    // Arrived from another view by a pick in the panel or search: focus is on what was picked.
    let crossed = false
    try { crossed = sessionStorage.getItem(CROSSED) === '1'; sessionStorage.removeItem(CROSSED) } catch { /* storage blocked */ }
    if (crossed && target > 0 && !(file && line)) focusHeading()
  }
  /**
   * The view switch keeps your subject: Architecture's two layouts share ids. The Requests view
   * has its own, so the subject crosses by its file, and the Requests card you were on rides along
   * in the address (`req`): coming back to the same file, that card is selected again (an endpoint,
   * its response, or the step of withdraw rather than of the first endpoint that runs the file). An
   * endpoint crosses as its handler's file. A part crosses to the endpoints whose handlers it
   * holds: one is selected, several framed by their resource.
   */
  const viewLinks = () => {
    const v = controls.view()
    const subject = tree.byId.get(v.selected ?? v.here ?? '') ?? -1
    const file = subject > 0 ? tree.els[subject].metadata?.path ?? null : null
    const lens = renderer.lens?.name ?? null
    const req = view === 'requests' ? (subject > 0 && requestOf(subject) > 0 ? tree.els[subject].id : null) : new URLSearchParams(location.search).get('req')
    // Into Requests, from a part or file of this view.
    const intoRequests = (): PlaceWords => {
      const api = surface.api
      // Before the Requests model is here, the card left rides along unread, for Requests to resolve.
      if (!api) return { at: null, file, req }
      if (subject <= 0) return { at: null, file }
      // The endpoint the carried card is in.
      let ep = null as (typeof api.endpoints)[number] | null
      for (let a: string | null | undefined = req; a && !ep; a = api.parent.get(a)) ep = api.endpoints.find(x => x.id === a) ?? null
      if (file) {
        // The card itself comes back when it shows the same file (the endpoint and its response stand for its handler's).
        const own = ep?.cards.find(c => c.id === req)
        if (ep && (own ? own.path === file : ep.handler?.path === file)) return { at: req }
        const card = ep?.cards.find(c => c.path === file)
        return card ? { at: card.id } : { at: null, file }
      }
      const ids = endpointsUnder(tree, subject, api)
      if (ep && ids.includes(ep.id)) return { at: ep.id }
      if (ids.length === 1) return { at: ids[0] }
      if (!ids.length) return { at: null }
      // Several: the resource they share.
      const up = (id: string) => { const out: string[] = []; for (let a: string | null | undefined = id; a; a = api.parent.get(a)) out.push(a); return out }
      const common = ids.map(up).reduce((acc, chain) => acc.filter(a => chain.includes(a)))
      return { at: null, in: common[0] ?? null }
    }
    // Out of Requests: a file as itself; an endpoint, or a card of one with no file (its response), as its handler's file.
    const fromRequests = (): PlaceWords => {
      const r = subject > 0 ? requestOf(subject) : -1
      const ep = r > 0 ? surface.api?.endpoints.find(x => x.id === tree.els[r].id) : null
      return { at: null, file: file ?? ep?.handler?.path ?? null, req }
    }
    // Within this view (Architecture's other layout) the code being read comes along too.
    // The reader as it is now, not the address, which a close a moment ago has not caught up with.
    const reading = reader.reading
    for (const a of document.querySelectorAll<HTMLAnchorElement>('#views a, .layout-menu a')) {
      const base = (a.dataset.base ??= a.getAttribute('href') ?? '')
      const toRequests = new URLSearchParams(base).get('view') === 'requests'
      a.href = toRequests === (view === 'requests')
        ? placeUrl(base, { at: v.selected, in: v.here, lens, req: view === 'requests' ? null : req, file: reading?.path ?? null, line: reading?.line ?? null })
        : placeUrl(base, toRequests ? intoRequests() : fromRequests())
    }
  }
  // A link is brought up to date as it is used, not only on the timer: picked mid-flight, it carries
  // the selection just made.
  for (const type of ['pointerdown', 'focusin', 'keydown'] as const) {
    addEventListener(type, e => { if ((e.target as Element | null)?.closest?.('#views a, .layout-menu a')) viewLinks() }, true)
  }

  // Live models: the dev server pushes an event when a workspace's LikeC4 files change. The new
  // version replaces the old in place: unchanged containers keep their layout, survivors glide
  // to their new places, new cards grow out of their parent, and changes glow for a moment.
  let liveVersion = 0
  const swapModel = async (json: ModelJson, buildMs = 0, said?: string) => {
    raw = json
    const swapStart = performance.now()
    const next = new Tree(json, { types: showTypes })
    const aspect = rootAspect
    const nextJobs = layoutJobs(next, coupling, aspect)
    stableOrder(tree, jobs, next, nextJobs)
    const { reused, rerun } = reuseLayouts(tree, jobs, local, next, nextJobs)
    swapping++
    const fresh = await (rerun.length ? runLayout(rerun) : Promise.resolve(new Map<number, LocalLayout>())).finally(() => { swapping-- })
    const nextLocal = new Map([...reused, ...fresh])
    const target = placeWorld(next, nextLocal)
    const diff = diffModels(tree, next)
    const start = startRects(world, next, target, diff.oldIndex)
    // Per card, by id: open before this update (and not still opening from nothing in the last one).
    const wasOpen = new Uint8Array(next.size)
    for (let k = 1; k < next.size; k++) { const j = diff.oldIndex[k]; wasOpen[k] = j > 0 && tree.children[j].length > 0 && (!morph || morph.wasOpen[j]) ? 1 : 0 }
    // The same layout as the move under way ends at: the same cards, each ending exactly where it
    // would have (layout is deterministic; deep in a map a visible move is under 1e-9 world units).
    const sameEnd = !!morph && !diff.added.length && !diff.removed.length && next.els.every((_, k) => {
      const j = diff.oldIndex[k]
      return j >= 0 && [0, 1, 2, 3].every(q => morph!.to.rect[j * 4 + q] === target.rect[k * 4 + q])
    })
    const live: World = { rect: start.rect.slice(), content: start.content.slice(), local: nextLocal }

    // Keep what you are looking at where it is on screen, the selection if there is one, else
    // what is under the screen centre: the camera moves with it.
    const cam0: [number, number, number] = [cam.x, cam.y, cam.z]
    let cam1 = cam0
    let anchor = renderer.selected > 0 ? renderer.selected : renderer.pick(cam.w / 2, cam.h / 2)
    while (anchor > 0 && !next.byId.has(tree.els[anchor].id)) anchor = tree.parent[anchor]
    // A card asked for that this version no longer has: the nearest part holding it that it still has.
    if (intent.kind === 'card') {
      let a = tree.byId.get(intent.id) ?? -1
      while (a > 0 && !next.byId.has(tree.els[a].id)) a = tree.parent[a]
      intent = a > 0 ? { kind: 'card', id: tree.els[a].id } : a === 0 ? { kind: 'whole' } : { kind: 'free' }
    }
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
    for (const i of diff.changed) nextRenderer.flash.set(i, { color: 0x93c5fd, t0: t })
    for (const i of diff.added) nextRenderer.flash.set(i, { color: 0x6ee7b7, t0: t })
    app.stage.removeChild(prev.stage)
    app.stage.addChildAt(nextRenderer.stage, 0)
    prev.destroy()

    // The problem being read survives an update that keeps it: found again by its kind and its two cards.
    // A cycle is a pair either way round (a tangle's order follows its counts); the others keep their direction.
    // The selection it was opened over and the control with focus come back with it.
    const active = details.contains(document.activeElement) ? document.activeElement as HTMLElement : null
    // The focused control by what it is: in a relation's row, that relation's two ends and the control's place in the row; else the heading, or a button's words.
    const relId = (t: Tree, k: number) => `${t.els[t.rels[k * 2]].id}>${t.els[t.rels[k * 2 + 1]].id}>${t.relKind[k]}`
    const row = active?.closest<HTMLElement>('li[data-rel]')
    // A citation is its path and line (its tooltip's start), so a line added before it does not take its place.
    const focus = !active ? null : row ? { rel: relId(tree, Number(row.dataset.rel)), at: [...row.querySelectorAll('button')].indexOf(active as HTMLButtonElement), cite: active.classList.contains('cite') ? active.title.split(': ')[0] : '' } : { tag: active.tagName, text: active.textContent }
    const keep = problems && problemAt >= 0 ? { shown: problemShown(), key: problemKey(tree, problems.list[problemAt]), over: edgeReturn.selected > 0 ? tree.els[edgeReturn.selected].id : null, focus } : null
    tree = next; jobs = nextJobs; local = nextLocal; world = live; renderer = nextRenderer
    problems = problemsOf(next)
    problemAt = keep && problems ? findProblem(next, problems, keep.key) : -1
    edgeReturn = { selected: -1, list: null }
    lenses.splice(0, lenses.length, ...buildLenses(next))
    renderer.lens = lenses.find(l => l.name === prev.lens?.name) ?? null
    lensBar.setLenses(lenses)
    lensBar.show(renderer.lens)
    outlined = -1
    // The count of changes is the new model's.
    changesChip()
    minimap.tree = next; minimap.world = live
    code.reset(next)
    controls.swap({ tree: next, world: live, renderer })
    showDetails()
    if (keep?.shown && problemAt >= 0) {
      // Opened over a selection: the arrow panel takes it as where Esc returns, as when first opened.
      renderer.selected = next.byId.get(keep.over ?? '') ?? -1
      showProblem(problemAt)
      // The control with focus, found again by what it opens (a citation's path and line), else its words.
      const f = keep.focus
      const control = !f ? null : 'rel' in f
        ? (() => {
          const li = [...details.querySelectorAll<HTMLElement>('li[data-rel]')].find(li => relId(next, Number(li.dataset.rel)) === f.rel)
          const buttons = [...(li?.querySelectorAll<HTMLElement>('button') ?? [])]
          // A citation that is gone leaves focus on its relation's own button, in the same row.
          return (f.cite ? buttons.find(b => b.classList.contains('cite') && b.title.split(': ')[0] === f.cite) : buttons[Number(f.at)]) ?? buttons[0] ?? null
        })()
        : f.tag === 'H2' ? details.querySelector<HTMLElement>('h2') : [...details.querySelectorAll<HTMLElement>('button')].find(e => e.textContent === f.text) ?? null
      if (control?.tagName === 'H2') control.tabIndex = -1
      control?.focus({ preventScroll: true })
    } else if (keep?.shown) {
      // The problem is gone: back to the selection it was opened over, as Esc would, focus on its heading.
      const over = next.byId.get(keep.over ?? '') ?? -1
      if (over > 0) select(over)
      if (keep.focus) focusHeading()
    }
    refreshSurface()
    // What the reader asked to see is framed at each step of the move (stepMorph); an update
    // arriving while the last one still moves into place starts from where that one had got to.
    // A free camera already moving (a jump of the reader's, a wheel, a glide) is theirs: this move
    // leaves it be. So is one they took during the last update's move when this one ends at the
    // same layout (the same update again); an update that lays the map out otherwise moves the
    // camera with what it shows from where the reader left it.
    const theirs = intended() < 0 && (!cam.settled || (sameEnd && morph!.handsOff))
    morph = { t0: t, dur: 700, e: 0, from: start, to: target, wasOpen, cam0, cam1, handsOff: theirs, gap: null }
    // A camera settled on what the reader asked to see closes any gap to its framing in the new
    // version over the move (a flight to it is sent there instead, on its own clock).
    const asked = intended()
    if (asked >= 0 && cam.settled) {
      const f0 = frameNow(asked)
      morph.gap = { of: intent, d: [cam.x - f0.x, cam.y - f0.y, Math.log(cam.z / f0.z)] }
    }
    liveVersion++
    // An update that changed nothing (a file written twice) says nothing, so it never hides one that did.
    const changed = diff.added.length + diff.removed.length + diff.changed.length + diff.arrowsAdded + diff.arrowsRemoved + diff.evidenceChanged + diff.viaChanged > 0
    if (said || changed) controls.toast.show(said ?? `Map updated · ${describeDiff(diff, next)}`)
    marked = ''
    markProblems()
    arrowLegend()
    console.info(`live update: ${rerun.length} of ${nextJobs.length} layouts redone · build ${buildMs} ms · swap ${Math.round(performance.now() - swapStart)} ms`)
    // The stage changed shape while this version was being laid out: lay it out for the new one.
    if (rootAspect !== aspect) { rootAspect = aspect; reshape() }
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
    morph.e = e
    // What the reader asked to see is framed where it now is, or a flight to it sent there. Else the
    // camera moves with what it shows until the reader moves it (a wheel, a pan, a jump): then it is theirs.
    if (!reframe() && !morph.handsOff && (x0 !== x1 || y0 !== y1 || z0 !== z1)) {
      const z = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * e)
      cam.steer(() => cam.set(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, z))
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
      // A view the new upload no longer has (its last endpoint gone): back to the architecture, as it is now.
      if (!res.ok || !res.headers.get('content-type')?.includes('json')) { if (view) { const q = new URLSearchParams(location.search); q.delete('view'); location.replace(`?${q}`) } return }
      const json = await res.json(); published = json.published; lastCrumb = null; await swapModel(view === 'requests' ? named(json) : json, json.buildMs ?? 0)
    }).catch(e => console.error(e))
  })
  // A newly published map gets its tab without a reload.
  import.meta.hot?.on('models:index', () => renderModelTabs($('models'), $('views'), modelName, new URLSearchParams(location.search).get('n'), view, coupling))



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
        // Every view names the map as the map's own title (Requests' model adds " · requests").
        b.textContent = i === 0 ? mapTitle() : tree.els[i].title
        b.title = b.textContent
        b.onclick = () => controls.go(i)
        if (k === path.length) { b.className = 'here'; b.setAttribute('aria-current', 'location') }
        return b
      }), ...provenance(published, uploaded))
      // A long path gives way in its middle: the map, the place you are in and its parent stay.
      const buttons = [...crumbs.querySelectorAll('button')]
      for (let k = 1; k < buttons.length - 2 && crumbs.scrollWidth > crumbs.clientWidth + 1; k++) { buttons[k].textContent = '…'; buttons[k].style.flex = 'none' }
      // The tab names the place, the map and how it is shown: "War · Knights of Darkness: Architecture".
      document.title = `${here > 0 ? `${tree.els[here].title} · ` : ''}${mapTitle()}: ${shownAs}`
      if (!cam.flying && !edgeOpen()) showOutline()
    }
    if (!cam.flying && outlined !== here && renderer.selected <= 0 && !edgeOpen()) showOutline()
    markProblems()
    // Back from a problem: once landed, its row in the outline takes focus (a redraw on the way may have moved it).
    if (problemFocus && problems && !cam.flying && !edgeOpen()) {
      const want = problemFocus, list = problems
      problemFocus = null
      // After the grip has settled on a redraw this frame (it folds an outline), so the sheet stays open:
      // an explicit return to the list keeps a phone's sheet open on it.
      queueMicrotask(() => {
        const row = (k: number) => (k >= 0 ? details.querySelector<HTMLElement>(`.d-problems [data-problem="${k}"]`) : null)
        if (details.classList.contains('collapsed')) setSheet(true)
        ;(row(findProblem(tree, list, want)) ?? row(findProblem(tree, list, originKey)) ?? details.querySelector<HTMLElement>('.d-problems > summary'))?.focus()
      })
    }
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
      get problems() { return problems }, get problemAt() { return problemAt }, openProblem,
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
