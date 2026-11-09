import { Application } from 'pixi.js'
import { Camera } from './camera'
import { CodeView, linePoint } from './code'
import { installControls } from './controls/install'
import { renderDetails } from './details'
import { Altimeter, LensBar } from './hud'
import { layoutJobs, placeWorld, type World } from './layout'
import { runLayout } from './layoutPool'
import { buildLenses, type LensName } from './lens'
import { Minimap } from './minimap'
import { renderModelTabs } from './models'
import { diffModels, reuseLayouts, stableOrder, startRects } from './live'
import { Tree, type ModelJson } from './model'
import { Renderer } from './render'
import { Sound } from './sound'
import { synthetic } from './synthetic'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const modelName = new URLSearchParams(location.search).get('model') ?? 'acme'
/** A second view of the same import, such as its requests; it reads code from the import's repo. */
const view = new URLSearchParams(location.search).get('view')
const modelFile = view ? `${modelName}.${view}` : modelName
/** On-screen font size a jump into code aims for, and the largest the wheel zooms code to. */
const READ_PX = 15
const MAX_READ_PX = 28

async function loadModel(): Promise<ModelJson> {
  if (modelName === 'synthetic') return synthetic(Number(new URLSearchParams(location.search).get('n') ?? 1000))
  const res = await fetch(`${import.meta.env.BASE_URL}models/${modelFile}.json`)
  if (!res.ok) throw new Error(`model ${modelFile}: ${res.status}`)
  return res.json()
}

const ring = (n: number) => ({ a: new Float64Array(n), k: 0, full: false })
type Ring = ReturnType<typeof ring>
const push = (r: Ring, v: number) => { r.a[r.k] = v; r.k = (r.k + 1) % r.a.length; if (!r.k) r.full = true }
const values = (r: Ring) => Array.from(r.full ? r.a : r.a.slice(0, r.k))
const pct = (v: number[], p: number) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

