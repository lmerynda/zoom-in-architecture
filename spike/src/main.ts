import { Application } from 'pixi.js'
import { Camera } from './camera'
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

async function loadModel(): Promise<ModelJson> {
  const q = new URLSearchParams(location.search)
  const name = q.get('model') ?? 'acme'
  if (name === 'synthetic') return synthetic(Number(q.get('n') ?? 1000))
  const res = await fetch(`${import.meta.env.BASE_URL}models/${name}.json`)
  if (!res.ok) throw new Error(`model ${name}: ${res.status}`)
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

  const fit = (i: number, dur?: number) => {
    const r = world.rect
    // With the details panel open, frame the target in the space left of it.
    const panel = document.getElementById('details')
    const cover = panel && !panel.hidden ? panel.getBoundingClientRect().width + 24 : 0
    const widen = cam.w / Math.max(1, cam.w - cover)
    cam.flyTo(r[i * 4], r[i * 4 + 1], r[i * 4 + 2] * widen, r[i * 4 + 3], now(), i === 0 ? 0.92 : 0.85, dur)
  }
  const resize = () => {
    cam.resize(app.screen.width, app.screen.height)
    renderer.hud = ['stats', 'minimap', 'help'].map(id => { const r = $(id).getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })
  }
  resize()
  {
    const r = world.rect
    const z = Math.min((cam.w * 0.92) / r[2], (cam.h * 0.92) / r[3])
    cam.set(r[2] / 2, r[3] / 2, z)
  }
  window.addEventListener('resize', resize)

  // Selection: click a card to focus its relations; the panel lists them, each a jump.
  const details = $('details')
  const select = (i: number) => {
    renderer.selected = i > 0 ? i : -1
    if (i > 0) sound.select()
    renderDetails(details, tree, renderer, renderer.selected, j => { select(j); fly(j) })
  }
  /** Flight to an element with the whoosh sized to the flight. */
  const fly = (i: number) => {
    fit(i)
    sound.whoosh(cam.flightMs / 1000)
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

  // Mouse: wheel zooms at the cursor, drag pans with inertia, click selects, double-click flies in.
  const canvas = app.canvas
  canvas.addEventListener('wheel', e => {
    e.preventDefault()
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    cam.zoomAt(e.offsetX, e.offsetY, Math.exp(-d * 0.0022))
  }, { passive: false })
  let drag: { x: number; y: number; t: number; vx: number; vy: number; moved: number } | null = null
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId)
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: 0 }
  })
  canvas.addEventListener('pointermove', e => {
    renderer.pointer = [e.offsetX, e.offsetY]
    if (!drag) return
    const t = performance.now(), dt = Math.max(1, t - drag.t)
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    drag.moved += Math.abs(dx) + Math.abs(dy)
    cam.panBy(dx, dy)
    drag.vx = drag.vx * 0.6 + (dx / dt) * 0.4
    drag.vy = drag.vy * 0.6 + (dy / dt) * 0.4
    drag.x = e.clientX; drag.y = e.clientY; drag.t = t
  })
  canvas.addEventListener('pointerup', e => {
    if (drag && drag.moved < 5) {
      const hit = renderer.pick(e.offsetX, e.offsetY)
      select(hit === renderer.selected ? -1 : hit)
    } else if (drag && performance.now() - drag.t < 80) cam.release(drag.vx, drag.vy)
    drag = null
  })
  canvas.addEventListener('pointerleave', () => { renderer.pointer = null })
  canvas.addEventListener('dblclick', e => fly(renderer.pick(e.offsetX, e.offsetY)))
  minimap.onPick = (wx, wy) => cam.flyTo(wx - cam.w / cam.z / 2, wy - cam.h / cam.z / 2, cam.w / cam.z, cam.h / cam.z, now(), 1)

  // Keyboard: WASD or arrows fly, Q/E zoom, Tab cycles siblings, Enter dives in, L cycles lenses.
  const held = new Set<string>()
  const search = $<HTMLInputElement>('search')
  const soundBtn = $<HTMLButtonElement>('sound')
  const toggleSound = () => { soundBtn.textContent = sound.toggle() ? 'Sound on' : 'Sound off'; soundBtn.classList.toggle('on', sound.on) }
  soundBtn.onclick = toggleSound
  /** The element keyboard commands act on: the selection, else the one under the screen centre. */
  const subject = () => (renderer.selected > 0 ? renderer.selected : renderer.pick(cam.w / 2, cam.h / 2))
  window.addEventListener('keydown', e => {
    if (e.target === search) {
      if (e.key === 'Enter') {
        const q = search.value.trim().toLowerCase()
        const hit = tree.els.findIndex((el, i) => i > 0 && el.title.toLowerCase().includes(q))
        if (hit > 0) { select(hit); fly(hit) }
        search.blur()
      }
      if (e.key === 'Escape') search.blur()
      return
    }
    const k = e.key.toLowerCase()
    held.add(k)
    if (k === '/') { e.preventDefault(); search.focus(); search.select() }
    if (k === 'home' || k === '0') fly(0)
    if (k === 'm') toggleSound()
    if (k === 'l') {
      const order: LensName[] = ['structure', ...lenses.map(l => l.name)]
      setLens(order[(order.indexOf(renderer.lens?.name ?? 'structure') + 1) % order.length])
    }
    if (k === 'tab') {
      e.preventDefault()
      const cur = subject()
      const sibs = tree.children[Math.max(0, tree.parent[cur])]
      if (cur > 0 && sibs.length) {
        const next = sibs[(sibs.indexOf(cur) + (e.shiftKey ? sibs.length - 1 : 1)) % sibs.length]
        select(next); fly(next)
      }
    }
    if (k === 'enter' || k === 'f') { const cur = subject(); if (cur > 0) fly(cur) }
    if (k === 'escape' && renderer.selected > 0) { select(-1); return }
    if (k === 'escape' || k === 'backspace') {
      const path = renderer.breadcrumb()
      fly(path.length > 1 ? path[path.length - 2] : 0)
    }
  })
  window.addEventListener('keyup', e => held.delete(e.key.toLowerCase()))
  window.addEventListener('blur', () => held.clear())

  /** Held keys move the camera with a little acceleration, like a ship. */
  let thrust = 0
  const steer = (dt: number) => {
    const ax = (held.has('d') || held.has('arrowright') ? 1 : 0) - (held.has('a') || held.has('arrowleft') ? 1 : 0)
    const ay = (held.has('s') || held.has('arrowdown') ? 1 : 0) - (held.has('w') || held.has('arrowup') ? 1 : 0)
    const az = (held.has('e') || held.has('+') || held.has('=') ? 1 : 0) - (held.has('q') || held.has('-') ? 1 : 0)
    thrust = ax || ay || az ? Math.min(1, thrust + dt / 350) : 0
    const boost = held.has('shift') ? 2.5 : 1
    if (ax || ay) cam.panBy(-ax * 900 * boost * thrust * dt / 1000, -ay * 900 * boost * thrust * dt / 1000)
    if (az) cam.zoomAt(cam.w / 2, cam.h / 2, Math.exp(az * 1.8 * boost * thrust * dt / 1000))
  }

  // Frame loop: animations run every frame, so the scene always renders.
  const cpu = ring(240), delta = ring(240)
  let last = renderer.frame(now())
  const crumbs = $('crumbs'), stats = $('stats')
  let lastCrumb: string | null = null
  const tick = (dt: number) => {
    const start = performance.now()
    const t = now()
    steer(dt)
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
        b.onclick = () => fly(i)
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
      ready: true, tree, world, cam, renderer, layoutMs, loadMs: performance.now() - t0,
      gpu: dbg && gl ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      fit, fly, select, setLens, unhover: () => { renderer.pointer = null }, last: () => last, id: (s: string) => tree.byId.get(s) ?? -1,
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
