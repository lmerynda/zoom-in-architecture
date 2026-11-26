// End-to-end check of what made each request: a copy of the fixture repo gets a small React Router
// app (a page that calls the orders API), and is published with a trace that says which page a
// browser made each request from and which tests made them, as `zoom trace` writes it. The requests
// view lists an endpoint's pages and tests; the architecture lists a page's endpoints, each a jump
// to the file that serves it. Publishes under a name of its own and removes only that import.
// usage: node scripts/traces-test.mjs [outDir]   (dev server running; SPIKE_URL names it)
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeIndex } from './store.mjs'

const outDir = process.argv[2] ?? 'shots/traces'
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
const NAME = `zoom-traces-test-${process.pid}`
mkdirSync(outDir, { recursive: true })
const repo = join(mkdtempSync(join(tmpdir(), 'zoom-')), 'shop')
cpSync('test/fixtures/polyglot', repo, { recursive: true })
// The shop front end gets pages: a router whose /orders/:id page loads the orders.
mkdirSync(join(repo, 'web/src/pages'), { recursive: true })
writeFileSync(join(repo, 'web/src/App.tsx'), `import { Route, Routes } from 'react-router-dom'
import { Orders } from './pages/Orders'
import { Home } from './pages/Home'
export const App = () => (
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/orders/:id" element={<Orders />} />
  </Routes>
)
`)
writeFileSync(join(repo, 'web/src/pages/Orders.tsx'), `import { load } from '../api'\nexport const Orders = () => { void load(); return null }\n`)
writeFileSync(join(repo, 'web/src/pages/Home.tsx'), `export const Home = () => null\n`)
appendFileSync(join(repo, 'web/src/main.ts'), `import { App } from './App'\nvoid App\n`)
const scratch = join(repo, '..')
const map = JSON.parse(readFileSync('test/fixtures/polyglot-map.json', 'utf8'))
writeFileSync(join(scratch, 'map.json'), JSON.stringify(map))
// What the trace saw: the orders loaded from two order pages, from an address no route names (a
// reset link with its token), and with no page (an API test); by ten tests, and twice while none ran.
const tests = Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`web.test.ts › orders > shows order ${k + 1}`, 10 - k]))
writeFileSync(join(scratch, 'trace.json'), JSON.stringify({
  at: '2026-11-25T12:00:00.000Z', command: 'npm run test:browser', exit: 0, ms: 1000, spans: 40, background: {},
  endpoints: [{ method: 'GET', route: '/api/orders', count: 57, statuses: { 200: 57 }, tables: { orders: ['SELECT'] }, code: { 'com.shop.orders.OrderController.all': 57 }, calls: {}, pages: { '/orders/1': 30, '/orders/2': 20, '/reset/t0ken-123': 3 }, tests, untimed: 2 }],
}))
const cli = join(import.meta.dirname, 'zoom.mjs')
const zoom = (...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [cli, ...args, '--to', base], { encoding: 'utf8', cwd: scratch }) } } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` } }
}

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
const open = async (q = '') => {
  await page.goto(`${base}?model=${NAME}${q}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => { const w = document.getElementById('welcome'); if (w && !w.hidden) w.querySelector('.ok')?.click() })
  await sleep(800)
}
const sections = () => page.evaluate(() => [...document.querySelectorAll('#details .d-callers')].map(s => ({
  head: s.querySelector('h3').textContent,
  rows: [...s.querySelectorAll('li')].map(li => ({ text: li.textContent, shown: !li.hidden, button: !!li.querySelector('button') })),
  more: s.querySelector('.d-more')?.textContent ?? null,
})))
const selectWhere = (pred) => page.evaluate(async src => {
  const s = window.__spike, f = new Function('e', `return ${src}`)
  const i = s.tree.els.findIndex(e => f(e))
  s.select(i); s.fly(i)
  await new Promise(r => setTimeout(r, 1300))
  document.querySelector('#details .d-callers')?.scrollIntoView()
  return i
}, pred)

