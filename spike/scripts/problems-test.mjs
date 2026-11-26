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
    strongAboveSheet: (() => {
      const w = r.warnedLines(), n = s.tree.size, sheet = d.getBoundingClientRect(), bottom = sheet.top > innerHeight / 2 ? sheet.top : innerHeight
      const right = sheet.top > innerHeight / 2 ? innerWidth : Math.min(innerWidth, sheet.left), top = document.getElementById('top').getBoundingClientRect().bottom
      const inside = (x, y) => x >= 0 && x <= right && y >= top && y <= bottom
      return r.lines.some(l => w.get(Math.min(l.s, l.t) * n + Math.max(l.s, l.t)) === 2 && l.pts.some((_, j) => j % 2 === 0 && j + 3 < l.pts.length && Array.from({ length: 21 }, (_, q) => q / 20).some(u => inside(l.pts[j] + (l.pts[j + 2] - l.pts[j]) * u, l.pts[j + 1] + (l.pts[j + 3] - l.pts[j + 1]) * u))))
    })(),
    strongVisible: (() => {
      const w = r.warnedLines(), n = s.tree.size, sheet = d.getBoundingClientRect(), bottom = sheet.top > innerHeight / 2 ? sheet.top : innerHeight
      const right = sheet.top > innerHeight / 2 ? innerWidth : Math.min(innerWidth, sheet.left), top = document.getElementById('top').getBoundingClientRect().bottom
      const inside = (x, y) => x >= 0 && x <= right && y >= top && y <= bottom
      let len = 0, full = 0
      for (const l of r.lines) {
        if (w.get(Math.min(l.s, l.t) * n + Math.max(l.s, l.t)) !== 2) continue
        for (let j = 0; j + 3 < l.pts.length; j += 2) {
          const x0 = l.pts[j], y0 = l.pts[j + 1], x1 = l.pts[j + 2], y1 = l.pts[j + 3], seg = Math.hypot(x1 - x0, y1 - y0)
          let inn = 0
          for (let q = 0; q < 20; q++) if (inside(x0 + (x1 - x0) * (q + 0.5) / 20, y0 + (y1 - y0) * (q + 0.5) / 20)) inn++
          len += seg * inn / 20
          full += seg
        }
      }
      // Enough of it: 16 px, or most of a line that is shorter (two neighbours a gutter apart).
      return { len: Math.round(len), enough: len >= Math.min(16, 0.8 * full) && full > 0 }
    })(),
    sourceHeading: (() => {
      if (s.problemAt < 0) return null
      const p = s.problems.list[s.problemAt], [x, y] = r.screenRectOf(p.a), sheet = d.getBoundingClientRect()
      const bottom = sheet.top > innerHeight / 2 ? sheet.top : innerHeight, right = sheet.top > innerHeight / 2 ? innerWidth : sheet.left
      return x >= -2 && x <= right - 40 && y >= document.getElementById('top').getBoundingClientRect().bottom - 2 && y <= bottom - 20
    })(),
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
  await page.evaluate(() => window.__spike.select(window.__spike.id('backend')))
  await sleep(200)
  await page.evaluate(() => window.__spike.openProblem(0))
  await landed()
  await page.focus('.d-problem-nav button:nth-child(2)')
  const swapKeeps = await page.evaluate(async () => {
    await window.__spike.swapModel(await (await fetch('/models/knights-of-darkness.json')).json())
    return { focus: document.activeElement?.textContent, back: document.querySelector('.d-back')?.textContent ?? null }
  })
  check('a live update keeps focus on the note’s button and the way back to the selection', swapKeeps.focus === 'Next →' && swapKeeps.back === '← Back to Game server', JSON.stringify(swapKeeps))
  await key('Escape')
  const tangle = await page.evaluate(async () => {
    const s = window.__spike, k = s.problems.list.findIndex(p => p.title.includes('↔') && /Buildings and land/.test(p.title))
    if (k < 0) return { k }
    s.openProblem(k)
    const json = await (await fetch('/models/knights-of-darkness.json')).json()
    const p = s.problems.list[k], ids = [s.tree.els[p.a].id, s.tree.els[p.b].id]
    const one = json.relations.find(r => r.source.startsWith(ids[0] + '.') && r.target.startsWith(ids[1] + '.') && r.kind === 'code')
    json.relations.push({ ...one })
    await s.swapModel(json)
    return { k, after: s.problemAt, title: s.problems.list[s.problemAt]?.title, note: !!document.querySelector('.d-problem') }
  })
  check('a tangle whose counts change in a live update stays open', tangle.k >= 0 && tangle.after >= 0 && /Buildings and land/.test(tangle.title ?? '') && tangle.note, JSON.stringify(tangle))
  await key('Escape')
  await open('model=knights-of-darkness')
  await page.click('.d-problems > summary')
  await sleep(200)

  // With a card selected, ] and [ still step through what it uses.
  await page.evaluate(() => window.__spike.select(window.__spike.id('backend.kingdom')))
  await sleep(200)
  await key(']')
  st = await state()
  check('with a card selected, ] steps its Uses, not problems', st.target > 0 && st.note === null && st.selected > 0, JSON.stringify(st))
  await key('Escape')
  await key('Escape')

  // A card selected from the outline replaces the list: its marks go with it.
  await page.evaluate(() => [...document.querySelectorAll('.d-outline button')].find(b => b.querySelector('b')?.textContent === 'Game server')?.click())
  await sleep(300)
  st = await state()
  check('selecting a card in place of the open list drops the list’s marks', st.selected > 0 && st.warn === null && !st.legend, JSON.stringify(st))
  await key('Escape')

  // A hidden row: the sixth cycle, behind Show more, opened, stepped past, then Back to the list.
  await page.evaluate(() => window.__spike.fit(0))
  await landed()
  await sleep(300)
  await page.evaluate(() => document.querySelector('.d-problems .d-more')?.click())
  await page.evaluate(() => document.querySelectorAll('.d-problems ul')[0].querySelectorAll('button')[5].click())
  await landed()
  await press(']')
  await page.click('.d-problem-nav button:nth-child(3)')
  await landed()
  await sleep(500)
  const hidden = await page.evaluate(() => { const a = document.activeElement; return { at: window.__spike.problemAt, focus: a?.dataset?.problem, shown: !!a && !a.closest('li')?.hidden } })
  check('Back to the list focuses the open problem’s row, its group expanded even past Show more', Number(hidden.focus) === hidden.at && hidden.shown, JSON.stringify(hidden))

  // A Tab on the way back is the reader's: landing does not take focus back.
  await page.click('.d-problems li button')
  await landed()
  await page.click('.d-problem-nav button:nth-child(3)')
  await page.keyboard.press('Tab')
  const tabbed = await page.evaluate(() => document.activeElement)
  await landed()
  await sleep(500)
  const afterTab = await page.evaluate(() => ({ problem: document.activeElement?.dataset?.problem ?? null, tag: document.activeElement?.tagName }))
  check('a Tab during the flight back keeps the focus the reader chose', afterTab.problem === null, JSON.stringify(afterTab))

  // From a file, which lists nothing: Back to the list goes to the part holding it.
  await page.evaluate(() => { const s = window.__spike, i = s.id('backend.kingdom.state.kingdomEntity'), r = s.world.rect; s.cam.set(r[i * 4] + r[i * 4 + 2] / 2, r[i * 4 + 1] + r[i * 4 + 3] / 2, (s.cam.w / r[i * 4 + 2]) * 1.1) })
  await sleep(400)
  await key(']')
  await page.click('.d-problem-nav button:nth-child(3)')
  await landed()
  await sleep(600)
  const fromFile = await page.evaluate(() => { const s = window.__spike, path = s.renderer.breadcrumb(); return { here: s.tree.els[path[path.length - 1] ?? 0].id, list: !!document.querySelector('.d-problems'), focus: document.activeElement?.dataset?.problem ?? document.activeElement?.tagName } })
  check('Back to the list from a file returns to the part holding it, its list shown', fromFile.here === 'backend.kingdom.state' && fromFile.list, JSON.stringify(fromFile))

  // A live update with a citation focused keeps focus on that citation, not another "line 5".
  await page.evaluate(() => window.__spike.openProblem(0))
  await landed()
  const relFocus = await page.evaluate(async () => {
    const li = document.querySelectorAll('.d-edge li[data-rel]')[1], s = window.__spike, k = Number(li.dataset.rel)
    li.querySelector('button.d-rel').focus()
    const want = `${s.tree.els[s.tree.rels[k * 2]].id}>${s.tree.els[s.tree.rels[k * 2 + 1]].id}`
    await s.swapModel(await (await fetch('/models/knights-of-darkness.json')).json())
    const row = document.activeElement?.closest('li[data-rel]'), j = Number(row?.dataset.rel ?? -1)
    return { want, got: j >= 0 ? `${s.tree.els[s.tree.rels[j * 2]].id}>${s.tree.els[s.tree.rels[j * 2 + 1]].id}` : null }
  })
  check('a live update keeps focus on the same relation’s row, not a neighbour with the same tooltip', relFocus.got === relFocus.want, JSON.stringify(relFocus))
  const cite = await page.evaluate(() => { const b = document.querySelectorAll('.d-edge .cite')[1]; b.focus(); return b.title })
  const citeAfter = await page.evaluate(async () => { await window.__spike.swapModel(await (await fetch('/models/knights-of-darkness.json')).json()); return document.activeElement?.title })
  check('a live update keeps focus on the same citation', citeAfter === cite, JSON.stringify({ cite, citeAfter }))
  const citeShift = await page.evaluate(async () => {
    const s = window.__spike, b = [...document.querySelectorAll('.d-edge li[data-rel] .cite')].find(x => x.closest('li').querySelectorAll('.cite').length > 1 && x !== x.closest('li').querySelector('.cite'))
    b.focus()
    const title = b.title.split(': ')[0], k = Number(b.closest('li').dataset.rel), src = s.tree.els[s.tree.rels[k * 2]].id, dst = s.tree.els[s.tree.rels[k * 2 + 1]].id
    const json = await (await fetch('/models/knights-of-darkness.json')).json()
    const rel = json.relations.find(r => r.source === src && r.target === dst && r.lines?.length > 1)
    const line = Number(title.split(':').pop())
    rel.lines = [...rel.lines.filter(n => n < line), line - 1, ...rel.lines.filter(n => n >= line)]
    await s.swapModel(json)
    return { title, after: document.activeElement?.title?.split(': ')[0] }
  })
  check('a line added before the focused citation leaves focus on that citation', citeShift.after === citeShift.title, JSON.stringify(citeShift))
  await key('Escape')
  await page.evaluate(() => window.__spike.fit(0))
  await landed()

  // Inside a part, the list holds only the problems at or under it, and the map marks only those.
  await page.evaluate(() => window.__spike.fit(window.__spike.id('backend.kingdom')))
  await landed()
  await sleep(400)
  st = await state()
  const inside = await page.evaluate(() => { const s = window.__spike, k = s.id('backend.kingdom'), ks = s.problems.list.filter(p => p.level === k || s.tree.isAncestor(k, p.level)); return { n: ks.length, rels: new Set(ks.flatMap(p => p.rels)).size } })
  check('inside Kingdom the list counts only Kingdom’s problems, and the map marks only theirs', st.summary === `Problems · ${inside.n}` && inside.n < st.total && st.warn?.all === inside.rels, JSON.stringify({ ...st, inside }))
  await shot('kod-kingdom')
  // Zoomed until the file fills the screen: the place is the file, which lists nothing.
  await page.evaluate(() => { const s = window.__spike, i = s.id('backend.kingdom.state.kingdomEntity'), r = s.world.rect; s.cam.set(r[i * 4] + r[i * 4 + 2] / 2, r[i * 4 + 1] + r[i * 4 + 3] / 2, (s.cam.w / r[i * 4 + 2]) * 1.1) })
  await landed()
  await sleep(400)
  const inFile = await page.evaluate(() => ({ list: !!document.querySelector('.d-problems'), warn: window.__spike.renderer.warn, legend: !!document.querySelector('#arrows .a-problem') }))
  check('into a file, where no list shows, the map marks nothing', !inFile.list && inFile.warn === null && !inFile.legend, JSON.stringify(inFile))

  // 11: a run started from Kingdom's list comes back there, focus on the row it started from.
  await page.evaluate(() => window.__spike.fit(window.__spike.id('backend.kingdom')))
  await landed()
  await sleep(400)
  const startRow = await page.evaluate(() => Number(document.querySelector('.d-problems li button')?.dataset.problem))
  await page.click('.d-problems li button')
  await landed()
  await press(']')
  await press(']')
  await press(']')
  await page.click('.d-problem-nav button:nth-child(3)')
  await landed()
  await sleep(600)
  const local = await page.evaluate(() => { const s = window.__spike, path = s.renderer.breadcrumb(); return { here: s.tree.els[path[path.length - 1] ?? 0].id, focus: document.activeElement?.dataset?.problem, at: s.problemAt } })
  check('Back to the list from a run started in Kingdom returns there, focus on the row it started from when the open one is not listed', local.here === 'backend.kingdom' && Number(local.focus) === (await page.evaluate(k => document.querySelector(`.d-problems [data-problem="${k}"]`) ? k : -1, local.at) >= 0 ? local.at : startRow), JSON.stringify({ ...local, startRow }))

  // A live edit that renumbers the cards: Back still goes to Kingdom.
  await page.evaluate(() => window.__spike.fit(window.__spike.id('backend.kingdom')))
  await landed()
  await sleep(400)
  await page.click('.d-problems li button')
  await landed()
  await press(']')
  await page.evaluate(async () => {
    const json = await (await fetch('/models/knights-of-darkness.json')).json()
    json.elements = json.elements.filter(e => e.id !== 'developer')
    json.relations = json.relations.filter(r => r.source !== 'developer' && r.target !== 'developer')
    await window.__spike.swapModel(json)
  })
  await landed()
  await page.click('.d-problem-nav button:nth-child(3)')
  await landed()
  await sleep(600)
  const renumbered = await page.evaluate(() => { const s = window.__spike, path = s.renderer.breadcrumb(); return s.tree.els[path[path.length - 1] ?? 0].id })
  check('after a live edit renumbers the cards, Back to the list still returns to Kingdom', renumbered === 'backend.kingdom', renumbered)
  await open('model=knights-of-darkness')
  await page.click('.d-problems > summary')
  await page.evaluate(() => window.__spike.fit(window.__spike.id('backend.kingdom')))
  await landed()
  await sleep(400)

  // A window resized while a problem is open: Back still returns to Kingdom's list.
  await page.click('.d-problems li button')
  await landed()
  await page.setViewport({ width: 1300, height: 900 })
  await sleep(600)
  await page.click('.d-problem-nav button:nth-child(3)')
  await landed()
  await sleep(600)
  const resized = await page.evaluate(() => { const s = window.__spike, path = s.renderer.breadcrumb(); return { here: s.tree.els[path[path.length - 1] ?? 0].id, focus: document.activeElement?.dataset?.problem ?? null } })
  check('after the window is resized, Back to the list still returns to Kingdom, focus on a row', resized.here === 'backend.kingdom' && resized.focus !== null, JSON.stringify(resized))
  await page.setViewport({ width: 1600, height: 1000 })
  await sleep(600)
  await focusMap()
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control')
  await sleep(300)
  const recent = await page.evaluate(() => document.querySelector('.palette')?.textContent ?? '')
  check('a part returned to by Back to the list is among search’s recent places', /Recent places/.test(recent) && recent.indexOf('Kingdom') > recent.indexOf('Recent places'), recent.slice(0, 200))
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__spike.fit(window.__spike.id('backend.kingdom')))
  await landed()
  await sleep(400)

  // N2: search opened during the flight back keeps focus.
  await page.click('.d-problems li button')
  await landed()
  await page.click('.d-problem-nav button:nth-child(3)')
  await sleep(50)
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control')
  await landed()
  await sleep(500)
  const searching = await page.evaluate(() => ({ open: !document.querySelector('.palette')?.hidden && document.activeElement?.tagName === 'INPUT', tag: document.activeElement?.tagName }))
  check('search opened during the flight back keeps focus when it lands', searching.open, JSON.stringify(searching))
  await page.keyboard.press('Escape')

  // N3: with a card selected and its heading focused, ] does not start a step Enter cannot finish.
  await page.evaluate(() => window.__spike.fit(0))
  await landed()
  await page.evaluate(() => [...document.querySelectorAll('.d-outline button')].find(b => b.querySelector('b')?.textContent === 'Game server')?.click())
  await sleep(300)
  await press(']')
  st = await state()
  check('from a selected card’s heading ] neither steps problems nor sets a target', st.target === -1 && st.note === null && st.selected > 0, JSON.stringify(st))
  await key('Escape')
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
  await open('model=galaxy-wars')
  const gwTotal = await page.evaluate(() => window.__spike.problems.list.length)
  const gwOff = []
  for (let k = 0; k < gwTotal; k++) {
    await page.evaluate(k => window.__spike.openProblem(k), k)
    await landed()
    await sleep(150)
    const s = await state()
    if (!s.strongDrawn || !s.strongAboveSheet || !s.sourceHeading) gwOff.push(k)
  }
  check('on a phone every Galaxy Wars problem opens with its own line marked on screen and the flagged card’s name in view', gwOff.length === 0, JSON.stringify(gwOff))
  await shot('gw-phone-problem')
  const navs = await page.evaluate(() => [...document.querySelectorAll('.d-problem-nav button')].map(b => b.getBoundingClientRect().height))
  check('on a phone the note offers Previous, Next and Back to the list, each a touch target', navs.length === 3 && navs.every(h => h >= 44), JSON.stringify(navs))
  // A phone's Back to the list keeps the sheet open on the list, focus on the row.
  await page.evaluate(() => window.__spike.openProblem(0))
  await landed()
  await page.click('.d-problem-nav button:nth-child(3)')
  await landed()
  await sleep(600)
  const phoneBack = await page.evaluate(() => ({ collapsed: document.getElementById('details').classList.contains('collapsed'), focus: document.activeElement?.dataset?.problem ?? document.activeElement?.tagName }))
  check('on a phone Back to the list keeps the sheet open with focus on the row', !phoneBack.collapsed && phoneBack.focus === '0', JSON.stringify(phoneBack))
  await open('model=excalidraw')
  // The editor across the screen's width: its outline, with its own problems, is the place.
  await page.evaluate(() => { const s = window.__spike, i = s.tree.els.findIndex(e => e.title === 'Excalidraw editor'), r = s.world.rect; s.cam.set(r[i * 4] + r[i * 4 + 2] / 2, r[i * 4 + 1] + r[i * 4 + 3] / 2, s.cam.w / r[i * 4 + 2]) })
  await sleep(800)
  const exHome = await page.evaluate(() => { const s = window.__spike, path = s.renderer.breadcrumb(); return s.tree.els[path[path.length - 1] ?? 0].title })
  await page.evaluate(() => { const d = document.getElementById('details'); if (d.classList.contains('collapsed')) d.querySelector('.d-grip')?.click(); const p = document.querySelector('.d-problems'); p.open = true })
  await page.evaluate(() => document.querySelector('.d-problems li button').click())
  await landed()
  await page.click('.d-problem-nav button:nth-child(3)')
  await landed()
  await sleep(600)
  const exBack = await page.evaluate(() => { const s = window.__spike, path = s.renderer.breadcrumb(); return { here: s.tree.els[path[path.length - 1] ?? 0].title, list: document.querySelector('.d-problems > summary')?.textContent, focus: document.activeElement?.dataset?.problem ?? document.activeElement?.tagName } })
  check('on a phone Back to the list returns to the outline it was opened from, not a card inside it', exBack.here === exHome && exBack.list !== 'Problems · 0' && /^\d+$/.test(exBack.focus ?? ''), JSON.stringify({ exHome, ...exBack }))
  await page.setViewport({ width: 320, height: 568, hasTouch: true, isMobile: true })
  await open('model=excalidraw')
  const exTotal = await page.evaluate(() => window.__spike.problems.list.length)
  const exShort = []
  for (let k = 0; k < exTotal; k++) {
    await page.evaluate(k => window.__spike.openProblem(k), k)
    await landed()
    await sleep(150)
    const s = await state()
    if (!s.strongVisible.enough) exShort.push([k, s.strongVisible.len])
  }
  check('at 320 × 568 every Excalidraw problem shows 16 px of its marked line, or most of a shorter one', exTotal > 0 && exShort.length === 0, JSON.stringify(exShort))
  await shot('ex-320-problem')
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
  const gwJson = await page.evaluate(async () => await (await fetch('/models/galaxy-wars.json')).text())
  const moved = await page.evaluate(async text => {
    const s = window.__spike, out = []
    const rings = s.problems.list.flatMap((p, k) => (p.ring && p.ring.length > 3 ? [k] : []))
    for (const k of rings.slice(0, 6)) {
      s.openProblem(k)
      const before = s.problems.list[k], ids = [s.tree.els[before.a].id, s.tree.els[before.b].id]
      await s.swapModel(JSON.parse(text))
      const after = s.problems.list[s.problemAt]
      if (!after || s.tree.els[after.a].id !== ids[0] || s.tree.els[after.b].id !== ids[1]) out.push(k)
    }
    return { rings: rings.length, moved: out }
  }, gwJson)
  const replaced = await page.evaluate(async text => {
    const s = window.__spike, k = s.problems.list.findIndex(p => p.ring && p.ring.length > 3)
    s.openProblem(k)
    const p = s.problems.list[k], a = s.tree.els[p.a].id, b = s.tree.els[p.b].id
    const json = JSON.parse(text), one = json.relations.find(r => r.source.startsWith(a + '.') && r.target.startsWith(b + '.'))
    // Twenty uses back the other way: the two parts become a pair using each other, no longer this ring.
    json.relations.push(...Array.from({ length: 20 }, () => ({ ...one, source: one.target, target: one.source })))
    await s.swapModel(json)
    const now = s.problemAt >= 0 ? s.problems.list[s.problemAt] : null
    await s.swapModel(JSON.parse(text))
    return { was: p.title, now: now?.title ?? null, ring: now?.ring?.length ?? null, note: !!document.querySelector('.d-problem') }
  }, gwJson)
  const handBack = await page.evaluate(async text => {
    const s = window.__spike, client = s.tree.els.find(e => e.title === 'Browser client')
    s.select(s.id(client.id))
    const k = s.problems.list.findIndex(p => p.ring && p.ring.length > 3)
    s.openProblem(k)
    document.querySelector('.d-problem-nav button:nth-child(2)').focus()
    const p = s.problems.list[k], a = s.tree.els[p.a].id, b = s.tree.els[p.b].id
    const json = JSON.parse(text), one = json.relations.find(r => r.source.startsWith(a + '.') && r.target.startsWith(b + '.'))
    json.relations.push(...Array.from({ length: 20 }, () => ({ ...one, source: one.target, target: one.source })))
    await s.swapModel(json)
    const out = { selected: s.tree.els[s.renderer.selected]?.title ?? null, focus: document.activeElement?.tagName, note: !!document.querySelector('.d-problem') }
    await s.swapModel(JSON.parse(text))
    return out
  }, gwJson)
  check('a problem an update closes hands back the selection it was opened over, focus on its heading', handBack.selected === 'Browser client' && handBack.focus === 'H2' && !handBack.note, JSON.stringify(handBack))
  await key('Escape')
  check('a ring an edit turns into another problem is not shown as that problem', replaced.now === null || (replaced.now === replaced.was && replaced.ring > 3), JSON.stringify(replaced))
  check('an identical live update keeps each ring problem open as itself', moved.rings > 0 && moved.moved.length === 0, JSON.stringify(moved))
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
