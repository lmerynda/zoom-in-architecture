import type { Application } from 'pixi.js'
import type { Camera } from '../camera'
import { importance, rankKey, ranks, type World } from '../layout'
import type { Lens, LensName } from '../lens'
import type { Minimap } from '../minimap'
import type { Tree } from '../model'
import type { PanelRows } from '../details'
import { endpointOf, type Api, type ApiFilter } from '../endpoints'
import type { Renderer } from '../render'
import type { Places } from '../places'
import { same, type View } from './logic'
import { Help, Menu, Palette, Toast, Tooltip, type Command } from './ui'

export interface Ctx {
  app: Application
  tree: Tree
  world: World
  cam: Camera
  renderer: Renderer
  minimap: Minimap
  lenses: Lens[]
  /** Laid out by coupling: `.` and `,` walk a level by rank there. */
  coupling: boolean
  setLens: (name: LensName) => void
  select: (i: number) => void
  /** Flight to an element, framing it (no history; use `go`). */
  fit: (i: number) => void
  /** How far the wheel may zoom in at a screen point: past it, what is under the cursor has nothing more to show. */
  zoomLimit: (sx: number, sy: number) => number
  zoomFloor: () => number
  /** Opens element i's code where it starts, at a size that reads. */
  read: (i: number) => void
  /** The details panel's rows, in the order shown: ] and [ walk them. */
  rows: () => PanelRows
  /** The browser's history of places: Back, Forward and the address. */
  places: Places
  /** Picks a line for the details panel, or puts it down (null). */
  pickEdge: (l: { s: number; t: number } | { s: number; t: number }[] | null) => void
  /** An arrow, or the list of arrows on a trunk, is in the panel. */
  edgeOpen: () => boolean
  /** With nothing selected, ] and [ step through the map's problems (problems.ts), 0 opens the first; false when it has none. */
  stepProblem: (dir: 1 | -1 | 0) => boolean
  /** Moves keyboard focus to the panel's heading. */
  focusPanel: () => void
  /** Closes the top layer the page holds over the map (the code reader); false when there is none. */
  closeTop: () => boolean
  now: () => number
  /** The map's endpoints, once known; null when it has no Requests model. */
  api: () => Api | null
  /** The open view is Requests, where endpoints are cards. */
  requests: boolean
  /** Opens an endpoint by its Requests id (across to Requests from another view). */
  endpoint: (id: string) => void
  /** Lists the endpoints in the panel. */
  list: (f: ApiFilter) => void
  /** Shows a feature in the panel: its pages, endpoints and data; false when the map has nothing for it. */
  showFeature: (name: string) => boolean
}

/** Keys typed into a field, or into a dialog over the map, are not map shortcuts. */
const notForMap = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  return !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable || !!t.closest?.('[role=dialog], [role=menu]'))
}

/**
 * The controls, kept to a few: the mouse, search, Back and Parent, stepping through a selection's
 * relations, and Esc. One action per key; everything else is in search.
 */
