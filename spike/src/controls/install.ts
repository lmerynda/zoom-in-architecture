import type { Application } from 'pixi.js'
import type { Camera } from '../camera'
import type { World } from '../layout'
import type { Lens, LensName } from '../lens'
import type { Minimap } from '../minimap'
import type { Tree } from '../model'
import type { Renderer } from '../render'
import type { Sound } from '../sound'
import { findRoute, History, type View } from './logic'
import { Help, Palette, Radial, RoutePanel, Toast, Tooltips, type Command } from './ui'

export interface Ctx {
  app: Application
  tree: Tree
  world: World
  cam: Camera
  renderer: Renderer
  minimap: Minimap
  sound: Sound
  lenses: Lens[]
  model: string
  setLens: (name: LensName) => void
  select: (i: number) => void
  /** Flight to an element, framing it (no history; use `go`). */
  fit: (i: number) => void
  /** How far the wheel may zoom in at a screen point: past it, what is under the cursor has nothing more to show. */
  zoomLimit: (sx: number, sy: number) => number
  zoomFloor: () => number
  /** Opens a file's code at its first line, at a size that reads. */
  read: (path: string) => void
  now: () => number
}

/**
 * Game-style controls, kept to a few: the mouse and the command wheel, the palette, back, target
 * cycling and Esc. Routes and pins live behind the wheel and the palette rather than on keys.
 */
