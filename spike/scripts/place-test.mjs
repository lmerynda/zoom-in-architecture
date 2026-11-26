// Black-box checks that the viewer keeps your place: the address names it, a link opens there,
// the browser's Back and Forward move between places, a view switch keeps the subject, and a file
// opens to read in one scrolling column, at the line asked for.
// usage: node scripts/place-test.mjs [outDir]   (dev server running)
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'shots/place'
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
mkdirSync(outDir, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  // Software GL: headless Chrome on the GPU stalls mid-flight on some machines; these checks need no speed.
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shot = name => page.screenshot({ path: join(outDir, `${name}.png`) })
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(ok ? 'pass' : 'FAIL', name, ok ? '' : detail) }
const ready = async () => {
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => { try { localStorage.setItem('zoom.introSeen', '1') } catch { /* */ } })
  await sleep(300)
}
const open = async q => { await page.goto(`${base}?${q}`, { waitUntil: 'load' }); await ready() }
const landed = async () => { await page.waitForFunction(() => !window.__spike.cam.flying, { timeout: 30000 }); await sleep(400) }
const selected = () => page.evaluate(() => { const s = window.__spike, i = s.renderer.selected; return i > 0 ? s.tree.els[i].id : null })
const query = () => page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)))

try {
  await open('model=knights-of-darkness')

  // The address names the selection once the view settles.
  await page.evaluate(() => { const s = window.__spike; s.controls.goSelect(s.id('backend.military')) })
  await landed()
  await sleep(400)
  check('the address names the selection', (await query()).at === 'backend.military', JSON.stringify(await query()))

  // A second place, then the browser's Back returns to the first and Forward to the second.
  await page.evaluate(() => { const s = window.__spike; s.controls.goSelect(s.id('backend.kingdom')) })
  await landed()
  await sleep(400)
  await page.goBack()
  await landed()
  check('the browser\'s Back returns to the previous place', (await selected()) === 'backend.military', String(await selected()))
  await page.goForward()
  await landed()
  check('Forward returns to the later place', (await selected()) === 'backend.kingdom', String(await selected()))

  // A link opens where it names: reloading keeps the place.
  await page.reload({ waitUntil: 'load' })
  await ready()
  const reloaded = await page.evaluate(() => { const s = window.__spike, i = s.renderer.selected, r = s.renderer.screenRectOf(i); return { id: i > 0 ? s.tree.els[i].id : null, onScreen: r[0] >= 0 && r[0] + r[2] <= s.cam.w } })
  check('a link opens at the place it names', reloaded.id === 'backend.kingdom' && reloaded.onScreen, JSON.stringify(reloaded))

  // The view switch keeps the subject.
  await sleep(400)
  // Connections is no view of its own: Architecture lays out by coupling from its Layout menu.
  const views = await page.evaluate(() => [...document.querySelectorAll('#views > a')].map(a => a.textContent))
  check('the views are Architecture and Requests; coupling is a layout of Architecture', views.join(',') === 'Architecture,Requests', JSON.stringify(views))
  const href = await page.evaluate(() => [...document.querySelectorAll('.layout-menu a')].find(a => a.textContent === 'By coupling').href)
  check('the By coupling layout link carries the selection', href.includes('layout=coupling') && href.includes('at=backend.kingdom'), href)
  await page.goto(href, { waitUntil: 'load' })
  await ready()
  check('switching view keeps the subject', (await selected()) === 'backend.kingdom', String(await selected()))

  // Reading a file: Enter opens it in one scrolling column, at its start, named with its path and line.
  await open('model=knights-of-darkness')
  const file = await page.evaluate(() => {
    const s = window.__spike, t = s.tree
    let best = -1
    for (let i = 1; i < t.size; i++) if (t.els[i].metadata?.path && Number(t.els[i].metadata.lines) > 120) { best = i; break }
    s.controls.goSelect(best)
    return { id: t.els[best].id, path: t.els[best].metadata.path }
  })
  await landed()
  await page.evaluate(() => document.querySelector('#stage canvas').focus())
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.reader').hidden && document.querySelectorAll('.reader pre > span').length > 0, { timeout: 15000 })
  await sleep(300)
  const reader = await page.evaluate(() => {
    const r = document.querySelector('.reader'), sc = r.querySelector('.reader-scroll')
    return { where: r.querySelector('.reader-where').textContent, scrolls: sc.scrollHeight > sc.clientHeight, select: getComputedStyle(r.querySelector('pre')).userSelect, minimap: getComputedStyle(document.getElementById('minimap')).display }
  })
  await shot('01-reader')
  check('Enter opens the file to read, named by path', reader.where.startsWith(file.path), JSON.stringify(reader))
  check('the code scrolls natively and its text is selectable', reader.scrolls && reader.select !== 'none', JSON.stringify(reader))
  check('the minimap steps aside while reading', reader.minimap === 'none', reader.minimap)

  // Scrolling moves the named line; the address follows; Esc closes and keeps the selection.
  await page.evaluate(() => { document.querySelector('.reader-scroll').scrollTop = 20 * 60 })
  await sleep(1200)
  const scrolled = Number((await page.evaluate(() => document.querySelector('.reader-where').textContent)).split(':').pop())
  check('the header names the line scrolled to', scrolled > 60, String(scrolled))
  check('the address names the file and line', (await query()).line === String(scrolled), JSON.stringify(await query()))
  await page.keyboard.press('Escape')
  await sleep(200)
  check('Esc closes the code and keeps the selection', await page.evaluate(() => document.querySelector('.reader').hidden) && (await selected()) === file.id)

  // A cited line opens the reader at that line.
  const cite = await page.evaluate(async () => {
    const s = window.__spike, t = s.tree
    for (let i = 1; i < t.size; i++) {
      if (t.children[i].length) continue
      s.select(i)
      const toggle = document.querySelector('#details .d-cite')
      if (!toggle) continue
      toggle.click()
      const b = document.querySelector('#details .d-ev .cite')
      if (!b) continue
      const want = b.title.match(/:(\d+)/)[1]
      b.click()
      for (let k = 0; k < 200 && document.querySelector('.reader').hidden; k++) await new Promise(r => setTimeout(r, 25))
      await new Promise(r => setTimeout(r, 200))
      return { want, at: document.querySelector('.reader pre .at i')?.textContent.trim(), where: document.querySelector('.reader-where').textContent.split(':').pop() }
    }
    return null
  })
  await shot('02-cited')
  check('a cited line opens the reader at that line, named in its header', !!cite && cite.want === cite.at && cite.where === cite.want, JSON.stringify(cite))
  await page.keyboard.press('Escape')

  // Requests: an endpoint's steps read in order, left to right and down, and its handler opens at
  // its method's first line, not at the route annotation or line 1.
  await open('model=knights-of-darkness&view=requests')
  const lane = await page.evaluate(async () => {
    const s = window.__spike, t = s.tree
    const ep = t.els.findIndex(e => e.title === 'POST /kingdom/pass-turn')
    const steps = t.children[ep].filter(k => t.els[k].metadata?.role === 'step').sort((a, b) => t.els[a].metadata.step - t.els[b].metadata.step)
    const r = s.world.rect, key = k => [Math.round(r[k * 4 + 1]), r[k * 4]]
    const ordered = steps.every((k, j) => !j || (key(k)[0] > key(steps[j - 1])[0] || (key(k)[0] === key(steps[j - 1])[0] && key(k)[1] > key(steps[j - 1])[1])))
    s.select(steps[0])
    const span = t.els[steps[0]].metadata.span
    ;[...document.querySelectorAll('#details .d-actions button')].find(b => b.textContent === 'Read code').click()
    for (let k = 0; k < 200 && document.querySelector('.reader').hidden; k++) await new Promise(r => setTimeout(r, 25))
    await new Promise(r => setTimeout(r, 200))
    return { steps: steps.length, ordered, span, at: document.querySelector('.reader pre .at i')?.textContent.trim() }
  })
  check('an endpoint’s steps read in order', lane.steps > 1 && lane.ordered, JSON.stringify(lane))
  check('a handler opens at its method, not the route line', lane.span?.startsWith('166-') && lane.at === '166', JSON.stringify(lane))
  await shot('03-request-step')
  await page.keyboard.press('Escape')
  await open('model=knights-of-darkness')

  // The wheel never stops silently: zooming in over a file at its limit says how to read it.
  await page.evaluate(() => { const s = window.__spike; s.select(-1) })
  const [fx, fy] = await page.evaluate(id => { const s = window.__spike, i = s.id(id); s.fit(i); return [0, 0] }, file.id)
  await landed()
  const [cx, cy] = await page.evaluate(id => { const s = window.__spike, r = s.renderer.screenRectOf(s.id(id)); return [r[0] + r[2] / 2, r[1] + r[3] * 0.7] }, file.id)
  await page.mouse.move(cx, cy)
  for (let k = 0; k < 60; k++) { await page.mouse.wheel({ deltaY: -400 }); await sleep(20) }
  await sleep(300)
  const said = await page.evaluate(() => document.querySelector('.toast').textContent)
  check('the wheel at its limit over a file says how to read it', /read/i.test(said), said)
  void fx; void fy

  // A long file filling the screen while its code is only a thumbnail says what it is and how to read it.
  const cap = await page.evaluate(async () => {
    const s = window.__spike, t = s.tree, r = s.world.rect
    const i = t.els.findIndex(e => Number(e.metadata?.lines) > 500)
    s.select(-1)
    s.cam.set(r[i * 4] + r[i * 4 + 2] / 2, r[i * 4 + 1] + r[i * 4 + 3] * 0.7, (s.cam.w * 0.8) / r[i * 4 + 2])
    for (let k = 0; k < 120 && ![...document.querySelectorAll('.code-cap')].some(c => !c.hidden); k++) await new Promise(r => setTimeout(r, 50))
    return [...document.querySelectorAll('.code-cap')].find(c => !c.hidden)?.textContent ?? null
  })
  check('a file too small to read names its path, size and how to read it', !!cap && /lines/.test(cap) && /Enter to read/.test(cap), String(cap))

  // Empty space offers a way back to the whole map.
  await page.evaluate(() => { const s = window.__spike, c = s.cam; c.set(c.x + 1e6, c.y + 1e6, c.z) })
  await sleep(500)
  const empty = await page.evaluate(() => !document.getElementById('empty').hidden)
  if (empty) await page.click('#fitall')
  await landed()
  const whole = await page.evaluate(() => window.__spike.renderer.breadcrumb().length === 0 && window.__spike.last().inView > 0)
  check('empty space shows Fit whole map, and it works', empty && whole, JSON.stringify({ empty, whole }))

  // Search to a part puts the old selection down: the panel, the address and a reload all name the
  // part found, and Back brings the old selection back.
  await open('model=knights-of-darkness&at=devtools')
  await landed()
  await page.evaluate(() => document.querySelector('#stage canvas').focus())
  await page.keyboard.press('/')
  await page.keyboard.type('War')
  await sleep(300)
  const warRow = await page.evaluate(() => document.querySelector('.palette .row.on b')?.textContent)
  await page.keyboard.press('Enter')
  await landed()
  await sleep(400)
  const foundQ = await page.evaluate(() => ({ at: new URLSearchParams(location.search).get('at'), in: new URLSearchParams(location.search).get('in'), panel: document.querySelector('#details h2')?.textContent }))
  check('search to a part puts the old selection down: panel and address name the part found', warRow === 'War' && foundQ.at === null && foundQ.in === 'backend.military' && foundQ.panel === 'War', JSON.stringify({ warRow, ...foundQ }))
  await page.reload({ waitUntil: 'load' })
  await ready()
  await landed()
  const reopened = await page.evaluate(() => ({ crumb: window.__spike.renderer.breadcrumb().map(i => window.__spike.tree.els[i].id).at(-1), selected: window.__spike.renderer.selected }))
  check('a reload reopens the part found, not the old selection', reopened.crumb === 'backend.military' && reopened.selected <= 0, JSON.stringify(reopened))
  await page.evaluate(() => document.querySelector('#stage canvas').focus())
  await page.keyboard.press('Backspace')
  await landed()
  await sleep(300)
  check('Back brings the old selection back', await page.evaluate(() => new URLSearchParams(location.search).get('at') === 'devtools'))

  // The reader's "← back to <parent>" goes to the card it names, selected; Close stays on the file.
  await open('model=knights-of-darkness&file=backend/src/main/java/com/knightsofdarkness/web/market/MarketController.java&line=67')
  await page.waitForFunction(() => !document.querySelector('.reader').hidden, { timeout: 15000 })
  const backText = await page.evaluate(() => document.querySelector('.reader-back').textContent)
  await page.click('.reader-back')
  await landed()
  await sleep(300)
  const backAt = await page.evaluate(() => ({ reader: document.querySelector('.reader').hidden, at: new URLSearchParams(location.search).get('at'), title: document.querySelector('#details h2')?.textContent }))
  check('"← back to <parent>" closes the reader and selects the parent it names', backAt.reader && backText === `← back to ${backAt.title}` && backAt.at !== null && !backAt.at.endsWith('marketController'), JSON.stringify({ backText, ...backAt }))

  // In Requests, the reader's three ways out: back goes to the endpoint, Close and Esc stay on the step.
  const readStep = async () => {
    await open('model=knights-of-darkness&view=requests&at=backend.market.e1.s1')
    await landed()
    await page.evaluate(() => document.querySelector('#stage canvas').focus())
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => !document.querySelector('.reader').hidden, { timeout: 15000 })
    return page.evaluate(() => document.querySelector('.reader-back').textContent)
  }
  const atNow = () => page.evaluate(() => ({ reader: document.querySelector('.reader').hidden, at: new URLSearchParams(location.search).get('at') }))
  const stepBack = await readStep()
  await page.click('.reader-back')
  await landed()
  const viaBack = await atNow()
  await readStep()
  await page.click('.reader-close')
  await sleep(300)
  const viaClose = await atNow()
  await readStep()
  await page.keyboard.press('Escape')
  await sleep(300)
  const viaEsc = await atNow()
  check('in Requests, back goes to the endpoint it names; Close and Esc stay on the step', /← back to POST \/market\/\{id\}\/buy/.test(stepBack) && viaBack.reader && viaBack.at === 'backend.market.e1' && viaClose.reader && viaClose.at === 'backend.market.e1.s1' && viaEsc.reader && viaEsc.at === 'backend.market.e1.s1', JSON.stringify({ stepBack, viaBack, viaClose, viaEsc }))

  // A phone, with the pointer resting on the outline bar (which opens under it): search to a part
  // still names that part, because the bar frames as the bar it is at rest.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await open('model=knights-of-darkness&at=devtools')
  await landed()
  await page.mouse.move(200, 820)
  await page.evaluate(() => document.querySelector('#stage canvas').focus())
  await page.keyboard.press('/')
  await page.keyboard.type('War')
  await sleep(300)
  await page.keyboard.press('Enter')
  await landed()
  await sleep(600)
  const phone = await page.evaluate(() => ({ in: new URLSearchParams(location.search).get('in'), panel: document.querySelector('#details h2')?.textContent }))
  check('on a phone, with the outline bar open under the pointer, search to a part names that part', phone.in === 'backend.military' && phone.panel === 'War', JSON.stringify(phone))
  await page.setViewport({ width: 1600, height: 1000 })
} catch (e) {
  failed++
  console.log('FAIL', e.stack ?? e)
} finally {
  if (errors.length) { failed++; console.log('FAIL page errors', errors.slice(0, 5)) }
  await browser.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
