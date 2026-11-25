// Black-box checks that the map never gives a wrong answer: what the details panel lists is
// what the map shows, Back returns to the place before, and opening code lands on the card and
// line asked for. Runs against uploaded maps (knights-of-darkness, petclinic); a map that is not
// uploaded here is a failure, not a skip. knights-of-darkness is expected published with --trace (zoom trace of its
// acceptance tests), as the map-repo skill does.
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

  // 4b'. A click on a stretch several arrows share lists them all, heaviest first, as the hover
  // tooltip names them; picking one, by keyboard too, opens that arrow with the relations it carried;
  // Esc goes back to the list, then to where it started. Also over a selection, which regroups the map.
  const trunkAt = () => page.evaluate(() => {
    const s = window.__spike
    for (const l of s.renderer.lines) for (let k = 2; k < l.pts.length; k += 2) for (const u of [0.25, 0.5, 0.75]) {
      const x = l.pts[k - 2] + (l.pts[k] - l.pts[k - 2]) * u, y = l.pts[k - 1] + (l.pts[k + 1] - l.pts[k - 1]) * u
      if (s.renderer.pick(x, y) > 0) continue
      const here = s.renderer.linesAt(x, y)
      if (here.length > 1) return { at: [x, y], pairs: here.map(h => [h.s, h.t].sort().join()).sort() }
    }
    return null
  })
  const listShown = () => page.evaluate(() => ({ kind: document.querySelector('#details .d-kind')?.textContent, rows: [...document.querySelectorAll('#details .d-lines button')].map(b => ({ text: b.querySelector('b').textContent, n: Number(b.querySelector('span').textContent.split(' ')[0]) })), drawnPicked: window.__spike.renderer.edge }))
  for (const [where, q, sel] of [['the landscape', 'model=knights-of-darkness', null], ['War selected inside Game server', 'model=knights-of-darkness&in=backend', 'backend.military']]) {
    await open(q)
    if (sel) { await page.evaluate(id => window.__spike.select(window.__spike.id(id)), sel); await sleep(700) }
    const trunk = await trunkAt()
    if (trunk) { await page.mouse.click(trunk.at[0], trunk.at[1]); await sleep(400) }
    const listed = await listShown()
    const sorted = listed.rows.every((r, k) => k === 0 || listed.rows[k - 1].n >= r.n)
    check(`on ${where}, a click on a shared trunk lists every arrow there, heaviest first, none drawn as picked yet`, !!trunk && listed.kind === 'Arrows' && listed.rows.length === trunk.pairs.length && sorted && listed.drawnPicked === null, JSON.stringify({ trunk, listed }))
    if (!listed.rows.length) continue
    // By keyboard: focus the first row, Enter.
    await page.evaluate(() => document.querySelector('#details .d-lines button').focus())
    await page.keyboard.press('Enter')
    await sleep(300)
    const opened = await page.evaluate(() => ({ kind: document.querySelector('#details .d-kind')?.textContent, title: document.querySelector('#details h2')?.textContent, rels: document.querySelectorAll('#details .d-edge li').length, focus: document.activeElement?.tagName }))
    check(`on ${where}, picking an arrow from the list by keyboard opens it with the relations it carried, focus on its heading`, opened.kind === 'Arrow' && opened.title === listed.rows[0].text && opened.rels === listed.rows[0].n && opened.focus === 'H2', JSON.stringify({ first: listed.rows[0], opened }))
    await page.keyboard.press('Escape')
    await sleep(200)
    const backToList = await page.evaluate(() => document.querySelector('#details .d-kind')?.textContent)
    await page.keyboard.press('Escape')
    await sleep(300)
    const backOut = await page.evaluate(() => ({ kind: document.querySelector('#details .d-kind')?.textContent, at: new URLSearchParams(location.search).get('at') }))
    check(`on ${where}, Esc goes back to the list, then to where it started`, backToList === 'Arrows' && backOut.kind !== 'Arrows' && backOut.kind !== 'Arrow' && backOut.at === sel, JSON.stringify({ backToList, backOut }))
  }

  // 4b''. By keyboard: a Uses row opens the same arrow panel, and Esc comes back to the selection.
  await open('model=knights-of-darkness&at=backend')
  await page.evaluate(() => document.querySelector('#details .d-rels.out .d-inspect').focus())
  await page.keyboard.press('Enter')
  await sleep(300)
  const inspected = await page.evaluate(() => ({ kind: document.querySelector('#details .d-kind')?.textContent, title: document.querySelector('#details h2')?.textContent, focus: document.activeElement?.tagName, rels: document.querySelectorAll('#details .d-edge li').length }))
  check('a Uses row inspects the arrow by keyboard: every relation, focus on its heading', inspected.kind === 'Arrow' && inspected.title === 'Game server ↔ Game database' && inspected.focus === 'H2' && inspected.rels >= 15, JSON.stringify(inspected))
  await page.keyboard.press('Escape')
  await sleep(300)
  const returned = await page.evaluate(() => ({ title: document.querySelector('#details h2')?.textContent, kind: document.querySelector('#details .d-kind')?.textContent, focus: document.activeElement?.tagName }))
  check('Esc puts the arrow down and returns to the selection it was inspected from', returned.title === 'Game server' && returned.focus === 'H2', JSON.stringify(returned))

  // 4c. Arrows say what kind they are, and a picked arrow says why it exists, line by line.
  await page.evaluate(() => { localStorage.removeItem('zoom.showTypes') })
  await open('model=knights-of-darkness&in=backend')
  const legend = await page.evaluate(() => [...document.querySelectorAll('#arrows span, #arrows button:not(.a-toggle)')].map(e => e.textContent))
  check('the arrow legend names code uses, runtime calls, calls not seen in tests, and type-only imports', ['uses in code', 'calls at runtime', 'calls not seen in tests', 'type-only imports', 'Show'].every(t => legend.includes(t)), JSON.stringify(legend))
  // The trace watches only the parts where code ran in the tests: a call into them from outside
  // (the test client, the browser, a person) is drawn plain and says so when picked.
  await open('model=knights-of-darkness')
  const outside = await page.evaluate(() => {
    const s = window.__spike, t = s.tree
    const line = s.renderer.lines.find(l => [t.els[l.s].id, t.els[l.t].id].sort().join() === 'backend,devtools')
    if (!line) return null
    return { dashed: line.dashed }
  })
  // Its evidence, opened from Development tools' Uses row (the line shares its whole route here).
  await page.evaluate(() => window.__spike.select(window.__spike.id('devtools')))
  await sleep(300)
  await page.evaluate(() => [...document.querySelectorAll('#details .d-rels.out li')].find(li => /Game server/.test(li.textContent))?.querySelector('.d-inspect')?.click())
  await sleep(400)
  const picked = await page.evaluate(() => document.getElementById('details').textContent)
  check('a call from outside the traced parts is drawn plain and its arrow says it is outside the trace', outside?.dashed === false && /outside the trace/.test(picked) && !/not seen in tests/.test(picked.replace(/outside the trace/g, '')), JSON.stringify({ outside, picked: picked.slice(0, 160) }))
  await page.keyboard.press('Escape')
  await open('model=knights-of-darkness&in=backend')
  const types = async () => page.evaluate(() => window.__spike.tree.relKind.filter(k => k === 'types').length)
  const hidden = await types()
  await page.click('#arrows button:not(.a-toggle)')
  await page.waitForFunction(() => window.__spike.tree.relKind.includes('types'), { timeout: 15000 }).catch(() => {})
  const shown = await types()
  check('type-only imports are hidden until shown, then drawn', hidden === 0 && shown > 0, JSON.stringify({ hidden, shown }))
  await page.click('#arrows button:not(.a-toggle)')
  await page.waitForFunction(() => !window.__spike.tree.relKind.includes('types'), { timeout: 15000 }).catch(() => {})
  await landed()
  // A point on a drawn line, off the cards.
  const spot = await page.evaluate(async () => {
    const s = window.__spike
    s.select(-1)
    await new Promise(r => setTimeout(r, 300))
    for (const l of s.renderer.lines) for (let k = 2; k < l.pts.length; k += 2) {
      const x = (l.pts[k - 2] + l.pts[k]) / 2, y = (l.pts[k - 1] + l.pts[k + 1]) / 2
      // A stretch only this arrow runs along: a shared trunk lists its arrows instead (4b').
      const here = s.renderer.linesAt(x, y)
      if (s.renderer.hoverAt(x, y) <= 0 && here.length === 1 && here[0] === l) return [x, y]
    }
    return null
  })
  if (spot) { await page.mouse.move(spot[0], spot[1]); await page.mouse.down(); await page.mouse.up() }
  await sleep(300)
  const arrow = await page.evaluate(() => ({ kind: document.querySelector('#details .d-kind')?.textContent, rows: document.querySelectorAll('#details .d-edge li').length, lines: document.querySelectorAll('#details .d-why .cite').length, picked: !!window.__spike.renderer.edge }))
  check('clicking an arrow lists every relation it carries, with the lines that make it', arrow.kind === 'Arrow' && arrow.rows > 0 && arrow.lines > 0 && arrow.picked, JSON.stringify({ spot, ...arrow }))
  await shot('04c-arrow-picked')
  const line = await page.evaluate(async () => {
    const b = document.querySelector('#details .d-why .cite'), want = b.textContent.replace('line ', '')
    const names = b.closest('li').querySelector('.d-names')?.textContent ?? ''
    b.click()
    for (let k = 0; k < 200 && document.querySelector('.reader').hidden; k++) await new Promise(r => setTimeout(r, 25))
    await new Promise(r => setTimeout(r, 200))
    const at = document.querySelector('.reader pre .at')
    return { want, at: at?.querySelector('i')?.textContent.trim(), text: at?.textContent ?? '', names }
  })
  const named = line.names.split(/[, +]+/).filter(n => /^[A-Za-z_]/.test(n))
  check('a line of an arrow opens the code that makes it', line.want === line.at && named.some(n => line.text.includes(n)), JSON.stringify(line))
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__spike.renderer.edge && document.querySelector('#stage canvas').focus())
  await page.keyboard.press('Escape')
  await sleep(100)

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
