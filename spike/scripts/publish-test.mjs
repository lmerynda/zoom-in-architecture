// End-to-end check of publishing a map the way a mapped project's agent does: a copy of the
// fixture repo is uploaded with `zoom.mjs publish` while a viewer is open, its tab appears without
// a reload, it opens as its own model, `publish --watch` uploads it again when its source changes,
// and once the copy is gone the viewer still shows its code: it never reads the project.
// Removes the copy and its import afterwards.
// usage: node scripts/publish-test.mjs [outDir]   (dev server running)
import puppeteer from 'puppeteer-core'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeIndex } from './store.mjs'

const outDir = process.argv[2] ?? 'shots/publish'
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
mkdirSync(outDir, { recursive: true })
const repo = join(mkdtempSync(join(tmpdir(), 'zoom-')), 'shop')
cpSync('test/fixtures/polyglot', repo, { recursive: true })
// One import the scanner cannot follow, so the viewer's account of it is checked on screen.
writeFileSync(join(repo, 'web/src/main.ts'), `${readFileSync(join(repo, 'web/src/main.ts'), 'utf8')}import { gone } from './gone'
`)
const scratch = join(repo, '..', 'map.json')
// The commands run from the project's side: their own folder, the viewer only as a URL.
const cli = join(import.meta.dirname, 'zoom.mjs')
const zoom = (...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [cli, ...args, '--to', base], { encoding: 'utf8', cwd: join(repo, '..') }) } } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` } }
}
let watcher

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shot = name => page.screenshot({ path: join(outDir, `${name}.png`) })
const results = {}
const check = (name, ok, detail = '') => { results[name] = ok ? 'pass' : `FAIL ${detail}`; console.log(ok ? 'pass' : 'FAIL', name, detail) }

try {
  await page.goto(`${base}?model=acme`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => { window.__sameDocument = true })
  // A first visit says what the map is, with its counts and features to start from; input does
  // not put it away, Got it does, for good.
  const welcome = () => page.evaluate(() => { const e = document.getElementById('welcome'); return { shown: !e.hidden && e.getBoundingClientRect().width > 0, text: e.textContent } })
  await sleep(500)
  const first = await welcome()
  await page.keyboard.press('Shift')
  await page.mouse.wheel({ deltaY: -100 })
  await sleep(400)
  const stays = (await welcome()).shown
  await page.click('#welcome .ok')
  await sleep(200)
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => { window.__sameDocument = true })
  await sleep(500)
  const after = await welcome()
  check('a first visit says what the map is, with its counts, until Got it', first.shown && /\d+ parts?/.test(first.text) && stays && !after.shown, JSON.stringify({ first, stays, after: after.shown }))

  // A map with a guessed link is refused, and nothing is published.
  const map = JSON.parse(readFileSync('test/fixtures/polyglot-map.json', 'utf8'))
  writeFileSync(scratch, JSON.stringify({ ...map, links: [...map.links, { from: 'web.orders', to: 'db', title: 'guess' }] }))
  const refused = zoom('publish', repo, scratch, '--name', 'shop')
  check('a map with an unproven link is refused', refused.code === 1 && /needs evidence/.test(refused.out), refused.out.split('\n').find(l => l.startsWith('error:')))

  // The real map publishes, and the open viewer gets its tab live.
  writeFileSync(scratch, JSON.stringify(map))
  const t0 = Date.now()
  const published = zoom('publish', repo, scratch, '--name', 'shop')
  check('the map publishes', published.code === 0, published.out.trim().split('\n').pop())
  await page.waitForFunction(() => [...document.querySelectorAll('#models a')].some(a => a.textContent === 'Shop'), { timeout: 15000 })
  check('its tab appears without a reload', await page.evaluate(() => window.__sameDocument === true), `${Date.now() - t0} ms`)
  await shot('01-tab-appears')
  // A visit that names no map opens the latest upload, this one, not a sample.
  const bare = await browser.newPage()
  await bare.goto(base, { waitUntil: 'load' })
  await bare.waitForFunction(() => /model=/.test(location.search) && window.__spike?.ready, { timeout: 60000 }).catch(() => {})
  const landed = await bare.evaluate(() => location.search)
  await bare.close()
  check('a visit naming no map opens the latest upload', landed === '?model=shop', landed)

  await page.evaluate(() => [...document.querySelectorAll('#models a')].find(a => a.textContent === 'Shop').click())
  await page.waitForFunction(() => location.search === '?model=shop' && window.__spike?.ready, { timeout: 60000 })
  const ids = await page.evaluate(() => window.__spike.tree.els.map(e => e.id))
  check('it opens with the map’s levels', ['customer', 'web.shopping.main', 'server.orders.orderController', 'game', 'db'].every(id => ids.includes(id)), ids.slice(0, 8).join(' '))
  check('tests and configs are not on it', !ids.some(id => /vite|eslint|test|orphan/i.test(id)), ids.filter(id => /vite|eslint|test|orphan/i.test(id)).join(' '))
  // A resized window is drawn in full: the camera takes the new size, so nothing past the old edge is culled.
  // And what was in view stays in view: the landscape still fits a smaller window.
  await page.setViewport({ width: 1100, height: 700 })
  await sleep(300)
  const small = await page.evaluate(() => { const s = window.__spike, r = s.world.rect, [x, y] = s.cam.toScreen(0, 0), [x2, y2] = s.cam.toScreen(r[2], r[3]); return { x, y, x2, y2, w: s.cam.w, h: s.cam.h } })
  check('a smaller window keeps the landscape in view', small.x >= -2 && small.y >= -2 && small.x2 <= small.w + 2 && small.y2 <= small.h + 2, JSON.stringify(small))
  await page.setViewport({ width: 1600, height: 1000 })
  await sleep(300)
  const view = await page.evaluate(() => ({ w: window.__spike.cam.w, h: window.__spike.cam.h, iw: innerWidth, ih: innerHeight }))
  check('a resized window is drawn in full', view.w === view.iw && view.h === view.ih, JSON.stringify(view))
  // Flying into a file passes many file cards: every code box left showing holds its file.
  await page.evaluate(() => { const s = window.__spike; s.fly(s.id('server.orders.orderController')) })
  await page.waitForFunction(() => window.__spike.cam.flying, { timeout: 3000 }).catch(() => {})
  await page.waitForFunction(() => !window.__spike.cam.flying, { timeout: 10000 })
  await sleep(1500)
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.code')].filter(e => !e.hidden).map(e => !!e.querySelector('canvas') || !e.querySelector('pre').hidden))
  check('every code box shows its file after a fly-in', boxes.length > 0 && boxes.every(Boolean), JSON.stringify(boxes))
  await page.evaluate(() => window.__spike.fit(0))
  await page.waitForFunction(() => !window.__spike.cam.flying, { timeout: 10000 })
  // A feature's name finds the nodes that carry it, though none is titled that way.
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control')
  await page.keyboard.type('order tracking')
  await sleep(300)
  const found = await page.evaluate(() => [...document.querySelectorAll('.palette .row b')].map(b => b.textContent))
  check('a feature’s name finds the nodes that carry it', ['Orders client', 'Orders', 'Orders API'].every(t => found.includes(t)), found.join(', '))
  // A search that finds nothing says so, and offers the map's features instead of a blank box.
  await page.evaluate(() => { const i = document.querySelector('.palette input'); i.value = 'zzqx'; i.dispatchEvent(new Event('input')) })
  await sleep(200)
  const none = await page.evaluate(() => ({ text: document.querySelector('.palette .none')?.textContent ?? '', rows: [...document.querySelectorAll('.palette .row b')].map(b => b.textContent) }))
  check('a search that finds nothing says so and offers the features', none.text.includes('Nothing matches “zzqx”') && none.rows.includes('Order tracking'), JSON.stringify(none))
  await page.keyboard.press('Escape')
  await page.evaluate(() => { const s = window.__spike; s.unhover(); s.select(s.id('web.orders.api')); s.fit(0) })
  await page.waitForFunction(() => !window.__spike.cam.flying)
  await sleep(600)
  await shot('02-opened')
  // The selected file's link to the server shows the code lines that prove it, one click away.
  await page.evaluate(() => document.querySelectorAll('#details .d-cite').forEach(b => b.click()))
  const proof = await page.$eval('#details', e => e.innerText)
  // Zoomed past the file's card, its own source shows, the cited line marked.
  await page.evaluate(() => { const s = window.__spike, i = s.id('web.orders.api'), r = s.world.rect; s.cam.set(r[i * 4] + r[i * 4 + 2] / 2, r[i * 4 + 1] + r[i * 4 + 3] / 2, (s.cam.w * 1.2) / r[i * 4 + 2]) })
  await page.waitForFunction(() => [...document.querySelectorAll('.code')].some(e => !e.hidden && e.textContent.includes('/api/orders')), { timeout: 10000 }).catch(() => {})
  const code = await page.evaluate(() => { const e = [...document.querySelectorAll('.code')].find(e => !e.hidden); return e ? { text: e.textContent, cited: e.querySelector('.cited')?.textContent ?? '' } : null })
  check('zooming past a file shows its source', !!code && code.cited.includes("fetch('/api/orders')"), code ? code.cited.trim() : 'no code shown')
  await shot('02b-code')
  await page.evaluate(() => { const s = window.__spike; s.fit(0) })
  check('a link shows its evidence in the panel', proof.includes('src/api.ts:1') && proof.includes("fetch('/api/orders')") && proof.includes('@GetMapping("/api/orders")'), proof.split('\n').filter(l => /:\d|fetch|@Get/.test(l)).join(' | '))
  // Clicking a cited line opens its file to read, at that line, beside the panel.
  await page.waitForFunction(() => !window.__spike.cam.flying)
  await page.evaluate(() => [...document.querySelectorAll('.d-ev .cite')].find(e => e.title.includes('OrderController.java:11')).click())
  await page.waitForFunction(() => !document.querySelector('.reader').hidden && document.querySelector('.reader pre .at'), { timeout: 10000 })
  await sleep(300)
  const opened = await page.evaluate(() => {
    const line = document.querySelector('.reader pre .at')
    const r = line.getBoundingClientRect(), box = document.querySelector('.reader').getBoundingClientRect(), panel = document.getElementById('details').getBoundingClientRect()
    return { text: line.textContent, inView: r.y > box.y && r.bottom < box.bottom, right: box.right, panelLeft: panel.x }
  })
  check('a cited line opens its code there', opened.text.includes('@GetMapping') && opened.inView && opened.right <= opened.panelLeft, JSON.stringify(opened))
  await page.keyboard.press('Escape')
  await shot('02c-evidence-opened')
  // A selection lights the focused card's edges.
  await page.evaluate(() => { const s = window.__spike; s.select(-1); s.unhover(); s.fit(0) })
  await sleep(1500)
  const idle = await page.evaluate(() => window.__spike.last())
  // Fit frames the map in the space the panels leave: no card under the breadcrumb or the minimap.
  const clear = {}
  const viewport = page.viewport()
  for (const [width, height] of [[1600, 1000], [1100, 900], [1000, 1000], [1400, 700]]) {
    await page.setViewport({ width, height })
    await sleep(300)
    await page.evaluate(() => window.__spike.fit(0))
    await sleep(2800)
    const under = await page.evaluate(() => {
      const s = window.__spike, r = s.world.rect
      const boxes = ['crumbs', 'top', 'minimap'].map(id => document.getElementById(id).getBoundingClientRect())
      return s.tree.children[0].filter(i => {
        const [x, y] = s.cam.toScreen(r[i * 4], r[i * 4 + 1]), w = r[i * 4 + 2] * s.cam.z, h = r[i * 4 + 3] * s.cam.z
        return boxes.some(b => x < b.right && b.left < x + w && y < b.bottom && b.top < y + h)
      }).map(i => s.tree.els[i].id)
    })
    if (under.length) clear[`${width}x${height}`] = under
  }
  await page.setViewport(viewport)
  await page.evaluate(() => window.__spike.fit(0))
  await sleep(2800)
  check('fit keeps the landscape clear of the breadcrumb and the minimap', Object.keys(clear).length === 0, JSON.stringify(clear))
  // A one-file app opens no sooner than its siblings of the same size: its file is not blown up to fill it.
  const even = await page.evaluate(() => {
    const s = window.__spike, t = s.tree, r = s.world.rect, rd = s.renderer, top = t.children[0]
    const lone = top.filter(i => t.children[i].length === 1)
    return lone.map(i => {
      const peers = top.filter(j => j !== i && t.children[j].length > 1 && Math.abs(r[j * 4 + 2] - r[i * 4 + 2]) < 1)
      const child = t.children[i][0]
      return { id: t.els[i].id, peers: peers.length, childW: r[child * 4 + 2], peerChildW: Math.max(0, ...peers.flatMap(j => t.children[j].map(c => r[c * 4 + 2]))) }
    })
  })
  check('a one-file app shows its file no larger than its siblings show theirs', even.length > 0 && even.every(e => e.peers === 0 || e.childW <= e.peerChildW + 1), JSON.stringify(even))
  // At the landscape you are nowhere deeper, whatever card sits under the screen centre.
  check('the landscape is where the breadcrumb says you are', await page.evaluate(() => window.__spike.renderer.breadcrumb().length === 0))
  // The copy is not a git checkout: the map says it has no commit, and how old it is.
  const stamp = await page.evaluate(() => document.querySelector('#crumbs .provenance')?.textContent ?? null)
  check('the breadcrumb says when and from what the map was built', stamp === 'no commit · just now', String(stamp))
  // The file with the import the scanner could not follow names it in its details panel.
  const missed = await page.evaluate(async () => {
    const s = window.__spike, i = s.tree.els.findIndex(e => e.metadata?.path === 'web/src/main.ts')
    s.select(i)
    await new Promise(r => setTimeout(r, 300))
    const p = document.querySelector('#details .d-missed')?.textContent ?? null
    s.select(-1)
    return { marks: s.tree.els[i]?.metadata?.marks ?? '', p }
  })
  check('a reference the scanner could not follow is named, not silent', /:missed/.test(missed.marks) && !!missed.p?.includes('./gone'), JSON.stringify(missed))
  // Picking a lens shows its legend below the bar; the bar itself keeps one line.
  const bar = await page.evaluate(async () => {
    const h = () => document.getElementById('top').getBoundingClientRect().height
    const before = h()
    window.__spike.setLens('size')
    await new Promise(r => setTimeout(r, 100))
    const after = h()
    window.__spike.setLens('structure')
    return { before, after }
  })
  // The wheel never strands the reader: over empty space it stops, and out it stops near the landscape.
  await page.evaluate(() => { const s = window.__spike; s.unhover(); s.fit(0) })
  await sleep(1200)
  const vh = await page.evaluate(() => innerHeight)
  await page.mouse.move(6, vh / 2)
  for (let k = 0; k < 40; k++) { await page.mouse.wheel({ deltaY: -400 }); await sleep(15) }
  await sleep(1200)
  const deep = await page.evaluate(() => { const s = window.__spike; return { z: s.cam.z, fit: Math.min(s.cam.w * 0.92 / s.world.rect[2], s.cam.h * 0.92 / s.world.rect[3]), cards: s.last().nodes } })
  for (let k = 0; k < 60; k++) { await page.mouse.wheel({ deltaY: 400 }); await sleep(15) }
  await sleep(1200)
  const far = await page.evaluate(() => window.__spike.cam.z)
  check('the wheel stops over empty space and near the landscape', deep.z < deep.fit * 8 && deep.cards > 0 && far > deep.fit * 0.45, JSON.stringify({ deep: deep.z / deep.fit, cards: deep.cards, far: far / deep.fit }))
  // Double-clicking a file reads it: a real double-click (two presses, the second counted as such,
  // so the browser fires dblclick) opens the file's code to read.
  const fileAt = await page.evaluate(async () => {
    const s = window.__spike, f = s.tree.els.findIndex(e => e.metadata?.path === 'web/src/api.ts')
    s.select(-1); s.fit(s.tree.parent[f])
    await new Promise(r => setTimeout(r, 1800))
    window.__dblclicks = 0
    document.querySelector('#stage canvas').addEventListener('dblclick', () => window.__dblclicks++)
    const r = s.world.rect, [x, y] = s.cam.toScreen(r[f * 4] + r[f * 4 + 2] / 2, r[f * 4 + 1] + r[f * 4 + 3] / 2)
    return { x, y, f, under: s.renderer.pick(x, y), z: s.cam.z }
  })
  await page.mouse.move(fileAt.x, fileAt.y)
  await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 })
  await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 })
  await sleep(3000)
  await page.waitForFunction(() => !document.querySelector('.reader').hidden, { timeout: 10000 }).catch(() => {})
  const read = await page.evaluate(() => ({ dblclicks: window.__dblclicks, sel: window.__spike.renderer.selected, text: document.querySelectorAll('.reader pre > span').length }))
  check('double-clicking a file opens its code to read', fileAt.under === fileAt.f && read.dblclicks === 1 && read.sel === fileAt.f && read.text > 0, JSON.stringify({ ...fileAt, ...read }))
  await page.keyboard.press('Escape')
  // Selecting a card the details panel would cover glides it clear, and it stays on screen.
  const cleared = await page.evaluate(async () => {
    const s = window.__spike, r = s.world.rect, wait = ms => new Promise(res => setTimeout(res, ms))
    s.select(-1); s.unhover(); s.fit(0)
    await wait(1500)
    s.select(1)
    await wait(200)
    const panelLeft = document.getElementById('details').getBoundingClientRect().x
    const rect = i => { const [x, y] = s.cam.toScreen(r[i * 4], r[i * 4 + 1]); return [x, y, r[i * 4 + 2] * s.cam.z, r[i * 4 + 3] * s.cam.z] }
    // Fit keeps the map clear of the panels, so move a landscape card under the panel's edge first.
    const under = s.tree.children[0].find(i => rect(i)[2] < panelLeft / 2)
    if (under == null) return { under: null }
    s.cam.set(r[under * 4] + r[under * 4 + 2] / 2 - (panelLeft - s.cam.w / 2) / s.cam.z, s.cam.y, s.cam.z)
    await wait(100)
    const [ux, , uw] = rect(under)
    if (!(ux < panelLeft && ux + uw > panelLeft)) return { under: null, ux, uw, panelLeft }
    s.select(under)
    await wait(2000)
    const [x, y, w, h] = rect(under)
    return { under: s.tree.els[under].id, x, y, w, h, panelLeft, W: s.cam.w, H: s.cam.h }
  })
  check('selecting a card under the panel glides it clear and keeps it on screen', cleared.under != null && cleared.x >= 0 && cleared.y >= 0 && cleared.x + cleared.w <= cleared.panelLeft && cleared.y + cleared.h <= cleared.H, JSON.stringify(cleared))
  // Empty space says how to get back: deep in a card's empty corner a hint shows, and goes on the way out.
  const empty = await page.evaluate(async () => {
    const s = window.__spike, r = s.world.rect, i = s.id('server'), wait = ms => new Promise(res => setTimeout(res, ms))
    s.select(-1); s.unhover()
    s.cam.set(r[i * 4] + r[i * 4 + 2] * 0.995, r[i * 4 + 1] + r[i * 4 + 3] * 0.99, s.cam.w / (r[i * 4 + 2] * 0.004))
    await wait(400)
    const there = !document.getElementById('empty').hidden
    s.fit(0)
    await wait(1800)
    return { there, gone: document.getElementById('empty').hidden }
  })
  check('empty space shows a way back, and the hint goes on the way out', empty.there && empty.gone, JSON.stringify(empty))
  check('a lens does not reflow the top bar', bar.before === bar.after && bar.after < 60, JSON.stringify(bar))
  await page.evaluate(() => { const s = window.__spike; s.select(s.id('web')) })
  await sleep(300)
  const focused = await page.evaluate(() => window.__spike.last())
  check('a selection lights the focused card edges', idle.edges > 0 && focused.edges > 0, JSON.stringify({ idle: idle.edges, focused: focused.edges }))
  // A single import's name labels its arrow only while one of its ends is in focus.
  const named = await page.evaluate(() => {
    const s = window.__spike, t = s.tree, rd = s.renderer
    const pair = new Map()
    for (let k = 0; k < t.relTitles.length; k++) {
      const a = t.rels[k * 2], b = t.rels[k * 2 + 1], key = `${a}>${b}`
      pair.set(key, [...(pair.get(key) ?? []), k])
    }
    const k = [...pair.values()].filter(ks => ks.length === 1).map(ks => ks[0])
      .find(k => !t.relEvidence[k] && t.relTitles[k] && t.parent[t.rels[k * 2]] === t.parent[t.rels[k * 2 + 1]] && !t.children[t.rels[k * 2]].length)
    if (k == null) return null
    const src = t.rels[k * 2], title = t.relTitles[k]
    const settle = () => { for (let f = 0; f < 200; f++) s.advance(16) }
    const shown = () => rd.labels.filter(l => l.text.visible).map(l => l.text.text)
    s.select(-1); s.unhover(); s.manual(true); s.fit(t.parent[src]); settle()
    const idle = shown()
    s.select(src); settle()
    const focused = shown()
    s.select(-1); s.manual(false)
    return { title, idle: idle.includes(title), focused: focused.includes(title) }
  })
  check('an import’s name labels its arrow only in focus', !!named && !named.idle && named.focused, JSON.stringify(named))
  // A card that is only starting to open keeps its rolled-up arrows, yet its children, drawn with
  // their names, are clickable, and a selected one shows its own edges.
  const opening = await page.evaluate(() => {
    const s = window.__spike, rd = s.renderer, t = s.tree, r = s.world.rect, i = s.id('server')
    const kid = t.els.findIndex((_, k) => t.parent[k] === i), inner = t.els.findIndex((_, k) => t.parent[k] === kid)
    const cx = r[i * 4] + r[i * 4 + 2] / 2, cy = r[i * 4 + 1] + r[i * 4 + 3] / 2
    s.select(-1); s.unhover(); s.manual(true)
    let lo = s.cam.w / r[i * 4 + 2] / 256, hi = lo * 4096
    for (let n = 0; n < 40; n++) { const z = Math.sqrt(lo * hi); s.cam.set(cx, cy, z); for (let f = 0; f < 30; f++) s.advance(16); if (rd.open(i) < 0.25) lo = z; else hi = z }
    const open = rd.open(i), rolled = rd.rep(inner)
    const [x, y] = s.cam.toScreen(r[kid * 4] + r[kid * 4 + 2] / 2, r[kid * 4 + 1] + r[kid * 4 + 3] / 2)
    const picked = rd.pick(x, y)
    s.select(kid); s.advance(16)
    const own = rd.rep(inner)
    s.select(-1); s.manual(false)
    return { open: +open.toFixed(2), rolled: t.els[rolled].id, picked: t.els[picked].id, own: t.els[own].id, kid: t.els[kid].id }
  })
  check('a card starting to open keeps its rolled-up arrows, and its children are still clickable', opening.open > 0.1 && opening.open < 0.4 && opening.rolled === 'server' && opening.picked === opening.kid && opening.own === opening.kid, JSON.stringify(opening))
  // The controls screen tells readers a cited line opens its code.
  await page.keyboard.press('?')
  await sleep(250)
  const help = await page.$eval('.help-overlay', e => e.textContent)
  await shot('02d-help')
  await page.keyboard.press('Escape')
  check('the controls screen says cited lines open their code', help.includes('Click a cited line'), help.slice(0, 80))

  // Live, from the project's side: publish --watch uploads again when the code changes, and a new
  // file goes beside the files it talks to.
  watcher = spawn(process.execPath, [cli, 'publish', repo, scratch, '--name', 'shop', '--watch', '--to', base], { cwd: join(repo, '..'), stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise((ok, fail) => { watcher.stdout.on('data', d => { if (String(d).includes('watching')) ok() }); watcher.on('exit', fail) })
  writeFileSync(join(repo, 'web/src/ui/checkout.ts'), "import { cart } from './cart'\nexport const checkout = () => cart()\n")
  writeFileSync(join(repo, 'web/src/main.ts'), `${readFileSync(join(repo, 'web/src/main.ts'), 'utf8')}import { checkout } from './ui/checkout'\ncheckout()\n`)
  const t1 = Date.now()
  await page.waitForFunction(() => window.__spike.liveVersion > 0 && window.__spike.tree.byId.has('web.shopping.checkout'), { timeout: 30000 })
  await page.waitForFunction(() => !window.__spike.morphing)
  check('source edits are uploaded again, live', true, `${Date.now() - t1} ms · ${await page.$eval('.toast', e => e.textContent)}`)
  await sleep(400)
  await shot('03-source-edit')

  // The Connections view: the same map laid out by connection, most connected in the middle, and `.`
  // walks a level from the most connected down.
  await page.evaluate(() => [...document.querySelectorAll('#views a')].find(a => a.textContent === 'Connections').click())
  await page.waitForFunction(() => location.search.includes('view=connections') && window.__spike?.ready, { timeout: 60000 })
  await sleep(1500)
  const cv = await page.evaluate(() => {
    const s = window.__spike, r = s.world.rect, rk = s.renderer.ranking, top = s.tree.children[0]
    const mid = [r[2] / 2, r[3] / 2], d = i => Math.hypot(r[i * 4] + r[i * 4 + 2] / 2 - mid[0], r[i * 4 + 1] + r[i * 4 + 3] / 2 - mid[1])
    const first = top.find(i => rk.rank[i] === 1)
    return { first: s.tree.els[first].id, nearest: s.tree.els[top.reduce((a, b) => (d(b) < d(a) ? b : a))].id, weights: top.map(i => rk.weight[i]) }
  })
  await page.keyboard.press('.')
  await sleep(2200)
  const picked = await page.evaluate(() => window.__spike.tree.els[window.__spike.renderer.selected]?.id)
  check('the Connections view puts the most connected in the middle, and . walks from it', cv.first === cv.nearest && picked === cv.first, JSON.stringify({ ...cv, picked }))
  // Its grid's gutters are narrow; the landscape's arrows still say what they carry (the customer's
  // arrow runs beside a card at its middle and once went unlabelled).
  const counts = await page.evaluate(() => {
    const s = window.__spike
    s.select(-1); s.unhover(); s.manual(true); s.fit(0)
    for (let k = 0; k < 60; k++) s.advance(16)
    const labels = s.renderer.labels.filter(l => l.text.visible).map(l => l.text.text)
    s.manual(false)
    return labels
  })
  await shot('connections-landscape')
  // Each card wears its rank in its corner, readable, not inside the small print.
  // (An open card says it in its header instead.)
  const badges = await page.evaluate(() => {
    const s = window.__spike, rd = s.renderer, views = rd.views, top = s.tree.children[0]
    const closed = top.filter(i => rd.open(i) <= 0)
    return {
      closed: closed.length,
      badges: closed.map(i => views[i]?.rank).filter(b => b?.visible).map(b => b.text),
      headers: top.filter(i => rd.open(i) > 0).map(i => views[i]?.meta?.text ?? ''),
    }
  })
  check('Connections cards wear their rank as a badge', badges.badges.length === badges.closed && [...badges.badges, ...badges.headers.map(h => h.split(' ')[0])].includes('#1'), JSON.stringify(badges))
  check('the Connections landscape labels its arrows in narrow gutters', ['shops in a browser', 'GET /api/orders'].every(t => counts.includes(t)), JSON.stringify(counts))
  await page.evaluate(() => [...document.querySelectorAll('#views a')].find(a => a.textContent === 'Architecture').click())
  await page.waitForFunction(() => !location.search.includes('view=') && window.__spike?.ready, { timeout: 60000 })

  // The Requests view: a switch beside the lenses opens the edge, and an endpoint holds its request's path.
  check('the view switch sits with the lenses, not among the models', await page.evaluate(() => {
    const views = document.querySelector('#views'), lenses = document.querySelector('.lensbar')
    return !views.hidden && views.nextElementSibling === lenses && !document.querySelector('#models').textContent.includes('Requests')
  }))
  await page.evaluate(() => [...document.querySelectorAll('#views a')].find(a => a.textContent === 'Requests').click())
  await page.waitForFunction(() => location.search.includes('view=requests') && window.__spike?.ready, { timeout: 60000 })
  const edge = await page.evaluate(() => {
    const t = window.__spike.tree, kids = id => t.els.filter(e => e.parent === id).map(e => e.title)
    return { top: t.children[0].map(i => t.els[i].title), groups: kids('server'), path: kids('server.api-orders.e1') }
  })
  check('the Requests view opens on the edge, with each request\'s path', edge.top.join() === 'Storefront,Orders server,Go server,Shop kit,PostgreSQL' && edge.groups.join() === '/api/orders' && edge.path[0] === '1 · all()' && edge.path.at(-1).endsWith('· Response'), JSON.stringify(edge))
  await page.evaluate(() => { const s = window.__spike; s.fly(s.id('server.api-orders.e1')) })
  await page.waitForFunction(() => window.__spike.cam.flying, { timeout: 3000 }).catch(() => {})
  await page.waitForFunction(() => !window.__spike.cam.flying, { timeout: 10000 })
  await sleep(1500)
  await shot('04-request-path')

  // The viewer keeps what was uploaded: with the project gone, its code and its map are still served.
  // Windows keeps a folder while a process watches it or runs in it: wait for the watcher to end.
  await new Promise(ok => { watcher.once('exit', ok); watcher.kill() })
  rmSync(join(repo, '..'), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  const kept = await page.evaluate(async () => {
    const src = await fetch('/source/shop?path=web%2Fsrc%2Fui%2Fcheckout.ts').then(r => (r.ok ? r.text() : null))
    const map = await fetch('/maps/shop.json').then(r => (r.ok ? r.json() : null))
    return { src, nodes: map?.nodes?.length ?? 0 }
  })
  check('it needs nothing from the project once uploaded', !!kept.src?.includes('checkout') && kept.nodes > 0, JSON.stringify(kept).slice(0, 120))
} finally {
  console.log(JSON.stringify({ results, errors }, null, 1))
  watcher?.kill()
  await browser.close()
  rmSync(join(repo, '..'), { recursive: true, force: true })
  rmSync('imports/shop', { recursive: true, force: true })
  rmSync('public/models/shop.json', { force: true })
  rmSync('public/models/shop.requests.json', { force: true })
  writeIndex()
}
