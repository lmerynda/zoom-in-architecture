import type { Application } from 'pixi.js'
import type { Camera } from '../camera'
import type { World } from '../layout'
import type { Lens, LensName } from '../lens'
import type { Minimap } from '../minimap'
import type { Tree } from '../model'
import type { Renderer } from '../render'
import type { Sound } from '../sound'
import { findRoute, History, type View } from './logic'
import { askNote, BookmarkBar, Help, Palette, Radial, RoutePanel, Toast, Tooltips, type Command } from './ui'

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
  now: () => number
}

/**
 * Game-style controls. Every way of moving or acting is here: mouse, keyboard, command wheel,
 * palette, control groups, history, target cycling, routes, pins and tooltips.
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
  const bookmarks = new BookmarkBar(`zoom:bookmarks:${c.model}`)
  const pinKey = `zoom:pins:${c.model}`
  const loadPins = () => { try { renderer.pins = (JSON.parse(localStorage.getItem(pinKey) ?? '[]') as { id: string; note: string }[]).map(p => ({ node: tree.byId.get(p.id) ?? -1, note: p.note })).filter(p => p.node > 0) } catch { /* none */ } }
  loadPins()
  const savePins = () => { try { localStorage.setItem(pinKey, JSON.stringify(renderer.pins.map(p => ({ id: tree.els[p.node].id, note: p.note })))) } catch { /* private mode */ } }

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
    toast.show(`${dir === 'out' ? 'Calls' : 'Called by'} ${cycle.k + 1}/${list.length} · ${tree.els[n].title} — ${title}`, 'Enter walks there')
  }
  const clearTarget = () => { renderer.target = -1; cycle = null }

  // --- Routes: pick a destination, then step along waypoints.
  let picking = false
  const showRoute = () => routePanel.show(renderer.route, renderer.routeStep)
  const routeTo = (from: number, to: number) => {
    const hops = findRoute(tree, from, to)
    if (!hops) return toast.show(`No path from ${tree.els[from].title} to ${tree.els[to].title}`)
    renderer.route = hops
    renderer.routeStep = -1
    clearTarget()
    showRoute()
    frame([hops[0].from, ...hops.map(h => h.to)])
    toast.show(`Route: ${hops.length} hop${hops.length === 1 ? '' : 's'}${hops.some(h => h.reversed) ? ' (some against the arrows)' : ''}`, 'N next waypoint')
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
  const startPicking = () => {
    if (subject() <= 0) return toast.show('Select a start first')
    if (renderer.selected <= 0) c.select(subject())
    picking = true
    document.body.classList.add('picking')
    toast.show(`Route from ${tree.els[renderer.selected].title}: click the destination`, 'Esc cancels')
  }
  const stopPicking = () => { picking = false; document.body.classList.remove('picking') }

  // --- Pins.
  const togglePin = (n: number, withNote = false, at?: [number, number]) => {
    if (n <= 0) return
    const existing = renderer.pins.findIndex(p => p.node === n)
    if (existing >= 0 && !withNote) { renderer.pins.splice(existing, 1); savePins(); return toast.show(`Unpinned ${tree.els[n].title}`) }
    const add = (note: string) => {
      if (existing >= 0) renderer.pins[existing].note = note
      else renderer.pins.push({ node: n, note })
      savePins()
      sound.blip(980, 0.06)
      toast.show(`Pinned ${tree.els[n].title}`, 'P again to unpin')
    }
    if (withNote) {
      const [x, y] = at ?? [cam.w / 2, cam.h / 2]
      askNote(x, y, existing >= 0 ? renderer.pins[existing].note : '', note => note !== null && add(note))
    } else add('')
  }

  // --- Control groups.
  let lastRecall = { slot: -1, at: 0 }
  const saveSlot = (k: number) => {
    const n = subject()
    bookmarks.save(k, { ...view(), title: n > 0 ? tree.els[n].title : 'Landscape' })
    toast.show(`Saved view ${k + 1}: ${n > 0 ? tree.els[n].title : 'Landscape'}`, `${k + 1} to return`)
  }
  const recallSlot = (k: number) => {
    const b = bookmarks.slots[k]
    if (!b) return toast.show(`Slot ${k + 1} is empty`, `Ctrl+${k + 1} saves`)
    history.push(view(), cam.w)
    goView(b)
    bookmarks.flash(k)
    lastRecall = { slot: k, at: performance.now() }
  }
  bookmarks.onRecall = recallSlot

  // --- Palette.
  const commands = (): Command[] => [
    ...['structure', ...c.lenses.map(l => l.name)].map(name => ({ name: `Lens: ${name[0].toUpperCase()}${name.slice(1)}`, hint: 'L cycles', run: () => c.setLens(name as LensName) })),
    { name: 'Whole map', hint: '0', run: () => go(0) },
    { name: 'Back', hint: 'Backspace', run: back },
    { name: 'Clear route', hint: 'Esc', run: clearRoute },
    { name: 'Route from selection…', hint: 'R', run: startPicking },
    { name: 'Toggle sound', hint: 'M', run: () => c.sound.toggle() },
    { name: 'Controls', hint: '?', run: () => help.toggle(true) },
    ...renderer.pins.map(p => ({ name: `Pin: ${p.note || tree.els[p.node].title}`, hint: 'jump', run: () => go(p.node) })),
    ...bookmarks.slots.flatMap((b, k) => (b ? [{ name: `Slot ${k + 1}: ${b.title}`, hint: String(k + 1), run: () => recallSlot(k) }] : [])),
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
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    cam.zoomAt(e.offsetX, e.offsetY, Math.exp(-d * 0.0022))
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
      if (picking) { stopPicking(); if (hit > 0 && renderer.selected > 0) routeTo(renderer.selected, hit) }
      else { clearTarget(); c.select(hit === renderer.selected ? -1 : hit) }
    } else if (performance.now() - drag.t < 80) cam.release(drag.vx, drag.vy)
    drag = null
  })
  canvas.addEventListener('pointerleave', () => { renderer.pointer = null })
  canvas.addEventListener('dblclick', e => go(renderer.pick(e.offsetX, e.offsetY)))
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault()
    tooltips.closeAll()
    const n = renderer.pick(e.offsetX, e.offsetY)
    if (n <= 0) return radial.open(e.clientX, e.clientY, 'Map', [
      { label: 'Whole map', key: '0', run: () => go(0) },
      { label: 'Back', key: '⌫', run: back },
      { label: 'Travel to…', key: 'Ctrl K', run: () => palette.open() },
      { label: 'Controls', key: '?', run: () => help.toggle(true) },
    ])
    const sel = renderer.selected
    const pinned = renderer.pins.some(p => p.node === n)
    radial.open(e.clientX, e.clientY, tree.els[n].title, [
      { label: 'Fly in', key: 'F', run: () => go(n) },
      { label: sel === n ? 'Deselect' : 'Select', key: 'Click', run: () => c.select(sel === n ? -1 : n) },
      { label: 'Calls…', key: ']', run: () => { c.select(n); cycleTarget('out', 1) } },
      { label: 'Route here', key: 'R', disabled: sel <= 0 || sel === n, run: () => routeTo(sel, n) },
      { label: 'Called by…', key: '[', run: () => { c.select(n); cycleTarget('in', 1) } },
      { label: pinned ? 'Unpin' : 'Pin', key: 'P', run: () => togglePin(n) },
      { label: 'Pin with note', key: '⇧P', run: () => togglePin(n, true, [e.clientX, e.clientY]) },
      { label: 'Save view', key: 'Ctrl 1–9', run: () => saveSlot(Math.max(0, bookmarks.slots.indexOf(null))) },
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
    if (/^[1-9]$/.test(e.key) || (e.ctrlKey && /^Digit[1-9]$/.test(e.code))) {
      const slot = Number(e.code.replace('Digit', '') || e.key) - 1
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) return saveSlot(slot)
      // Double tap, like an RTS control group: also selects what the view was about.
      const again = bookmarks.slots[slot]
      if (lastRecall.slot === slot && performance.now() - lastRecall.at < 400 && again?.selected) c.select(tree.byId.get(again.selected) ?? -1)
      return recallSlot(slot)
    }
    if (k === '?') return help.toggle()
    if (k === 'backspace' || (e.altKey && k === 'arrowleft')) { e.preventDefault(); return back() }
    if (e.altKey && k === 'arrowright') { e.preventDefault(); return forward() }
    if (k === 'home' || k === '0') return go(0)
    if (k === 'm') { const on = sound.toggle(); toast.show(on ? 'Sound on' : 'Sound off', 'M'); return document.getElementById('sound')?.classList.toggle('on', on) }
    if (k === 'l') {
      const order: LensName[] = ['structure', ...c.lenses.map(l => l.name)]
      const next = order[(order.indexOf(renderer.lens?.name ?? 'structure') + 1) % order.length]
      c.setLens(next)
      return toast.show(`Lens: ${next}`, 'L next')
    }
    if (k === ']') return cycleTarget('out', e.shiftKey ? -1 : 1)
    if (k === '[') return cycleTarget('in', e.shiftKey ? -1 : 1)
    if (k === 'r' && !e.ctrlKey) return startPicking()
    if (k === 'n' && renderer.route) return stepRoute(renderer.routeStep + 1)
    if (k === 'p' && renderer.route && !e.shiftKey) return stepRoute(renderer.routeStep - 1)
    if (k === 'p') return togglePin(renderer.hover > 0 ? renderer.hover : subject(), e.shiftKey, renderer.pointer ?? undefined)
    if (k === 'tab') {
      e.preventDefault()
      const cur = subject()
      const sibs = tree.children[Math.max(0, tree.parent[cur])]
      if (cur > 0 && sibs.length) {
        const next = sibs[(sibs.indexOf(cur) + (e.shiftKey ? sibs.length - 1 : 1)) % sibs.length]
        clearTarget(); goSelect(next)
      }
      return
    }
    if (k === 'enter') {
      if (renderer.target > 0) { const t = renderer.target; clearTarget(); goSelect(t); return toast.show(`Walked to ${tree.els[t].title}`, '] [ to look around') }
      const cur = subject(); if (cur > 0) go(cur)
      return
    }
    if (k === 'f') { const cur = subject(); if (cur > 0) go(cur); return }
    if (k === 'escape') {
      // One layer at a time, outermost first.
      if (radial.isOpen) return radial.close()
      if (help.isOpen) return help.toggle(false)
      if (picking) return stopPicking()
      if (renderer.target > 0) return clearTarget()
      if (renderer.route) return clearRoute()
      if (renderer.selected > 0) return c.select(-1)
      const path = renderer.breadcrumb()
      return go(path.length > 1 ? path[path.length - 2] : 0)
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

  return {
    /** Per frame: steering and tooltips. */
    tick(dt: number, now: number) {
      steer(dt)
      const p = renderer.pointer
      tooltips.update(p ? renderer.hover : -1, p ? p[0] : 0, p ? p[1] : 0, now, !!drag || radial.isOpen || palette.isOpen || cam.flying || picking)
    },
    go, back, forward, routeTo, stepRoute, cycleTarget, togglePin, saveSlot, recallSlot, palette, radial, help, toast,
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
