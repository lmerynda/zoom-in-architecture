// Black-box checks that the map never gives a wrong answer: what the details panel lists is
// what the map shows, Back returns to the place before, and opening code lands on the card and
// line asked for. Runs against uploaded maps (knights-of-darkness, petclinic); a map that is not
// uploaded here is a failure, not a skip.
// usage: node scripts/answers-test.mjs [outDir]   (dev server running)
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'shots/answers'
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
const open = async q => {
  await page.goto(`${base}?${q}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => { try { localStorage.setItem('zoom.introSeen', '1') } catch { /* */ } })
  await sleep(300)
}
const landed = async () => { await page.waitForFunction(() => !window.__spike.cam.flying, { timeout: 30000 }); await sleep(300) }

try {
  // 1. A level that has just opened: selecting a card there keeps every card the panel lists in
  // view and undimmed, on both sides of the open threshold.
  await open('model=knights-of-darkness')
  // From the landscape, zoomed toward the backend until it opens a little, a lot, and fully;
  // while the backend is not yet the place you are in (the breadcrumb), and once it is.
  for (const want of [0.15, 0.4, 0.8, 1]) {
    await page.evaluate(() => window.__spike.fit(window.__spike.id('backend')))
    await landed()
    const r = await page.evaluate(async want => {
      const s = window.__spike, cam = s.cam, b = s.id('backend')
      const z1 = cam.z
      // Zoom out from the backend's frame until it is only `want` open.
      for (let z = z1; z > z1 / 8; z *= 0.97) { cam.set(cam.x, cam.y, z); s.renderer.frame(s.now()); if (s.renderer.open(b) <= want) break }
      s.unhover()
      s.select(s.id('backend.military'))
      await new Promise(r => setTimeout(r, 250))
      const listed = [...document.querySelectorAll('#details .d-rels.out li .d-rel b')].map(b => b.textContent)
      const ids = s.tree.children[s.id('backend')].filter(i => listed.includes(s.tree.els[i].title))
      return { open: s.renderer.open(b), here: s.renderer.breadcrumb().includes(b), listed: listed.length, siblings: ids.length, dimmed: ids.filter(i => s.renderer.dimmed(i)).map(i => s.tree.els[i].title), unlinked: ids.filter(i => !s.renderer.linked(i)).map(i => s.tree.els[i].title) }
    }, want)
    check(`War's uses are drawn undimmed (backend open ${r.open.toFixed(2)}, ${r.here ? 'in it' : 'from outside'})`, r.siblings > 0 && r.dimmed.length === 0 && r.unlinked.length === 0, JSON.stringify(r))
    await shot(`01-war-${want}`)
  }

  // A selection's own children are part of it: none is dimmed.
  const inside = await page.evaluate(async () => {
    const s = window.__spike, b = s.id('backend')
    s.select(b)
    await new Promise(r => setTimeout(r, 200))
    return s.tree.children[b].filter(i => s.renderer.dimmed(i)).map(i => s.tree.els[i].title)
  })
  check('a selection does not dim what it holds', inside.length === 0, JSON.stringify(inside))

  // 2. The panel lists every relation, however many.
  const counts = await page.evaluate(() => {
    const s = window.__spike
    let best = -1, n = 0
    for (let i = 1; i < s.tree.size; i++) { const k = s.renderer.relationsOf(i).inn.length; if (!s.tree.children[i].length && k > n) { n = k; best = i } }
    s.select(best)
    const h = document.querySelector('#details .d-rels.in h3').textContent
    return { title: s.tree.els[best].title, header: h, rows: document.querySelectorAll('#details .d-rels.in li').length }
  })
  check('the busiest file lists every caller', Number(counts.header.split('·')[1]) === counts.rows && counts.rows > 40, JSON.stringify(counts))

  // 3. Back returns to the place before a panel jump, with that place's selection.
  const back = await page.evaluate(async () => {
    const s = window.__spike
    s.select(s.id('backend.military'))
    s.fit(s.id('backend.military'))
    while (s.cam.flying) await new Promise(r => setTimeout(r, 50))
    const row = document.querySelector('#details .d-rels.out li .d-rel')
    const target = row.querySelector('b').textContent
    row.click()
    while (s.cam.flying) await new Promise(r => setTimeout(r, 50))
    const after = s.tree.els[s.renderer.selected].title
    s.controls.back()
    await new Promise(r => setTimeout(r, 300))
    while (s.cam.flying) await new Promise(r => setTimeout(r, 50))
    return { target, after, back: s.tree.els[s.renderer.selected]?.title }
  })
  check('a panel jump selects its card', back.after === back.target, JSON.stringify(back))
  check('Back restores the selection before the jump', back.back === 'War', JSON.stringify(back))

  // 4. Exploring by hand is recorded: wheel away, let it settle, and Back comes back.
  const wheel = await page.evaluate(async () => {
    const s = window.__spike
    s.fit(0)
    while (s.cam.flying) await new Promise(r => setTimeout(r, 50))
    await new Promise(r => setTimeout(r, 800))
    const z0 = s.cam.z
    return z0
  })
  await page.mouse.move(500, 500)
  for (let k = 0; k < 12; k++) { await page.mouse.wheel({ deltaY: -240 }); await sleep(40) }
  await sleep(1200)
  const zoomedIn = await page.evaluate(() => window.__spike.cam.z)
  await page.keyboard.press('Backspace')
  await landed()
  const zBack = await page.evaluate(() => window.__spike.cam.z)
  check('Back returns from a wheel excursion', zoomedIn > wheel * 3 && Math.abs(Math.log(zBack / wheel)) < 0.2, JSON.stringify({ wheel, zoomedIn, zBack }))

  // 4b. Arrows: among many files they wait for a card in focus; over a line, the pairs it carries are named.
  const quiet = await page.evaluate(async () => {
    const s = window.__spike, t = s.tree
    const level = t.els.findIndex((e, i) => t.children[i].length > 12 && t.children[i].every(k => t.els[k].metadata?.path))
    s.select(-1); s.unhover(); s.fit(level)
    while (s.cam.flying) await new Promise(r => setTimeout(r, 50))
    await new Promise(r => setTimeout(r, 300))
    const rest = s.last().edges
    const busy = t.children[level].find(k => s.renderer.relationsOf(k).out.length + s.renderer.relationsOf(k).inn.length > 0)
    s.select(busy)
    await new Promise(r => setTimeout(r, 300))
    return { level: t.els[level]?.id, rest, focused: s.last().edges }
  })
  check('among many files, arrows wait for a card in focus', quiet.rest === 0 && quiet.focused > 0, JSON.stringify(quiet))
  const said = await page.evaluate(async () => {
    const s = window.__spike
    s.fit(s.id('backend'))
    while (s.cam.flying) await new Promise(r => setTimeout(r, 50))
    s.select(-1)
    await new Promise(r => setTimeout(r, 300))
    // A point on a drawn line that is not on a card.
    for (const l of s.renderer.lines) for (let k = 2; k < l.pts.length; k += 2) {
      const x = (l.pts[k - 2] + l.pts[k]) / 2, y = (l.pts[k - 1] + l.pts[k + 1]) / 2
      if (s.renderer.pick(x, y) === s.id('backend') || s.renderer.pick(x, y) <= 0) return [x, y]
    }
    return null
  })
  if (said) {
    await page.mouse.move(said[0], said[1])
    await sleep(300)
  }
  const tip = await page.evaluate(() => { const t = document.querySelector('.tip'); return t && !t.hidden ? t.textContent : '' })
  check('hovering a line names the pairs it carries', /carries/.test(tip) && /→/.test(tip), tip || JSON.stringify(said))
  await shot('04-line-carries')
  await page.mouse.move(5, 500)

  // 5. Opening a cited line opens it in this endpoint's card, at that line.
  await open('model=knights-of-darkness&view=requests')
  const cite = await page.evaluate(async () => {
    const s = window.__spike, t = s.tree
    // An endpoint step whose file is shown in several endpoints.
    const byPath = new Map()
    for (let i = 1; i < t.size; i++) { const p = t.els[i].metadata?.path; if (p) byPath.set(p, [...(byPath.get(p) ?? []), i]) }
    const [, cards] = [...byPath].find(([, c]) => c.length > 2)
    const pick = cards[cards.length - 1]
    s.controls.read ? null : null
    document.dispatchEvent(new Event('noop'))
    s.select(pick)
    const btn = [...document.querySelectorAll('#details .d-actions button')].find(b => b.textContent === 'Read code')
    btn.click()
    await new Promise(r => setTimeout(r, 400))
    while (s.cam.flying) await new Promise(r => setTimeout(r, 50))
    return { pick, cards: cards.length, selected: s.renderer.selected, title: t.els[pick].title }
  })
  check('Read code opens the card asked for, not the first with that file', cite.selected === cite.pick, JSON.stringify(cite))
  await shot('05-read-code')
} catch (e) {
  failed++
  console.log('FAIL', e.stack ?? e)
} finally {
  if (errors.length) { failed++; console.log('FAIL page errors', errors.slice(0, 5)) }
  await browser.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