async function main() {
  const t0 = performance.now()
  renderModelTabs($('models'), $('views'), modelName, new URLSearchParams(location.search).get('n'), view)
  const model = await loadModel()
  // The current model version; live updates replace all four.
  let tree = new Tree(model)
  let jobs = layoutJobs(tree)
  const tLayout = performance.now()
  let local = await runLayout(jobs)
  const layoutMs = performance.now() - tLayout
  let world: World = placeWorld(tree, local)

  const app = new Application()
  await app.init({ resizeTo: window, background: '#04060c', antialias: true, autoDensity: true, resolution: devicePixelRatio, preference: 'webgl' })
  $('stage').appendChild(app.canvas)
  Renderer.installFont()
  const cam = new Camera()
  let renderer = new Renderer(app, tree, world, cam)
  app.stage.addChild(renderer.stage)
  const minimap = new Minimap($<HTMLCanvasElement>('minimap'), tree, world)
  const altimeter = new Altimeter(tree)
  const code = new CodeView($('code'), modelName, tree)
  const sound = new Sound()
  renderer.onOpen = () => sound.chime()

  // The clock: real time normally; a recorder can switch to manual and step frames exactly.
  let manual = false, simNow = performance.now()
  const now = () => (manual ? simNow : performance.now())

  const fit = (i: number) => {
    const r = world.rect
    // With the details panel open, frame the target in the space left of it.
    const panel = document.getElementById('details')
    const cover = panel && !panel.hidden ? panel.getBoundingClientRect().width + 24 : 0
    const widen = cam.w / Math.max(1, cam.w - cover)
    // A container fills the view; a single file is shown among its neighbours, for context.
    const fill = i === 0 ? 0.92 : tree.children[i].length ? 0.85 : 0.38
    cam.flyTo(r[i * 4], r[i * 4 + 1], r[i * 4 + 2] * widen, r[i * 4 + 3], now(), fill)
  }
  const resize = () => {
    cam.resize(app.screen.width, app.screen.height)
    renderer.hud = ['stats', 'minimap', 'help', 'alt'].map(id => { const e = document.getElementById(id) ?? document.querySelector(`.${id}`); const r = e?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height] : [0, 0, 0, 0] })
  }
  {
    cam.resize(app.screen.width, app.screen.height)
    const r = world.rect
    const z = Math.min((cam.w * 0.92) / r[2], (cam.h * 0.92) / r[3])
    cam.set(r[2] / 2, r[3] / 2, z)
  }
  // Pixi applies a window resize a frame later; reading the screen before that keeps the old
  // size, and everything outside it is culled as off-screen.
  app.renderer.on('resize', resize)

  // Selection: click a card to focus its relations; the panel lists them, each a jump.
  const details = $('details')
  let controls: ReturnType<typeof installControls>
  /**
   * How far the wheel may zoom in at a screen point. A container always has more inside it; a
   * file stops once its code reads comfortably, or (with no code to show) at a screen and a half.
   */
  const zoomLimit = (sx: number, sy: number) => {
    const i = renderer.pick(sx, sy)
    if (i <= 0 || tree.children[i].length) return Infinity
    const font = code.fontOf(i)
    return font ? (cam.z * MAX_READ_PX) / font : (cam.w * 1.5) / world.rect[i * 4 + 2]
  }
  /** Opens a file at a line: flies there with the line readable, beside the panel, and selects the file. */
  const openCode = async (path: string, line: number) => {
    const i = tree.els.findIndex(e => e.metadata?.path === path)
    if (i <= 0) return
    // Fetching and preparing a big file takes a moment; say so at once.
    controls.toast.show(`Opening ${path.split('/').pop()}:${line}`)
    const m = await code.measure(i)
    if (!m) return controls.go(i)
    const r = world.rect
    const p = linePoint(r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3], m.lines, m.cols, line)
    const z = READ_PX / p.font
    // The line goes in the middle of the space the details panel leaves free.
    const cover = details.hidden ? 0 : details.getBoundingClientRect().width + 24
    controls.visit({ x: p.x + cover / 2 / z, y: p.y, z, selected: tree.els[i].id })
  }
  const select = (i: number) => {
    renderer.selected = i > 0 ? i : -1
    if (i > 0) sound.select()
    renderDetails(details, tree, renderer, renderer.selected, j => { select(j); controls.go(j) }, openCode)
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

  controls = installControls({ app, tree, world, cam, renderer, minimap, sound, lenses, model: modelName, setLens, select, fit, now, zoomLimit })
  resize()
  const soundBtn = $<HTMLButtonElement>('sound')
  soundBtn.onclick = () => { const on = sound.toggle(); soundBtn.textContent = on ? 'Sound on' : 'Sound off'; soundBtn.classList.toggle('on', on) }

  // Live models: the dev server pushes an event when a workspace's LikeC4 files change. The new
  // version replaces the old in place: unchanged containers keep their layout, survivors glide
  // to their new places, new cards grow out of their parent, and changes glow for a moment.
  let morph: { t0: number; dur: number; from: { rect: Float64Array; content: Float64Array }; to: World; cam0: [number, number, number]; cam1: [number, number, number] } | null = null
  let liveVersion = 0
  const swapModel = async (json: ModelJson, buildMs = 0) => {
    const swapStart = performance.now()
    const next = new Tree(json)
    const nextJobs = layoutJobs(next)
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
    nextRenderer.onOpen = () => sound.chime()
    nextRenderer.hud = prev.hud
    nextRenderer.pointer = prev.pointer
    nextRenderer.selected = remap(prev.selected)
    nextRenderer.target = remap(prev.target)
    if (prev.route) {
      const hops = prev.route.map(h => ({ ...h, from: remap(h.from), to: remap(h.to) }))
      if (hops.every(h => h.from > 0 && h.to > 0)) { nextRenderer.route = hops; nextRenderer.routeStep = prev.routeStep }
    }
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
    altimeter.setTree(next)
    code.reset(next)
    controls.swap({ tree: next, world: live, renderer })
    renderDetails(details, tree, renderer, renderer.selected, j => { select(j); controls.go(j) }, openCode)
    morph = { t0: t, dur: 700, from: start, to: target, cam0, cam1 }
    liveVersion++
    const parts = [diff.added.length && `+${diff.added.length} added`, diff.changed.length && `${diff.changed.length} changed`, diff.removed.length && `−${diff.removed.length} removed (${diff.removed.slice(0, 3).map(id => id.split('.').pop()).join(', ')}${diff.removed.length > 3 ? '…' : ''})`].filter(Boolean)
    controls.toast.show(`Model updated · ${parts.join(' · ') || 'no visible change'}`, `${rerun.length} of ${nextJobs.length} layouts redone · build ${buildMs} ms · swap ${Math.round(performance.now() - swapStart)} ms`)
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
      if (res.ok) { const json = await res.json(); await swapModel(json, json.buildMs ?? 0) }
    }).catch(e => console.error(e))
  })
  // A newly published map gets its tab without a reload.
  import.meta.hot?.on('models:index', () => renderModelTabs($('models'), $('views'), modelName, new URLSearchParams(location.search).get('n'), view))

  // Frame loop: animations run every frame, so the scene always renders.
  const cpu = ring(240), delta = ring(240)
  let last = renderer.frame(now())
  const crumbs = $('crumbs'), stats = $('stats')
  let lastCrumb: string | null = null
  const tick = (dt: number) => {
    const start = performance.now()
    const t = now()
    controls.tick(dt, t)
    cam.step(t, dt)
    stepMorph(t)
    last = renderer.frame(t)
    code.update(renderer.codeSlots, cam.w, cam.h)
    const path = renderer.breadcrumb()
    altimeter.update(path, renderer.altitude(path), cam.z / ((cam.w * 0.92) / world.rect[2]))
    const key = path.join('/')
    if (key !== lastCrumb) {
      lastCrumb = key
      crumbs.replaceChildren(...[0, ...path].map((i, k) => {
        const b = document.createElement('button')
        b.textContent = tree.els[i].title
        b.onclick = () => controls.go(i)
        if (k === path.length) b.className = 'here'
        return b
      }))
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
    minimap.draw(cam)
  }, 250)

  const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info')
  Object.assign(window, {
    __spike: {
      ready: true, cam, controls, layoutMs, loadMs: performance.now() - t0,
      get tree() { return tree }, get world() { return world }, get renderer() { return renderer },
      get liveVersion() { return liveVersion }, get morphing() { return morph != null }, swapModel,
      gpu: dbg && gl ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      fit, fly: (i: number) => controls.go(i), select, setLens, unhover: () => { renderer.pointer = null }, last: () => last, id: (s: string) => tree.byId.get(s) ?? -1,
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
  $('stats').textContent = String(e?.stack ?? e)
  console.error(e)
})