try {
  const published = zoom('publish', repo, join(scratch, 'map.json'), '--name', NAME, '--trace', join(scratch, 'trace.json'))
  check('the map publishes with the trace', published.code === 0, published.out.trim().split('\n').pop())

  // The requests view: the endpoint lists the page it was called from, and the tests that called it.
  await open('&view=requests')
  await selectWhere("e.title === 'GET /api/orders'")
  const ep = await sections()
  const pages = ep.find(s => s.head.startsWith('Called from pages'))
  const other = await page.evaluate(() => document.querySelector('#details .d-callers')?.textContent ?? '')
  check('an endpoint lists its pages, two addresses of one route as one, and only counts an address no route names', pages?.head === 'Called from pages · 1' && /^\/orders\/:idOrders\.tsx · ×50$/.test(pages.rows[0].text) && /And 3 requests from addresses no route of the app names/.test(other) && !other.includes('t0ken'), JSON.stringify(pages))
  const made = ep.find(s => s.head.startsWith('Made by tests'))
  check('an endpoint lists the tests that made it, the busiest first, eight then Show all', made?.head === 'Made by tests · 10' && made.rows[0].text === 'orders > shows order 1web.test.ts · ×10' && made.rows.filter(r => r.shown).length === 8 && made.more === 'Show all 10', JSON.stringify(made))
  check('requests no single test made are counted apart', await page.evaluate(() => /And 2 requests while no single test ran in its file/.test([...document.querySelectorAll('#details .d-callers')].pop().textContent)))
  // By keyboard: the toggle keeps the focus and says the list is open, then closes it again.
  await page.evaluate(() => [...document.querySelectorAll('#details .d-callers .d-more')].pop().focus())
  await page.keyboard.press('Enter')
  const opened = await page.evaluate(() => { const b = document.activeElement; return { focused: b?.classList.contains('d-more'), expanded: b?.getAttribute('aria-expanded'), text: b?.textContent } })
  check('Show all shows every test, by keyboard, keeping the focus', (await sections()).find(s => s.head.startsWith('Made by tests')).rows.every(r => r.shown) && opened.focused && opened.expanded === 'true' && opened.text === 'Show the first 8', JSON.stringify(opened))
  await shot('1-endpoint-pages-and-tests')
  await page.keyboard.press('Enter')
  check('and closes it again', (await sections()).find(s => s.head.startsWith('Made by tests')).rows.filter(r => r.shown).length === 8)

  // The architecture: the page's file lists what it called, a jump to the file that serves it.
  await open()
  await selectWhere("e.metadata?.path === 'web/src/pages/Orders.tsx'")
  const pg = await sections()
  const calls = pg.find(s => s.head.startsWith('Calls in tests'))
  check('a page lists the endpoints it called, with the file that serves each', calls?.head === 'Calls in tests · 1' && /^GET \/api\/ordersOrderController\.java · ×50$/.test(calls.rows[0].text) && calls.rows[0].button && /\/orders\/:id/.test(await page.evaluate(() => document.querySelector('#details .d-callers .d-hint').textContent)), JSON.stringify(calls))
  await shot('2-page-calls')
  const went = await page.evaluate(async () => {
    document.querySelector('#details .d-callers button.d-rel').click()
    await new Promise(r => setTimeout(r, 1200))
    const s = window.__spike
    return s.tree.els[s.renderer.selected]?.metadata?.path
  })
  check('an endpoint in that list goes to its handler', went === 'server/src/main/java/com/shop/orders/OrderController.java', went)
  // A page no request came from lists nothing.
  await selectWhere("e.metadata?.path === 'web/src/pages/Home.tsx'")
  check('a page no test used lists nothing', (await sections()).length === 0)

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  rmSync(scratch, { recursive: true, force: true })
  rmSync(join('imports', NAME), { recursive: true, force: true })
  for (const f of [`${NAME}.json`, `${NAME}.requests.json`]) rmSync(join('public/models', f), { force: true })
  writeIndex()
}
const failed = Object.entries(results).filter(([, v]) => v !== 'pass')
console.log(`${Object.keys(results).length - failed.length}/${Object.keys(results).length} pass`)
if (failed.length) process.exitCode = 1
