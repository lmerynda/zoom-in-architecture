import { Application, UPDATE_PRIORITY } from 'pixi.js'
import { Camera } from './camera'
import { layoutJobs, placeWorld, type World } from './layout'
import { runLayout } from './layoutPool'
import { Tree, type ModelJson } from './model'
import { Renderer } from './render'
import { synthetic } from './synthetic'
import { Minimap } from './minimap'
import { renderDetails } from './details'

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
  await app.init({ resizeTo: window, background: '#0b0f17', antialias: true, autoDensity: true, resolution: devicePixelRatio, preference: 'webgl' })
  $('stage').appendChild(app.canvas)
  Renderer.installFont()
  const cam = new Camera()
  const renderer = new Renderer(app, tree, world, cam)
  app.stage.addChild(renderer.stage)
  const minimap = new Minimap($<HTMLCanvasElement>('minimap'), tree, world)

  let dirty = true
  const fit = (i: number, dur = 750) => {
    const r = world.rect
    // With the details panel open, frame the target in the space left of it.
    const panel = document.getElementById('details')
    const cover = panel && !panel.hidden ? panel.getBoundingClientRect().width + 24 : 0
    const widen = cam.w / Math.max(1, cam.w - cover)
    cam.flyTo(r[i * 4], r[i * 4 + 1], r[i * 4 + 2] * widen, r[i * 4 + 3], performance.now(), i === 0 ? 0.92 : 0.85, dur)
    dirty = true
  }
  const resize = () => {
    cam.resize(app.screen.width, app.screen.height)
    renderer.hud = ['stats', 'minimap', 'help'].map(id => { const r = $(id).getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })
    dirty = true
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
    renderDetails(details, tree, renderer, renderer.selected, j => { select(j); fit(j, 900) })
    dirty = true
  }

  // Input: wheel zooms at the cursor, drag pans with inertia, double-click flies into a card.
  const canvas = app.canvas
  canvas.addEventListener('wheel', e => {
    e.preventDefault()
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    cam.zoomAt(e.offsetX, e.offsetY, Math.exp(-d * 0.0022))
    dirty = true
  }, { passive: false })
  let drag: { x: number; y: number; t: number; vx: number; vy: number; moved: number } | null = null
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId)
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: 0 }
  })
  canvas.addEventListener('pointermove', e => {
    renderer.pointer = [e.offsetX, e.offsetY]
    dirty = true
    if (!drag) return
    const now = performance.now(), dt = Math.max(1, now - drag.t)
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    drag.moved += Math.abs(dx) + Math.abs(dy)
    cam.panBy(dx, dy)
    drag.vx = drag.vx * 0.6 + (dx / dt) * 0.4
    drag.vy = drag.vy * 0.6 + (dy / dt) * 0.4
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now
  })
  canvas.addEventListener('pointerup', e => {
    if (drag && drag.moved < 5) {
      const hit = renderer.pick(e.offsetX, e.offsetY)
      select(hit === renderer.selected ? -1 : hit)
    } else if (drag && performance.now() - drag.t < 80) cam.release(drag.vx, drag.vy)
    drag = null
  })
  canvas.addEventListener('pointerleave', () => { renderer.pointer = null; dirty = true })
  canvas.addEventListener('dblclick', e => fit(renderer.pick(e.offsetX, e.offsetY)))
  minimap.onPick = (wx, wy) => { cam.flyTo(wx - cam.w / cam.z / 2, wy - cam.h / cam.z / 2, cam.w / cam.z, cam.h / cam.z, performance.now(), 1); dirty = true }

  const search = $<HTMLInputElement>('search')
  window.addEventListener('keydown', e => {
    if (e.target === search) {
      if (e.key === 'Enter') {
        const q = search.value.trim().toLowerCase()
        const hit = tree.els.findIndex((el, i) => i > 0 && el.title.toLowerCase().includes(q))
        if (hit > 0) { select(hit); fit(hit, 1100) }
        search.blur()
      }
      if (e.key === 'Escape') search.blur()
      return
    }
    if (e.key === '/') { e.preventDefault(); search.focus(); search.select() }
    if (e.key === 'Home' || e.key === '0') fit(0)
    if (e.key === 'Escape' && renderer.selected > 0) { select(-1); return }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      const path = renderer.breadcrumb()
      fit(path.length > 1 ? path[path.length - 2] : 0)
    }
  })

  // Frame loop with timing: our scene update runs first, the stats probe after Pixi has rendered.
  const cpu = ring(240), delta = ring(240)
  let frameStart = 0, last = renderer.frame()
  app.ticker.add(t => {
    frameStart = performance.now()
    if (cam.step(frameStart, t.deltaMS) || dirty) { last = renderer.frame(); dirty = false }
  }, null, UPDATE_PRIORITY.HIGH)
  app.ticker.add(t => { push(cpu, performance.now() - frameStart); push(delta, t.deltaMS) }, null, UPDATE_PRIORITY.UTILITY)

  const crumbs = $('crumbs'), stats = $('stats')
  let lastCrumb = ''
  setInterval(() => {
    const path = renderer.breadcrumb()
    const key = path.join('/')
    if (key !== lastCrumb) {
      lastCrumb = key
      crumbs.replaceChildren(...[0, ...path].map((i, k) => {
        const b = document.createElement('button')
        b.textContent = tree.els[i].title
        b.onclick = () => fit(i)
        if (k === path.length) b.className = 'here'
        return b
      }))
    }
    const d = values(delta), c = values(cpu)
    stats.textContent = [
      `${tree.size - 1} elements · ${tree.rels.length / 2} relations · layout ${layoutMs.toFixed(0)} ms`,
      `fps ${(1000 / (d.reduce((a, b) => a + b, 0) / (d.length || 1))).toFixed(0)} · frame p50 ${pct(c, 0.5).toFixed(1)} ms · p95 ${pct(c, 0.95).toFixed(1)} ms`,
      `drawn ${last.nodes} cards · ${last.texts} labels · ${last.edges} edges · ${last.chips} off-screen`,
      `zoom ×${(cam.z / (cam.w * 0.92 / world.rect[2])).toExponential(1)}`,
    ].join('\n')
    minimap.draw(cam)
  }, 250)

  const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info')
  Object.assign(window, {
    __spike: {
      ready: true, tree, world, cam, renderer, layoutMs, loadMs: performance.now() - t0,
      gpu: dbg && gl ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      fit, select, unhover: () => { renderer.pointer = null; dirty = true }, last: () => last, id: (s: string) => tree.byId.get(s) ?? -1,
      frames: () => ({ cpu: values(cpu), delta: values(delta) }),
      resetFrames: () => { cpu.k = delta.k = 0; cpu.full = delta.full = false },
    },
  })
}

main().catch(e => {
  $('stats').textContent = String(e?.stack ?? e)
  console.error(e)
})