export function installControls(c: Ctx) {
  const { cam, sound } = c
  // The model can be swapped live; every closure below reads these, and swap() reassigns them.
  let tree = c.tree, world = c.world, renderer = c.renderer
  const toast = new Toast()
  const history = new History()
  const help = new Help()
  const radial = new Radial()
  const routePanel = new RoutePanel(tree)
  const pinKey = `zoom:pins:${c.model}`
  const loadPins = () => { try { renderer.pins = (JSON.parse(localStorage.getItem(pinKey) ?? '[]') as string[]).map(id => tree.byId.get(id) ?? -1).filter(n => n > 0) } catch { /* none */ } }
  loadPins()
  const savePins = () => { try { localStorage.setItem(pinKey, JSON.stringify(renderer.pins.map(n => tree.els[n].id))) } catch { /* private mode */ } }

  const view = (): View => ({ x: cam.x, y: cam.y, z: cam.z, selected: renderer.selected > 0 ? tree.els[renderer.selected].id : null })
  /** Every jump records where you were, so Backspace brings you back. */
  const go = (i: number) => {
    history.push(view(), cam.w)
    c.fit(i)
    sound.whoosh(cam.flightMs / 1000)
  }
  /** Jump that also selects the destination; the view left behind keeps its own selection. */
  const goSelect = (i: number) => {
    history.push(view(), cam.w)
    c.select(i)
    c.fit(i)
    sound.whoosh(cam.flightMs / 1000)
  }
  const goView = (v: View) => {
    cam.flyTo(v.x - cam.w / v.z / 2, v.y - cam.h / v.z / 2, cam.w / v.z, cam.h / v.z, c.now(), 1)
    sound.whoosh(cam.flightMs / 1000)
    c.select(v.selected ? tree.byId.get(v.selected) ?? -1 : -1)
  }
  const back = () => { const v = history.goBack(view()); if (v) { goView(v); toast.show('Back', 'Alt+→ forward') } else toast.show('No earlier place') }
  const forward = () => { const v = history.goForward(view()); if (v) goView(v) }
  /** Frames several elements at once. */
  const frame = (nodes: number[]) => {
    const r = world.rect
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const n of nodes) { x0 = Math.min(x0, r[n * 4]); y0 = Math.min(y0, r[n * 4 + 1]); x1 = Math.max(x1, r[n * 4] + r[n * 4 + 2]); y1 = Math.max(y1, r[n * 4 + 1] + r[n * 4 + 3]) }
    cam.flyTo(x0, y0, x1 - x0, y1 - y0, c.now(), 0.7)
  }
  /** The element commands act on: the selection, else what is under the screen centre. */
  const subject = () => (renderer.selected > 0 ? renderer.selected : renderer.pick(cam.w / 2, cam.h / 2))

  // --- Target cycling: inspect a neighbour without losing the selection.
  let cycle: { dir: 'out' | 'in'; list: number[]; k: number } | null = null
  const neighbours = (i: number, dir: 'out' | 'in') => {
    const rel = renderer.relationsOf(i)
    return [...new Map((dir === 'out' ? rel.out : rel.inn).map(r => [r.other, r.title])).entries()]
  }
  const cycleTarget = (dir: 'out' | 'in', step: number) => {
    const sel = subject()
    if (sel <= 0) return toast.show('Select something first')
    if (renderer.selected !== sel) c.select(sel)
    const list = neighbours(sel, dir)
    if (!list.length) return toast.show(dir === 'out' ? 'It calls nothing' : 'Nothing calls it')
    cycle = cycle && cycle.dir === dir && cycle.list.length === list.length ? cycle : { dir, list: list.map(([n]) => n), k: -1 }
    cycle.k = (cycle.k + step + list.length) % list.length
    const [n, title] = list[cycle.k]
    renderer.target = n
    frame([sel, n])
    sound.blip(dir === 'out' ? 740 : 520, 0.05)
    // A relation named after what it reaches (an import of KingdomTurnReport) says nothing twice.
    const name = tree.els[n].title
    toast.show(`${dir === 'out' ? 'Calls' : 'Called by'} ${cycle.k + 1}/${list.length} · ${name}${title && title !== name ? ` — ${title}` : ''}`, 'Enter walks there')
  }
  const clearTarget = () => { renderer.target = -1; cycle = null }

  // --- Routes: pick a destination, then step along waypoints.
  const showRoute = () => routePanel.show(renderer.route, renderer.routeStep)
  const routeTo = (from: number, to: number) => {
    const hops = findRoute(tree, from, to)
    if (!hops) return toast.show(`No path from ${tree.els[from].title} to ${tree.els[to].title}`)
    renderer.route = hops
    renderer.routeStep = -1
    clearTarget()
    showRoute()
    frame([hops[0].from, ...hops.map(h => h.to)])
    toast.show(`Route: ${hops.length} hop${hops.length === 1 ? '' : 's'}${hops.some(h => h.reversed) ? ' (some against the arrows)' : ''}`, 'click a stop to go there')
  }
  const stepRoute = (k: number) => {
    const r = renderer.route
    if (!r) return
    const stops = [r[0].from, ...r.map(h => h.to)]
    renderer.routeStep = Math.max(0, Math.min(stops.length - 1, k))
    showRoute()
    go(stops[renderer.routeStep])
  }
  routePanel.onStep = stepRoute
  const clearRoute = () => { renderer.route = null; renderer.routeStep = -1; showRoute() }
  // --- Pins.
  const togglePin = (n: number) => {
    if (n <= 0) return
    const existing = renderer.pins.indexOf(n)
    if (existing >= 0) renderer.pins.splice(existing, 1)
    else { renderer.pins.push(n); sound.blip(980, 0.06) }
    savePins()
    if (existing >= 0) toast.show(`Unpinned ${tree.els[n].title}`)
    else toast.show(`Pinned ${tree.els[n].title}`, 'Ctrl+K finds it again')
  }

  // --- Palette.
  const commands = (): Command[] => [
    ...renderer.pins.map(n => ({ name: `Pin: ${tree.els[n].title}`, hint: 'jump', run: () => go(n) })),
    ...['structure', ...c.lenses.map(l => l.name)].map(name => ({ name: `Lens: ${name[0].toUpperCase()}${name.slice(1)}`, run: () => c.setLens(name as LensName) })),
    { name: 'Whole map', run: () => go(0) },
    { name: 'Back', hint: 'Backspace', run: back },
    { name: 'Clear route', hint: 'Esc', run: clearRoute },
    { name: 'Toggle sound', run: () => { sound.toggle() } },
    { name: 'Toggle frame stats', run: () => { const e = document.getElementById('stats'); if (e) e.hidden = !e.hidden } },
    { name: 'Controls', hint: '?', run: () => help.toggle(true) },
  ]
  const palette = new Palette(tree, commands, (i, shift) => {
    if (shift && renderer.selected > 0) return routeTo(renderer.selected, i)
    goSelect(i)
  })

  document.getElementById('travel')?.addEventListener('click', () => palette.open())
  const tooltips = new Tooltips(tree, i => renderer.relationsOf(i), goSelect, c.now)

  // --- Mouse.
  const canvas = c.app.canvas
  canvas.addEventListener('wheel', e => {
    e.preventDefault()
    radial.close()
    // A tooltip is about the card under a still cursor; zooming moves on from it.
    tooltips.closeAll()
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    cam.zoomAt(e.offsetX, e.offsetY, Math.exp(-d * 0.0022), c.zoomLimit(e.offsetX, e.offsetY), c.zoomFloor())
  }, { passive: false })
  let drag: { x: number; y: number; t: number; vx: number; vy: number; moved: number } | null = null
  let rightHold: { x: number; y: number; t: number } | null = null
  canvas.addEventListener('pointerdown', e => {
    if (e.button === 3) { e.preventDefault(); return back() }
    if (e.button === 4) { e.preventDefault(); return forward() }
    if (e.button === 2) { rightHold = { x: e.clientX, y: e.clientY, t: performance.now() }; return }
    if (e.button !== 0) return
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
  window.addEventListener('pointerup', e => {
    if (e.button === 2 && rightHold && radial.isOpen && performance.now() - rightHold.t > 250) radial.release(e.clientX, e.clientY)
    if (e.button === 2) rightHold = null
    if (e.button !== 0 || !drag) return
    if (drag.moved < 5) {
      const hit = renderer.pick(e.offsetX, e.offsetY)
      clearTarget()
      // Clicking the selection keeps it (it is usually what travel just brought you to); Esc or empty space clears.
      // The details panel now says what the tooltip said; it goes.
      tooltips.closeAll()
      c.select(hit)
    } else if (performance.now() - drag.t < 80) cam.release(drag.vx, drag.vy)
    drag = null
  })
  canvas.addEventListener('pointerleave', () => { renderer.pointer = null })
  // Double-click flies into a card; into a file, straight to its code at a size that reads.
  canvas.addEventListener('dblclick', e => {
    const n = renderer.pick(e.offsetX, e.offsetY)
    const path = n > 0 && !tree.children[n].length ? tree.els[n].metadata?.path : undefined
    if (path) c.read(path)
    else go(n)
  })
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault()
    tooltips.closeAll()
    const n = renderer.pick(e.offsetX, e.offsetY)
    if (n <= 0) return radial.open(e.clientX, e.clientY, 'Map', [
      { label: 'Whole map', run: () => go(0) },
      { label: 'Back', key: '⌫', run: back },
      { label: 'Travel to…', key: 'Ctrl K', run: () => palette.open() },
      { label: 'Controls', key: '?', run: () => help.toggle(true) },
    ])
    const sel = renderer.selected
    const pinned = renderer.pins.includes(n)
    radial.open(e.clientX, e.clientY, tree.els[n].title, [
      { label: 'Fly in', key: '2× click', run: () => go(n) },
      { label: sel === n ? 'Deselect' : 'Select', key: 'Click', run: () => c.select(sel === n ? -1 : n) },
      { label: 'Calls…', key: ']', run: () => { c.select(n); cycleTarget('out', 1) } },
      { label: 'Route here', disabled: sel <= 0 || sel === n, run: () => routeTo(sel, n) },
      { label: 'Called by…', key: '[', run: () => { c.select(n); cycleTarget('in', 1) } },
      { label: pinned ? 'Unpin' : 'Pin', run: () => togglePin(n) },
    ])
  })
  c.minimap.onPick = (wx, wy) => { history.push(view(), cam.w); cam.flyTo(wx - cam.w / cam.z / 2, wy - cam.h / cam.z / 2, cam.w / cam.z, cam.h / cam.z, c.now(), 1) }
  c.minimap.onDrag = (wx, wy) => cam.set(wx, wy, cam.z)

  // --- Keyboard.
  const held = new Set<string>()
  const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement
  window.addEventListener('keydown', e => {
    if (typing(e)) return
    const k = e.key.toLowerCase()
    held.add(k)
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); return palette.open() }
    if (k === '/') { e.preventDefault(); return palette.open() }
    if (k === '?') return help.toggle()
    if (k === 'backspace' || (e.altKey && k === 'arrowleft')) { e.preventDefault(); return back() }
    if (e.altKey && k === 'arrowright') { e.preventDefault(); return forward() }
    if (k === ']') return cycleTarget('out', e.shiftKey ? -1 : 1)
    if (k === '[') return cycleTarget('in', e.shiftKey ? -1 : 1)
    if (k === 'enter') {
      if (renderer.target > 0) { const t = renderer.target; clearTarget(); goSelect(t); return toast.show(`Walked to ${tree.els[t].title}`, '] [ to look around') }
      const cur = subject(); if (cur > 0) go(cur)
      return
    }
    if (k === 'escape') {
      // One layer at a time, outermost first.
      if (radial.isOpen) return radial.close()
      if (help.isOpen) return help.toggle(false)
      if (renderer.target > 0) return clearTarget()
      if (renderer.route) return clearRoute()
      if (renderer.selected > 0) return c.select(-1)
      const path = renderer.breadcrumb()
      return go(path.length > 1 ? path[path.length - 2] : 0)
    }
  })
  window.addEventListener('keyup', e => held.delete(e.key.toLowerCase()))
  window.addEventListener('blur', () => held.clear())

  /** Held arrow keys move the camera with a little acceleration, like a ship; + and - zoom. */
  let thrust = 0
  const steer = (dt: number) => {
    const ax = (held.has('arrowright') ? 1 : 0) - (held.has('arrowleft') ? 1 : 0)
    const ay = (held.has('arrowdown') ? 1 : 0) - (held.has('arrowup') ? 1 : 0)
    const az = (held.has('+') || held.has('=') ? 1 : 0) - (held.has('-') ? 1 : 0)
    thrust = ax || ay || az ? Math.min(1, thrust + dt / 350) : 0
    if (ax || ay) cam.panBy(-ax * 900 * thrust * dt / 1000, -ay * 900 * thrust * dt / 1000)
    if (az) cam.zoomAt(cam.w / 2, cam.h / 2, Math.exp(az * 1.8 * thrust * dt / 1000), c.zoomLimit(cam.w / 2, cam.h / 2), c.zoomFloor())
  }

  return {
    /** Per frame: steering and tooltips. */
    tick(dt: number, now: number) {
      steer(dt)
      const p = renderer.pointer
      // A tooltip sums a card up from outside; once you are inside one (it fills most of the screen) it only covers it.
      const inside = renderer.hover > 0 && world.rect[renderer.hover * 4 + 2] * cam.z > cam.w * 0.8
      // The selected card has the details panel; a tooltip on it would only repeat it.
      const selected = renderer.hover > 0 && renderer.hover === renderer.selected
      tooltips.update(p ? renderer.hover : -1, p ? p[0] : 0, p ? p[1] : 0, now, !!drag || radial.isOpen || palette.isOpen || cam.flying || inside || selected)
    },
    go, back, forward, routeTo, stepRoute, cycleTarget, togglePin, palette, radial, help, toast,
    /** Flies to a view (a camera and a selection), recording where you were so Backspace returns. */
    visit(v: View) { history.push(view(), cam.w); goView(v) },
    /** Points every control at a new model version; the caller carries selection, route and target over. */
    swap(next: { tree: typeof tree; world: typeof world; renderer: typeof renderer }) {
      tree = next.tree; world = next.world; renderer = next.renderer
      palette.tree = tree; tooltips.tree = tree; routePanel.tree = tree
      tooltips.closeAll()
      loadPins()
      cycle = null
      routePanel.show(renderer.route, renderer.routeStep)
    },
  }
}
