import { Application } from 'pixi.js'
import { Camera } from './camera'
import { installControls } from './controls/install'
import { renderDetails } from './details'
import { Altimeter, Banner, LensBar } from './hud'
import { layoutJobs, placeWorld, type World } from './layout'
import { runLayout } from './layoutPool'
import { buildLenses, type LensName } from './lens'
import { Minimap } from './minimap'
import { Tree, type ModelJson } from './model'
import { Renderer } from './render'
import { Sound } from './sound'
import { synthetic } from './synthetic'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const modelName = new URLSearchParams(location.search).get('model') ?? 'acme'

async function loadModel(): Promise<ModelJson> {
  if (modelName === 'synthetic') return synthetic(Number(new URLSearchParams(location.search).get('n') ?? 1000))
  const res = await fetch(`${import.meta.env.BASE_URL}models/${modelName}.json`)
  if (!res.ok) throw new Error(`model ${modelName}: ${res.status}`)
  return res.json()
}

const ring = (n: number) => ({ a: new Float64Array(n), k: 0, full: false })
type Ring = ReturnType<typeof ring>
const push = (r: Ring, v: number) => { r.a[r.k] = v; r.k = (r.k + 1) % r.a.length; if (!r.k) r.full = true }
const values = (r: Ring) => Array.from(r.full ? r.a : r.a.slice(0, r.k))
const pct = (v: number[], p: number) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

async function main() {
  const t0 = performance.now()
  const model = await loadModel()
  const tree = new Tree(model)
  const tLayout = performance.now()
  const local = await runLayout(layoutJobs(tree))
  const layoutMs = performance.now() - tLayout
  const world: World = placeWorld(tree, local)

  const app = new Application()
  await app.init({ resizeTo: window, background: '#04060c', antialias: true, autoDensity: true, resolution: devicePixelRatio, preference: 'webgl' })
  $('stage').appendChild(app.canvas)
  Renderer.installFont()
  const cam = new Camera()
  const renderer = new Renderer(app, tree, world, cam)
  app.stage.addChild(renderer.stage)
  const minimap = new Minimap($<HTMLCanvasElement>('minimap'), tree, world)
  const altimeter = new Altimeter(tree)
  const banner = new Banner(tree)
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
    renderer.hud = ['stats', 'minimap', 'help', 'bookmarks'].map(id => { const e = document.getElementById(id) ?? document.querySelector(`.${id}`); const r = e?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height] : [0, 0, 0, 0] })
  }
  {
    cam.resize(app.screen.width, app.screen.height)
    const r = world.rect
    const z = Math.min((cam.w * 0.92) / r[2], (cam.h * 0.92) / r[3])
    cam.set(r[2] / 2, r[3] / 2, z)
  }
  window.addEventListener('resize', resize)

  // Selection: click a card to focus its relations; the panel lists them, each a jump.
  const details = $('details')
  let controls: ReturnType<typeof installControls>
  const select = (i: number) => {
    renderer.selected = i > 0 ? i : -1
    if (i > 0) sound.select()
    renderDetails(details, tree, renderer, renderer.selected, j => { select(j); controls.go(j) })
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

  controls = installControls({ app, tree, world, cam, renderer, minimap, sound, lenses, model: modelName, setLens, select, fit, now })
  resize()
  const soundBtn = $<HTMLButtonElement>('sound')
  soundBtn.onclick = () => { const on = sound.toggle(); soundBtn.textContent = on ? 'Sound on' : 'Sound off'; soundBtn.classList.toggle('on', on) }

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
    last = renderer.frame(t)
    const path = renderer.breadcrumb()
    altimeter.update(path, renderer.altitude(path), cam.z / ((cam.w * 0.92) / world.rect[2]))
    banner.update(path[path.length - 1] ?? 0, t)
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
      ready: true, tree, world, cam, renderer, controls, layoutMs, loadMs: performance.now() - t0,
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