export function installControls(c: Ctx) {
  const { cam } = c
  // The model can be swapped live; every closure below reads these, and swap() reassigns them.
  let tree = c.tree, world = c.world, renderer = c.renderer
  const toast = new Toast()
  const help = new Help(c.coupling)
  const menu = new Menu()

  const view = (): View => {
    const path = renderer.breadcrumb(), here = path[path.length - 1] ?? 0
    return { x: cam.x, y: cam.y, z: cam.z, selected: renderer.selected > 0 ? tree.els[renderer.selected].id : null, here: here > 0 ? tree.els[here].id : null }
  }
  /**
   * Moving by hand (wheel, drag, arrow keys) is a trip too: where it started is recorded once the
   * view settles somewhere else, so Back returns from exploring as it does from a jump.
   */
  let excursion: { from: View; at: number } | null = null
  const moved = () => { const t = performance.now(); if (excursion) excursion.at = t; else excursion = { from: view(), at: t } }
  const settle = (force = false) => {
    if (!excursion || (!force && (drag || cam.flying || performance.now() - excursion.at < 600))) return
    const now = view()
    if (!same(excursion.from, now, cam.w)) c.places.record(excursion.from, now)
    excursion = null
  }
  /** Records the place being left: a pending trip's start first, then here. */
  const leave = () => { settle(true); c.places.record(view()) }
  /** Every jump records where you were, so Back brings you back. */
  const go = (i: number) => { leave(); c.fit(i) }
  /** Jump that also selects the destination; the view left behind keeps its own selection. */
  const goSelect = (i: number) => { leave(); c.select(i); c.fit(i); remember(i) }
  /** Into a container: framed open with nothing selected, so the panel outlines what is inside. */
  const enterPlace = (i: number) => { leave(); c.select(-1); c.fit(i); remember(i) }
  /** Cards visited, most recent first, for an empty search. Kept by id, so a live update keeps them. */
  let recent: string[] = []
  const remember = (i: number) => { if (i > 0) recent = [tree.els[i].id, ...recent.filter(id => id !== tree.els[i].id)].slice(0, 8) }
  /**
   * A feature: the cards that carry it are framed together, nothing selected, and the panel tells
   * the feature: its pages, its endpoints and what they touch, the parts that carry it.
   */
  const feature = (name: string) => {
    const cards = tree.els.flatMap((e, i) => (i > 0 && e.features?.includes(name) ? [i] : []))
    leave()
    c.select(-1)
    if (cards.length) frame(cards)
    if (!c.showFeature(name) && !cards.length) toast.show(`No card carries ${name}`)
  }
  const goView = (v: View) => {
    cam.flyTo(v.x - cam.w / v.z / 2, v.y - cam.h / v.z / 2, cam.w / v.z, cam.h / v.z, c.now(), 1)
    c.select(v.selected ? tree.byId.get(v.selected) ?? -1 : -1)
  }
  const back = () => { settle(true); if (!c.places.back()) toast.show('No earlier place') }
  const forward = () => c.places.forward()
  c.places.onGo = v => { excursion = null; goView(v) }
  /** Up one level from where you are: the parent of the selection, else of the place on screen. */
  const parent = () => {
    const path = renderer.breadcrumb(), here = path[path.length - 1] ?? 0
    const from = renderer.selected > 0 && !path.includes(renderer.selected) ? renderer.selected : here
    if (from <= 0) return toast.show('This is the whole map')
    const up = tree.parent[from]
    goSelect(up)
    if (up <= 0) c.select(-1)
  }
  /** Frames several elements at once. */
  const frame = (nodes: number[]) => {
    const r = world.rect
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const n of nodes) { x0 = Math.min(x0, r[n * 4]); y0 = Math.min(y0, r[n * 4 + 1]); x1 = Math.max(x1, r[n * 4] + r[n * 4 + 2]); y1 = Math.max(y1, r[n * 4 + 1] + r[n * 4 + 3]) }
    cam.flyTo(x0, y0, x1 - x0, y1 - y0, c.now(), 0.7)
  }
  /** Whether card n is wholly on screen, clear of the panels. */
  const inView = (n: number) => {
    const [x, y, w, h] = renderer.screenRectOf(n)
    const panel = document.getElementById('details')
    const right = panel && !panel.hidden ? panel.getBoundingClientRect().left : cam.w
    return x >= 0 && y >= 0 && x + w <= right && y + h <= cam.h
  }

  /**
   * Laid out by coupling: `.` selects the next card of the level by rank, `,` the one before, staying
   * at the level; the toast says why it ranks there. With nothing selected it starts at the #1.
   */
  let rankOf: { tree: Tree; rank: Int32Array; weight: Float64Array } | null = null
  const byImportance = (step: 1 | -1) => {
    if (!c.coupling) return toast.show('. and , step through a level by rank where a map is laid out by coupling')
    if (rankOf?.tree !== tree) rankOf = { tree, weight: importance(tree), rank: ranks(tree, rankKey(tree)) }
    const { rank, weight } = rankOf
    const sel = renderer.selected
    const path = renderer.breadcrumb(), here = path[path.length - 1] ?? 0
    const level = sel > 0 ? tree.parent[sel] : tree.children[here].length ? here : Math.max(0, tree.parent[here])
    const siblings = [...tree.children[level]].sort((a, b) => rank[a] - rank[b])
    if (!siblings.length) return
    const at = sel > 0 ? siblings.indexOf(sel) : -1
    const next = siblings[at < 0 ? 0 : (at + step + siblings.length) % siblings.length]
    leave()
    c.select(next)
    if (!inView(next)) frame([next])
    toast.show(`#${rank[next]} of ${siblings.length} · ${tree.els[next].title} · ${weight[next]} relation${weight[next] === 1 ? '' : 's'}`, '. next · , back')
  }

  // --- Stepping through the details panel's rows without losing the selection.
  let cycle: { dir: 'out' | 'in'; list: number[]; k: number } | null = null
  const cycleTarget = (dir: 'out' | 'in', step: number) => {
    const sel = renderer.selected
    if (sel <= 0) return toast.show('Select a card first: ] and [ step through what it uses and what uses it')
    const rows = c.rows(), list = dir === 'out' ? rows.uses : rows.usedBy
    if (!list.length) return toast.show(dir === 'out' ? `${tree.els[sel].title} uses nothing on this map` : `Nothing on this map uses ${tree.els[sel].title}`)
    cycle = cycle && cycle.dir === dir && cycle.list.join() === list.join() ? cycle : { dir, list, k: -1 }
    cycle.k = (cycle.k + step + list.length) % list.length
    const n = list[cycle.k]
    renderer.target = n
    rows.mark(dir === 'out' ? 'uses' : 'usedBy', cycle.k)
    // Both cards already in view: the camera stays, the panel row and the card light up.
    if (!inView(sel) || !inView(n)) frame([sel, n])
    toast.show(`${dir === 'out' ? 'Uses' : 'Used by'} ${cycle.k + 1}/${list.length} · ${tree.els[n].title}`, 'Enter goes there')
  }
  const clearTarget = () => { if (cycle) c.rows().mark(cycle.dir === 'out' ? 'uses' : 'usedBy', -1); renderer.target = -1; cycle = null }

  // --- Search.
  const commands = (): Command[] => [
    ...(c.api() ? [{ name: `Endpoints · ${c.api()!.endpoints.length}`, hint: 'every endpoint, by resource', run: () => { c.list({}); requestAnimationFrame(() => c.focusPanel()) } }] : []),
    ...['structure', ...c.lenses.map(l => l.name)].map(name => ({ name: `Colour by ${name === 'structure' ? 'structure' : name}`, run: () => c.setLens(name as LensName) })),
    { name: 'Whole map', run: () => enterPlace(0) },
    { name: 'Back', hint: 'Backspace', run: back },
    { name: 'Up to the parent', hint: 'Alt+↑', run: parent },
    { name: 'Controls', hint: '?', run: () => help.toggle(true) },
    { name: 'Problems: cycles, uses against the grain, heaviest couplings', hint: ']', run: () => { if (!c.stepProblem(0)) toast.show('No problems found on this map') } },
  ]
  // A container found by search is framed, to look into, and the selection put down, so the panel
  // and the address name what was found, not what was selected before (Back brings that back); a
  // leaf is selected, to read about.
  const palette = new Palette(tree, commands, {
    go: i => {
      if (tree.children[i].length && !endpointOf(tree.els[i])) return enterPlace(i)
      goSelect(i)
      // What was found is in the panel: keyboard focus starts there, on its heading.
      requestAnimationFrame(() => c.focusPanel())
    },
    feature: name => { feature(name); requestAnimationFrame(() => c.focusPanel()) },
    recent: () => recent.map(id => tree.byId.get(id) ?? -1),
    // Endpoints of the Requests model, searched from any other view: picking one crosses to it.
    endpoints: () => (c.requests ? null : c.api()?.endpoints ?? null),
    endpoint: c.endpoint,
    list: f => { c.list(f ?? {}); requestAnimationFrame(() => c.focusPanel()) },
    listSize: () => c.api()?.endpoints.length ?? 0,
  })
  document.getElementById('travel')?.addEventListener('click', () => palette.open())
  document.getElementById('help')?.addEventListener('click', () => help.toggle(true))
  const tooltip = new Tooltip(tree, i => { const r = renderer.relationsOf(i); return { uses: new Set(r.out.map(x => x.other)).size, usedBy: new Set(r.inn.map(x => x.other)).size } })

  // --- Mouse.
  const canvas = c.app.canvas
  canvas.addEventListener('wheel', e => {
    e.preventDefault()
    menu.close()
    tooltip.close()
    moved()
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    // Over a file that fills much of the screen the wheel goes faster: between there and readable
    // code there is nothing new to see, only the text growing.
    const n = renderer.pick(e.offsetX, e.offsetY)
    const intoCode = n > 0 && !tree.children[n].length && !!tree.els[n].metadata?.path && world.rect[n * 4 + 2] * cam.z > cam.w * 0.4
    const limit = c.zoomLimit(e.offsetX, e.offsetY)
    cam.zoomAt(e.offsetX, e.offsetY, Math.exp(-d * (intoCode && d < 0 ? 0.0038 : 0.0022)), limit, c.zoomFloor())
    // The wheel never stops without saying why: at a file, how to read it; in a gap, where to point.
    if (d < 0 && cam.z >= limit * 0.97 && performance.now() - stopSaid > 2500) {
      stopSaid = performance.now()
      const file = n > 0 && !tree.children[n].length && tree.els[n].metadata?.path
      toast.show(file ? `Press Enter or double-click to read ${tree.els[n].title}` : 'Nothing further here: point at a card to go into it', file ? 'Enter' : '')
      if (file && renderer.selected !== n) c.select(n)
    }
  }, { passive: false })
  let stopSaid = 0
  let drag: { x: number; y: number; t: number; vx: number; vy: number; moved: number } | null = null
  /**
   * Two fingers pinch: the map zooms by the change in their distance around their midpoint and
   * pans with it. A pinch never ends in a tap: lifting the fingers selects nothing.
   */
  const touches = new Map<number, { x: number; y: number }>()
  let pinch: { d: number; x: number; y: number } | null = null, pinched = false
  const at = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const pinchNow = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  const lift = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return
    if (touches.size < 2) pinch = null
    if (!touches.size) setTimeout(() => { pinched = false })
  }
  window.addEventListener('pointerup', lift, true)
  window.addEventListener('pointercancel', lift, true)
  canvas.addEventListener('pointerdown', e => {
    // Any press ends a flight where it is: the reader has taken over.
    cam.stop()
    canvas.focus({ preventScroll: true })
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, at(e))
      if (touches.size === 2) { pinch = pinchNow(); pinched = true; drag = null; tooltip.close(); return }
      if (touches.size > 2) return
    }
    if (e.button === 3) { e.preventDefault(); return back() }
    if (e.button === 4) { e.preventDefault(); return forward() }
    if (e.button !== 0) return
    canvas.setPointerCapture(e.pointerId)
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: 0 }
  })
  canvas.addEventListener('pointermove', e => {
    renderer.pointer = [e.offsetX, e.offsetY]
    if (touches.has(e.pointerId)) touches.set(e.pointerId, at(e))
    if (pinch && touches.size === 2) {
      const p = pinchNow()
      moved()
      cam.panBy(p.x - pinch.x, p.y - pinch.y)
      if (pinch.d > 8 && p.d > 8) cam.zoomAt(p.x, p.y, p.d / pinch.d, c.zoomLimit(p.x, p.y), c.zoomFloor())
      pinch = p
      return
    }
    if (!drag) return
    const t = performance.now(), dt = Math.max(1, t - drag.t)
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    drag.moved += Math.abs(dx) + Math.abs(dy)
    if (drag.moved >= 5) moved()
    cam.panBy(dx, dy)
    drag.vx = drag.vx * 0.6 + (dx / dt) * 0.4
    drag.vy = drag.vy * 0.6 + (dy / dt) * 0.4
    drag.x = e.clientX; drag.y = e.clientY; drag.t = t
  })
  window.addEventListener('pointerup', e => {
    if (e.button !== 0 || !drag) return
    if (pinched) { drag = null; return }
    if (drag.moved < 5) {
      clearTarget()
      tooltip.close()
      // Off the cards, on a line: the line is picked, to see what it carries and why.
      const lines = renderer.hoverAt(e.offsetX, e.offsetY) <= 0 ? renderer.linesAt(e.offsetX, e.offsetY) : []
      // On a shared trunk the panel lists every arrow there, as the tooltip did; one opens directly.
      if (lines.length) return void (c.pickEdge(lines), (drag = null))
      const hit = renderer.pick(e.offsetX, e.offsetY)
      c.select(hit)
      remember(hit)
    } else if (performance.now() - drag.t < 80) cam.release(drag.vx, drag.vy)
    drag = null
  })
  canvas.addEventListener('pointerleave', () => { renderer.pointer = null })
  /** Go into a card; a file opens its code. Double-click, Enter and the panel's buttons do the same. */
  const enter = (n: number) => {
    if (n > 0 && !tree.children[n].length && tree.els[n].metadata?.path) c.read(n)
    else if (n > 0 && tree.children[n].length) enterPlace(n)
    else go(n)
  }
  canvas.addEventListener('dblclick', e => enter(renderer.pick(e.offsetX, e.offsetY)))
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault()
    tooltip.close()
    // From the keyboard (the Menu key), at the selected card; from a pointer, at the card under it.
    const kbd = e.button !== 2 && renderer.selected > 0
    if (kbd) {
      const r = renderer.screenRectOf(renderer.selected), cr = canvas.getBoundingClientRect()
      e = new PointerEvent('contextmenu', { clientX: cr.left + Math.max(8, Math.min(cr.width - 8, r[0] + r[2] / 2)), clientY: cr.top + Math.max(8, Math.min(cr.height - 8, r[1] + Math.min(r[3] / 2, 40))) })
    }
    const n = kbd ? renderer.selected : renderer.pick(e.offsetX, e.offsetY)
    if (n <= 0) return menu.open(e.clientX, e.clientY, tree.els[0].title, [{ label: 'Whole map', run: () => enterPlace(0) }, { label: 'Back', key: '⌫', run: back }])
    c.select(n)
    const file = tree.els[n].metadata?.path
    menu.open(e.clientX, e.clientY, tree.els[n].title, [
      { label: file ? 'Read code' : 'Go in', key: 'Enter', run: () => enter(n) },
      ...(file ? [{ label: 'Copy path', run: () => void navigator.clipboard?.writeText(file).then(() => toast.show(`Copied ${file}`), () => {}) }] : []),
    ])
  })
  c.minimap.onPick = (wx, wy) => { leave(); cam.flyTo(wx - cam.w / cam.z / 2, wy - cam.h / cam.z / 2, cam.w / cam.z, cam.h / cam.z, c.now(), 1) }
  c.minimap.onDrag = (wx, wy) => cam.set(wx, wy, cam.z)

  // --- Keyboard.
  const held = new Set<string>()
  window.addEventListener('keydown', e => {
    if (notForMap(e) || help.isOpen) return
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); return palette.open() }
    if (e.ctrlKey || e.metaKey) return
    if (k === 'escape') {
      // One layer at a time: a menu, a stepped-to card, then the selection. Never a move.
      if (menu.isOpen) return menu.close()
      if (c.closeTop()) return
      if (renderer.target > 0) return clearTarget()
      if (c.edgeOpen()) return c.pickEdge(null)
      if (renderer.selected > 0) return c.select(-1)
      return
    }
    // The rest are map keys: they act only when focus is on the map, not on a button or the panel.
    const t = e.target as HTMLElement | null
    if (t && t !== document.body && t !== canvas && t.tagName !== 'HTML') {
      // A heading or text with focus (the panel's, after a pick) passes on the keys that open things.
      const control = t.closest('input, textarea, select, button, a, [contenteditable], [role="dialog"], [role="listbox"]')
      // ] and [ pass from the panel only to step problems (nothing selected): stepping a selection's
      // rows there would leave Enter, which the heading keeps, without its target. The Problems list's
      // and a note's buttons pass them too.
      const problems = (k === ']' || k === '[') && renderer.selected <= 0 && (!control || !!t.closest('.d-problems, .d-problem'))
      const opener = k === '/' || k === '?' || k === 'backspace' || (e.altKey && k.startsWith('arrow'))
      if (!problems && (control || !opener)) return
    }
    held.add(k)
    if (k === '/') { e.preventDefault(); return palette.open() }
    // Shift+F10, as the Menu key: the selected card's menu.
    if (e.shiftKey && k === 'f10' && renderer.selected > 0) { e.preventDefault(); return void canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0 })) }
    if (k === '?') return help.toggle(true)
    if (k === 'backspace' || (e.altKey && k === 'arrowleft')) { e.preventDefault(); return back() }
    if (e.altKey && k === 'arrowright') { e.preventDefault(); return forward() }
    if (e.altKey && k === 'arrowup') { e.preventDefault(); return parent() }
    if (k === '.' || k === ',') return byImportance(k === '.' ? 1 : -1)
    if ((k === ']' || k === '[') && renderer.selected <= 0 && c.stepProblem(k === ']' ? 1 : -1)) return
    if (k === ']') return cycleTarget('out', e.shiftKey ? -1 : 1)
    if (k === '[') return cycleTarget('in', e.shiftKey ? -1 : 1)
    if (k === 'enter') {
      if (renderer.target > 0) { const n = renderer.target; clearTarget(); return goSelect(n) }
      if (renderer.selected > 0) enter(renderer.selected)
    }
  })
  window.addEventListener('keyup', e => held.delete(e.key.toLowerCase()))
  window.addEventListener('blur', () => held.clear())

  /** Held arrow keys move the camera with a little acceleration; + and - zoom. */
  let thrust = 0
  const steer = (dt: number) => {
    if (held.has('alt')) return
    const ax = (held.has('arrowright') ? 1 : 0) - (held.has('arrowleft') ? 1 : 0)
    const ay = (held.has('arrowdown') ? 1 : 0) - (held.has('arrowup') ? 1 : 0)
    const az = (held.has('+') || held.has('=') ? 1 : 0) - (held.has('-') ? 1 : 0)
    thrust = ax || ay || az ? Math.min(1, thrust + dt / 350) : 0
    if (ax || ay || az) { moved(); cam.stop() }
    if (ax || ay) cam.panBy(-ax * 900 * thrust * dt / 1000, -ay * 900 * thrust * dt / 1000)
    if (az) cam.zoomAt(cam.w / 2, cam.h / 2, Math.exp(az * 1.8 * thrust * dt / 1000), c.zoomLimit(cam.w / 2, cam.h / 2), c.zoomFloor())
  }

  return {
    /** Per frame: steering, settling a hand-driven trip, and the preview of a card too small to read. */
    tick(dt: number, now: number) {
      steer(dt)
      settle()
      const p = renderer.pointer, h = renderer.hover
      // Only a card too small to carry its own name and counts gets a preview.
      const small = h > 0 && h !== renderer.selected && renderer.screenRectOf(h)[2] < 120
      const busy = !!drag || cam.flying || palette.isOpen || menu.isOpen
      // Off the cards, over a line: say which pairs of elements it carries.
      const lines = p && h <= 0 && !busy && !c.edgeOpen() ? renderer.linesAt(p[0], p[1]) : []
      if (lines.length) {
        const name = (i: number) => tree.els[i].title
        const pairs = lines.flatMap(l => renderer.carried(l.s, l.t)).slice(0, 8)
        const total = lines.reduce((a, l) => a + l.count, 0)
        tooltip.showLines(lines.map(l => `${l.s}-${l.t}`).join(), lines.map(l => `${name(l.s)} ↔ ${name(l.t)}`).join(' · ') + (total > 1 ? ` · ${total} relations` : ''), [...pairs.map(x => `${name(x.from)} → ${name(x.to)}${x.count > 1 ? ` ×${x.count}` : ''}`), 'Click: every relation and the lines that make it'], p![0], p![1])
      } else tooltip.update(p && small && !busy ? h : -1, p?.[0] ?? 0, p?.[1] ?? 0, now)
    },
    /** Records the place being left, before a move the page makes itself (a problem opened), so Back returns. */
    leave,
    /** Adds a part to search's Recent places, for a return the page makes itself (Back to the list). */
    remember,
    view, go, goSelect, enterPlace, feature, back, forward, parent, cycleTarget, palette, help, menu, toast,
    /** Flies to a view (a camera and a selection), recording where you were so Back returns. */
    visit(v: View) { leave(); goView(v) },
    /** Points every control at a new model version; the caller carries the selection over. */
    swap(next: { tree: typeof tree; world: typeof world; renderer: typeof renderer }) {
      tree = next.tree; world = next.world; renderer = next.renderer
      palette.tree = tree; tooltip.tree = tree
      tooltip.close()
      cycle = null
    },
  }
}
