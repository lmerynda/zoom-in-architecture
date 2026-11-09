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
  args: ['--window-size=1600,1000', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
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

  await page.evaluate(() => [...document.querySelectorAll('#models a')].find(a => a.textContent === 'Shop').click())
  await page.waitForFunction(() => location.search === '?model=shop' && window.__spike?.ready, { timeout: 60000 })
  const ids = await page.evaluate(() => window.__spike.tree.els.map(e => e.id))
  check('it opens with the map’s levels', ['customer', 'web.shopping.main', 'server.orders.orderController', 'game', 'db'].every(id => ids.includes(id)), ids.slice(0, 8).join(' '))
  check('tests and configs are not on it', !ids.some(id => /vite|eslint|test|orphan/i.test(id)), ids.filter(id => /vite|eslint|test|orphan/i.test(id)).join(' '))
  // A resized window is drawn in full: the camera takes the new size, so nothing past the old edge is culled.
  await page.setViewport({ width: 1100, height: 700 })
  await sleep(300)
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
  await page.keyboard.press('Escape')
  await page.evaluate(() => { const s = window.__spike; s.unhover(); s.select(s.id('web.orders.api')); s.fit(0) })
  await page.waitForFunction(() => !window.__spike.cam.flying)
  await sleep(600)
  await shot('02-opened')
  // The selected file's link to the server shows the code lines that prove it.
  const proof = await page.$eval('#details', e => e.innerText)
  // Zoomed past the file's card, its own source shows, the cited line marked.
  await page.evaluate(() => { const s = window.__spike, i = s.id('web.orders.api'), r = s.world.rect; s.cam.set(r[i * 4] + r[i * 4 + 2] / 2, r[i * 4 + 1] + r[i * 4 + 3] / 2, (s.cam.w * 1.2) / r[i * 4 + 2]) })
  await page.waitForFunction(() => [...document.querySelectorAll('.code')].some(e => !e.hidden && e.textContent.includes('/api/orders')), { timeout: 10000 }).catch(() => {})
  const code = await page.evaluate(() => { const e = [...document.querySelectorAll('.code')].find(e => !e.hidden); return e ? { text: e.textContent, cited: e.querySelector('.cited')?.textContent ?? '' } : null })
  check('zooming past a file shows its source', !!code && code.cited.includes("fetch('/api/orders')"), code ? code.cited.trim() : 'no code shown')
  await shot('02b-code')
  await page.evaluate(() => { const s = window.__spike; s.fit(0) })
  check('a link shows its evidence in the panel', proof.includes('src/api.ts:1') && proof.includes("fetch('/api/orders')") && proof.includes('@GetMapping("/api/orders")'), proof.split('\n').filter(l => /:\d|fetch|@Get/.test(l)).join(' | '))
  // Clicking a cited line opens its file there: the line in view, readable, beside the panel.
  await page.waitForFunction(() => !window.__spike.cam.flying)
  await page.evaluate(() => [...document.querySelectorAll('.d-ev .open')].find(e => e.title.includes('OrderController.java:11')).click())
  await page.waitForFunction(() => window.__spike.cam.flying, { timeout: 5000 }).catch(() => {})
  await page.waitForFunction(() => !window.__spike.cam.flying, { timeout: 10000 })
  await sleep(600)
  const opened = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.code .cited')].find(e => e.textContent.includes('@GetMapping'))
    const r = line?.getBoundingClientRect(), panel = document.getElementById('details').getBoundingClientRect()
    return r ? { y: r.y, h: r.height, left: r.x, panelLeft: panel.x, mid: innerHeight / 2 } : null
  })
  check('a cited line opens its code there', !!opened && Math.abs(opened.y + opened.h / 2 - opened.mid) < 60 && opened.h > 12 && opened.left < opened.panelLeft, JSON.stringify(opened))
  await shot('02c-evidence-opened')
  // Nothing moves on its own: dots run only along the focused card's edges, since the data has no traffic.
  await page.evaluate(() => { const s = window.__spike; s.select(-1); s.unhover(); s.fit(0) })
  await sleep(1500)
  const idle = await page.evaluate(() => window.__spike.last())
  // At the landscape you are nowhere deeper, whatever card sits under the screen centre.
  check('the landscape is where the breadcrumb says you are', await page.evaluate(() => window.__spike.renderer.breadcrumb().length === 0))
  // The copy is not a git checkout: the map says it has no commit, and how old it is.
  const stamp = await page.evaluate(() => document.querySelector('#crumbs .provenance')?.textContent ?? null)
  check('the breadcrumb says when and from what the map was built', stamp === 'no commit · just now', String(stamp))
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
  check('a lens does not reflow the top bar', bar.before === bar.after && bar.after < 60, JSON.stringify(bar))
  await page.evaluate(() => { const s = window.__spike; s.select(s.id('web')) })
  await sleep(300)
  const focused = await page.evaluate(() => window.__spike.last())
  check('no empty route panel sits on the map', await page.evaluate(() => document.querySelector('.routepanel').hidden))
  check('only the focused card\'s edges move', idle.edges > 0 && idle.particles === 0 && focused.particles > 0, JSON.stringify({ idle: [idle.edges, idle.particles], focused: [focused.edges, focused.particles] }))
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
