// Black-box checks of the Problems view: the outline's list, a problem's arrow and why it is listed,
// the warning mark on the map, ] and [ through problems, and where there are none.
// usage: node scripts/problems-test.mjs [outDir]   (dev server running; SPIKE_URL names it)
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'shots/problems'
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
mkdirSync(outDir, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error' && !/404|Outdated Optimize Dep|dynamically imported module/.test(m.text())) errors.push(m.text()) })
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('zoom.introSeen', '1') } catch { /* */ } })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shot = name => page.screenshot({ path: join(outDir, `${name}.png`) })
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(ok ? 'pass' : 'FAIL', name, ok ? '' : detail) }
const open = async q => {
  await page.goto(`${base}?${q}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await sleep(400)
}
const landed = async () => { await page.waitForFunction(() => !window.__spike.cam.flying, { timeout: 30000 }); await sleep(400) }
const focusMap = () => page.evaluate(() => document.querySelector('#stage canvas').focus())
const key = async k => { await focusMap(); await page.keyboard.press(k); await sleep(150); await landed() }
/** A key pressed where focus is now (the panel, after a row was opened). */
const press = async k => { await page.keyboard.press(k); await sleep(150); await landed() }
/** What the panel and the map say about problems now. */
const state = () => page.evaluate(() => {
  const s = window.__spike, r = s.renderer, d = document.getElementById('details')
  const note = d.querySelector('.d-problem')
  return {
    summary: d.querySelector('.d-problems > summary')?.textContent ?? null,
    listOpen: d.querySelector('.d-problems')?.open ?? null,
    rows: d.querySelectorAll('.d-problems li:not([hidden]) button').length,
    note: note?.querySelector('.d-kindtag')?.textContent ?? null,
    why: note?.querySelector('p')?.textContent ?? null,
    heading: d.querySelector('h2')?.textContent ?? null,
    cites: d.querySelectorAll('.d-edge .cite').length,
    flagged: [...d.querySelectorAll('.d-edge li.d-flagged')].map(li => ({ rel: Number(li.dataset.rel), first: li === li.parentElement.firstElementChild || li.previousElementSibling?.classList.contains('d-flagged'), tag: li.querySelector('.d-flag')?.textContent })),
    flaggedWant: s.problemAt >= 0 && s.problems.list[s.problemAt].kind !== 'coupling' ? s.problems.list[s.problemAt].rels.length : 0,
    warn: r.warn ? { all: r.warn.all.size, open: r.warn.open.size } : null,
    warnedLines: [...r.warnedLines().values()],
    // Drawn lines carrying the open problem's mark, and whether one runs above a phone's sheet.
    strongDrawn: (() => { const w = r.warnedLines(), n = s.tree.size; return r.lines.filter(l => w.get(Math.min(l.s, l.t) * n + Math.max(l.s, l.t)) === 2).length })(),
    strongAboveSheet: (() => { const w = r.warnedLines(), n = s.tree.size, top = d.getBoundingClientRect().top > innerHeight / 2 ? d.getBoundingClientRect().top : innerHeight; return r.lines.some(l => w.get(Math.min(l.s, l.t) * n + Math.max(l.s, l.t)) === 2 && l.pts.some((v, j) => j % 2 === 1 && v > 0 && v < top)) })(),
    drawnWarned: (() => { const w = r.warnedLines(), n = s.tree.size; return r.lines.filter(l => w.has(Math.min(l.s, l.t) * n + Math.max(l.s, l.t))).length })(),
    legend: !!document.querySelector('#arrows .a-problem'),
    at: s.problemAt,
    total: s.problems?.list.length ?? null,
    selected: r.selected,
    target: r.target,
    toast: document.querySelector('.toast')?.textContent ?? '',
  }
})

try {
  // Knights of Darkness: a game server whose parts use each other.
  await open('model=knights-of-darkness')
  let st = await state()
  check('the whole map’s outline ends with a folded Problems list naming how many', /^Problems · \d+$/.test(st.summary ?? '') && st.listOpen === false && st.total > 0 && st.summary === `Problems · ${st.total}`, JSON.stringify(st))
  check('folded, the map marks no problems', st.warn === null && !st.legend, JSON.stringify(st))

  await page.click('.d-problems > summary')
  await sleep(300)
  st = await state()
  check('open, it lists the problems and the map marks them all', st.listOpen && st.rows > 0 && st.warn?.all > 0 && st.warn.open === 0 && st.legend, JSON.stringify(st))
  const groups = await page.evaluate(() => [...document.querySelectorAll('.d-problems h4')].map(h => h.textContent))
  check('the list is grouped by kind, each with its count', groups.length >= 2 && groups.every(g => /^(Cycles|Against the grain|Heaviest couplings) · \d+$/.test(g)), JSON.stringify(groups))
  // Knights lists more than five cycles: the rest are one press away, and the first of them takes focus.
  const more = await page.$('.d-problems .d-more')
  check('a group of more than five offers Show more', !!more)
  const before = (await state()).rows
  await more?.click()
  await sleep(200)
  const sixth = await page.evaluate(() => ({ rows: document.querySelectorAll('.d-problems li:not([hidden]) button').length, focus: document.activeElement === document.querySelectorAll('.d-problems ul')[0]?.querySelectorAll('button')[5] }))
  check('Show more lists the rest of the group and focuses the sixth row', sixth.rows > before && sixth.focus, JSON.stringify({ before, ...sixth }))
  await shot('kod-list')

  // A row opens the problem: its two cards framed, its arrow in the panel with every cited line, and why.
  await page.click('.d-problems li button')
  await landed()
  st = await state()
  check('a row opens that problem’s arrow, with why it is listed above its relations and lines', st.note === `Problem 1 of ${st.total} · Cycle` && !!st.why && st.cites > 0 && /→|↔/.test(st.heading ?? ''), JSON.stringify(st))
  check('the open problem’s own line is drawn in the strong warning mark', st.warn?.open > 0 && st.strongDrawn > 0, JSON.stringify(st))
  check('its flagged uses lead their list, each tagged', st.flagged.length === st.flaggedWant && st.flagged.length > 0 && st.flagged.every(f => f.first && f.tag === 'flagged'), JSON.stringify(st.flagged))
  await shot('kod-problem-1')

  // ] and [ work from where focus is after opening a row (the panel's heading), not only the map.
  check('opening a row leaves focus in the panel', await page.evaluate(() => document.getElementById('details').contains(document.activeElement)))
  await press(']')
  st = await state()
  check('] from the panel opens the next problem', st.at === 1 && st.note?.startsWith(`Problem 2 of ${st.total}`) && /^Problem 2\//.test(st.toast), JSON.stringify(st))
  await press('[')
  st = await state()
  check('[ opens the one before', st.at === 0 && st.note?.startsWith('Problem 1 of'), JSON.stringify(st))
  await press('[')
  st = await state()
  check('[ from the first wraps to the last', st.at === st.total - 1, JSON.stringify(st))
  // The note's buttons do the same, for a screen with no keys.
  await page.click('.d-problem-nav button:nth-child(2)')
  await landed()
  st = await state()
  check('the note’s Next button opens the next problem', st.at === 0, JSON.stringify(st))
  // Back to the list: the whole map again, its outline, focus on the problem's row.
  await page.click('.d-problem-nav button:nth-child(3)')
  await landed()
  await sleep(500)
  const back = await page.evaluate(() => ({ here: window.__spike.renderer.breadcrumb().length, focus: document.activeElement?.dataset?.problem ?? document.activeElement?.tagName, note: !!document.querySelector('.d-problem') }))
  check('Back to the list returns to the whole map with focus on the problem’s row', back.here === 0 && back.focus === '0' && !back.note, JSON.stringify(back))

  // Esc from a problem opened with the keys: the outline there, focus on its row, the marks kept.
  await press(']')
  await press(']')
  await press('Escape')
  await sleep(300)
  st = await state()
  const escFocus = await page.evaluate(() => document.activeElement?.dataset?.problem ?? document.activeElement?.tagName)
  check('Esc puts the problem down: the outline, focus on its row, the list still marked', st.note === null && st.listOpen === true && st.warn?.open === 0 && st.warn.all > 0 && escFocus === '2', JSON.stringify({ ...st, escFocus }))
  await key(']')
  st = await state()
  check('] after Esc goes on from the last one opened', st.at === 3, JSON.stringify(st))
  await key('Escape')

  // A live update that keeps the problem keeps it open.
  await key(']')
  const kept = await page.evaluate(async () => {
    const s = window.__spike, before = s.problemAt
    await s.swapModel(await (await fetch('/models/knights-of-darkness.json')).json())
    return { before, after: s.problemAt, note: document.querySelector('.d-problem .d-kindtag')?.textContent }
  })
  check('a live update that keeps the problem keeps it open', kept.after === kept.before && kept.note?.startsWith(`Problem ${kept.before + 1} of`), JSON.stringify(kept))
  await key('Escape')

  // With a card selected, ] and [ still step through what it uses.
  await page.evaluate(() => window.__spike.select(window.__spike.id('backend.kingdom')))
  await sleep(200)
  await key(']')
  st = await state()
  check('with a card selected, ] steps its Uses, not problems', st.target > 0 && st.note === null && st.selected > 0, JSON.stringify(st))
  await key('Escape')
  await key('Escape')

  // Inside a part, the list holds only the problems at or under it, and the map marks only those.
  await page.evaluate(() => window.__spike.fit(window.__spike.id('backend.kingdom')))
  await landed()
  await sleep(400)
  st = await state()
  const inside = await page.evaluate(() => { const s = window.__spike, k = s.id('backend.kingdom'), ks = s.problems.list.filter(p => p.level === k || s.tree.isAncestor(k, p.level)); return { n: ks.length, rels: new Set(ks.flatMap(p => p.rels)).size } })
  check('inside Kingdom the list counts only Kingdom’s problems, and the map marks only theirs', st.summary === `Problems · ${inside.n}` && inside.n < st.total && st.warn?.all === inside.rels, JSON.stringify({ ...st, inside }))
  await shot('kod-kingdom')
  // A part with none listed says so, and marks nothing.
  await page.evaluate(() => window.__spike.fit(window.__spike.id('backend.market')))
  await landed()
  await sleep(400)
  const market = await page.evaluate(() => ({ text: document.querySelector('.d-problems .d-hint')?.textContent, warn: window.__spike.renderer.warn, legend: !!document.querySelector('#arrows .a-problem') }))
  check('a part with nothing listed says so and marks nothing', /^No problems listed here/.test(market.text ?? '') && market.warn === null && !market.legend, JSON.stringify(market))

  // Search reaches it too, and Back returns to the selection it was run from.
  await page.evaluate(() => { window.__spike.fit(0); window.__spike.select(window.__spike.id('backend')) })
  await landed()
  await focusMap()
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control')
  await page.keyboard.type('>problems')
  await sleep(300)
  await page.keyboard.press('Enter')
  await landed()
  st = await state()
  check('search’s Problems command opens the first problem, wherever ] had got to', st.note?.startsWith('Problem 1 of') === true, JSON.stringify(st))
  await key('Backspace')
  await sleep(500)
  check('Back returns to the selection the command was run from', (await page.evaluate(() => window.__spike.tree.els[window.__spike.renderer.selected]?.id)) === 'backend')

  // A phone: rows are touch targets, and every problem opened has its own line marked on screen above the sheet.
  await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true })
  await open('model=knights-of-darkness')
  await page.evaluate(() => { const d = document.getElementById('details'); if (d.classList.contains('collapsed')) d.querySelector('.d-grip')?.click() })
  await sleep(300)
  await page.evaluate(() => { const p = document.querySelector('.d-problems'); p.open = true; p.scrollIntoView() })
  await sleep(300)
  const touch = await page.evaluate(() => [...document.querySelectorAll('.d-problems li:not([hidden]) button, .d-problems > summary')].map(b => b.getBoundingClientRect().height))
  check('on a phone every problem row and the list’s fold are 44 px tall at least', touch.length > 1 && touch.every(h => h >= 44), JSON.stringify(touch))
  await shot('kod-phone')
  const total = (await state()).total
  const offscreen = []
  for (let k = 0; k < total; k++) {
    await page.evaluate(k => window.__spike.openProblem(k), k)
    await landed()
    await sleep(200)
    const s = await state()
    if (!s.strongDrawn || !s.strongAboveSheet) offscreen.push(k)
  }
  check('on a phone every problem opens with its own line marked on screen, above the sheet', offscreen.length === 0, JSON.stringify(offscreen))
  await shot('kod-phone-problem')
  const navs = await page.evaluate(() => [...document.querySelectorAll('.d-problem-nav button')].map(b => b.getBoundingClientRect().height))
  check('on a phone the note offers Previous, Next and Back to the list, each a touch target', navs.length === 3 && navs.every(h => h >= 44), JSON.stringify(navs))
  await page.setViewport({ width: 1600, height: 1000 })

  // The Requests view lays out steps, not parts: no list, and ] keeps its own meaning.
  await open('model=knights-of-darkness&view=requests')
  st = await state()
  check('the Requests view lists no problems', st.summary === null && st.total === null, JSON.stringify(st))
  await key(']')
  st = await state()
  check('there ] with nothing selected says to select a card', /Select a card first/.test(st.toast), JSON.stringify(st))

  // This repo's own map: nothing to flag says so and how it was judged; the search command keeps the selection.
  await open('model=zoom-in-architecture')
  await page.click('.d-problems > summary')
  await sleep(300)
  const none = await page.evaluate(() => ({ summary: document.querySelector('.d-problems > summary')?.textContent, text: document.querySelector('.d-problems .d-hint')?.textContent, warn: window.__spike.renderer.warn, legend: !!document.querySelector('#arrows .a-problem') }))
  check('a map with no problems says none, how it judged, and marks nothing', none.summary === 'Problems · 0' && /^No problems listed here/.test(none.text ?? '') && /not judged/.test(none.text ?? '') && none.warn === null && !none.legend, JSON.stringify(none))
  await key(']')
  st = await state()
  check('there ] with nothing selected falls back to its usual hint', /Select a card first/.test(st.toast) && st.note === null, JSON.stringify(st))
  await shot('zia-none')
  await page.evaluate(() => window.__spike.select(window.__spike.id('developer')))
  await focusMap()
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control')
  await page.keyboard.type('>problems')
  await sleep(300)
  await page.keyboard.press('Enter')
  await sleep(300)
  st = await state()
  check('the search command on a map with none says so and keeps the selection', /No problems found/.test(st.toast) && st.selected === await page.evaluate(() => window.__spike.id('developer')), JSON.stringify(st))

  // Galaxy Wars: a larger map with uses against the grain; stepping works there and the mark holds.
  await open('model=galaxy-wars')
  st = await state()
  check('Galaxy Wars lists its problems', st.total > 0 && st.summary === `Problems · ${st.total}`, JSON.stringify(st))
  await page.click('.d-problems > summary')
  await sleep(200)
  await key(']')
  st = await state()
  check('Galaxy Wars: ] opens its first problem with its own line marked', st.note?.startsWith(`Problem 1 of ${st.total}`) === true && st.strongDrawn > 0, JSON.stringify(st))
  await shot('gw-problem-1')
  for (let k = 0; k < 5; k++) await key(']')
  st = await state()
  check('five more steps land on the sixth', st.at === 5, JSON.stringify({ at: st.at }))
  await key('Escape')
  await page.evaluate(() => window.__spike.fit(0))
  await landed()
  const grainRow = await page.$('.d-problems li.k-grain button')
  check('Galaxy Wars lists a use against the grain', !!grainRow)
  await grainRow?.click()
  await landed()
  st = await state()
  check('a use against the grain opens with its why, its flagged uses first, and its lines', /Against the grain$/.test(st.note ?? '') && /against the grain/.test(st.why ?? '') && st.flagged.length === st.flaggedWant && st.flagged.every(f => f.first && f.tag === 'flagged') && st.strongDrawn > 0, JSON.stringify(st))
  await shot('gw-grain')

  check('no page errors', errors.length === 0, errors.join('\n'))
} catch (e) {
  failed++
  console.log('FAIL', 'scenario threw', e?.stack ?? e)
} finally {
  await browser.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
