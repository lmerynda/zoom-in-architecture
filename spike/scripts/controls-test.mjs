// Black-box checks of the controls: few of them, each doing one thing, none acting behind a
// dialog, readable text, and motion that is short and stops when asked.
// usage: node scripts/controls-test.mjs [outDir]   (dev server running)
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'shots/controls'
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
const landed = async () => { await page.waitForFunction(() => !window.__spike.cam.flying, { timeout: 30000 }); await sleep(200) }
const camera = () => page.evaluate(() => { const c = window.__spike.cam; return [c.x, c.y, c.z] })
const sameCam = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-6 * Math.max(1, Math.abs(v)))
const focusMap = () => page.evaluate(() => document.querySelector('#stage canvas').focus())

try {
  await open('model=knights-of-darkness')

  // An unknown map says so and lists the maps there are.
  await page.goto(`${base}?model=no-such-map`, { waitUntil: 'load' })
  await page.waitForFunction(() => !document.getElementById('failed').hidden, { timeout: 30000 })
  const failedText = await page.evaluate(() => ({ h: document.querySelector('#failed h2').textContent, maps: document.querySelectorAll('#failed a').length }))
  check('an unknown map says so and offers the maps there are', /No map named/.test(failedText.h) && failedText.maps > 0, JSON.stringify(failedText))
  await open('model=knights-of-darkness')

  // The minimap waits while the whole map is in view, and shows once you go in.
  await sleep(600)
  const wholeHidden = await page.evaluate(() => getComputedStyle(document.getElementById('minimap')).visibility === 'hidden')
  await page.evaluate(() => window.__spike.fit(window.__spike.id('backend')))
  await landed()
  await sleep(400)
  const inShown = await page.evaluate(() => getComputedStyle(document.getElementById('minimap')).visibility !== 'hidden')
  check('the minimap hides on the whole map and shows inside it', wholeHidden && inShown, JSON.stringify({ wholeHidden, inShown }))

  // Gone: the command wheel, routes, pins, sound, the shortcut sentence.
  const gone = await page.evaluate(() => ({ radial: !!document.querySelector('.radial'), route: !!document.querySelector('.routepanel'), help: document.getElementById('help').tagName }))
  check('no command wheel or route panel; Help is a button', !gone.radial && !gone.route && gone.help === 'BUTTON', JSON.stringify(gone))

  // The closed search box is out of the tab order: Tab never lands in it, typing never fills it.
  await focusMap()
  for (let k = 0; k < 6; k++) await page.keyboard.press('Tab')
  const tabbed = await page.evaluate(() => ({ inPalette: !!document.activeElement?.closest('.palette'), value: document.querySelector('.palette input').value }))
  await page.keyboard.type('war')
  check('Tab never reaches the closed search box', !tabbed.inPalette && (await page.evaluate(() => document.querySelector('.palette input').value)) === '', JSON.stringify(tabbed))

  // Help is a dialog: focus moves in, map keys do nothing behind it, Esc closes it.
  await focusMap()
  await page.keyboard.press('?')
  await sleep(100)
  const before = await camera()
  const dialog = await page.evaluate(() => { const d = document.querySelector('.help-overlay'); return { open: !d.hidden, role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), focusIn: d.contains(document.activeElement) } })
  for (const k of ['.', ']', 'Backspace', 'ArrowRight']) await page.keyboard.press(k)
  await sleep(300)
  check('Help opens as a modal dialog holding focus', dialog.open && dialog.role === 'dialog' && dialog.modal === 'true' && dialog.focusIn, JSON.stringify(dialog))
  check('map keys do nothing under Help', sameCam(before, await camera()))
  await shot('01-help')
  await page.keyboard.press('Escape')
  check('Esc closes Help', await page.evaluate(() => document.querySelector('.help-overlay').hidden))

  // Esc closes one layer at a time and never moves the camera.
  await page.evaluate(() => { const s = window.__spike; s.select(s.id('backend.military')) })
  await page.click('.model-current')
  await page.keyboard.press('Escape')
  const afterMenu = await page.evaluate(() => ({ menu: document.querySelector('.model-menu').hidden, selected: window.__spike.renderer.selected }))
  check('Esc on the model menu closes it and keeps the selection', afterMenu.menu && afterMenu.selected > 0, JSON.stringify(afterMenu))
  await focusMap()
  await page.keyboard.press('Escape')
  const cam0 = await camera()
  await page.keyboard.press('Escape')
  await sleep(500)
  check('Esc clears the selection, then does nothing', (await page.evaluate(() => window.__spike.renderer.selected)) === -1 && sameCam(cam0, await camera()))

  // . and , belong to the Connections view.
  await page.keyboard.press('.')
  await sleep(200)
  check('. does not select in the Architecture view', (await page.evaluate(() => window.__spike.renderer.selected)) === -1)

  // Alt+↑ goes up a level; Back is the previous place.
  await page.evaluate(() => { const s = window.__spike; s.controls.goSelect(s.id('backend.military')) })
  await landed()
  await focusMap()
  await page.keyboard.down('Alt'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('Alt')
  await landed()
  check('Alt+↑ goes to the parent', (await page.evaluate(() => window.__spike.tree.els[window.__spike.renderer.selected]?.id)) === 'backend')

  // Search puts features and named parts first: "spy" finds the Spies feature before any loose match.
  await focusMap()
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control')
  await page.keyboard.type('spy')
  await sleep(200)
  const spy = await page.evaluate(() => [...document.querySelectorAll('.palette .row')].slice(0, 3).map(r => r.querySelector('.kind').textContent + ':' + r.querySelector('b').textContent))
  check('search ranks the Spies feature first for "spy"', spy[0] === 'feature:Spies', JSON.stringify(spy))
  await shot('03-search')
  // Nothing found: the features are offered, and picking one searches it with the box still open.
  await page.evaluate(() => { const i = document.querySelector('.palette input'); i.value = 'zzqx'; i.dispatchEvent(new Event('input')) })
  await sleep(100)
  await page.keyboard.press('Enter')
  await sleep(300)
  const retry = await page.evaluate(() => ({ open: !document.querySelector('.palette').hidden, value: document.querySelector('.palette input').value, rows: document.querySelectorAll('.palette .row').length }))
  check('picking an offered feature searches it, box open', retry.open && retry.value.length > 0 && retry.rows > 0, JSON.stringify(retry))
  await page.keyboard.press('Escape')
  // An empty search lists the map's features and the places you were.
  await focusMap()
  await page.keyboard.press('/')
  await sleep(150)
  const empty = await page.evaluate(() => [...document.querySelectorAll('.palette .group')].map(g => g.textContent))
  check('an empty search lists recent places and features', empty.includes('Features of this map') && empty.includes('Recent places'), JSON.stringify(empty))
  await page.keyboard.press('Escape')

  // Search frames a container it finds without selecting it.
  await page.evaluate(() => window.__spike.select(-1))
  await focusMap()
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control')
  await page.keyboard.type('Game server')
  await sleep(150)
  await page.keyboard.press('Enter')
  await landed()
  const found = await page.evaluate(() => ({ selected: window.__spike.renderer.selected, here: window.__spike.renderer.breadcrumb().map(i => window.__spike.tree.els[i].id) }))
  check('search frames a container without selecting it', found.selected === -1 && found.here.includes('backend'), JSON.stringify(found))

  // Right-click is a plain menu: go in, or read code and copy a path.
  const [mx, my] = await page.evaluate(() => { const s = window.__spike, i = s.id('backend.military'), r = s.renderer.screenRectOf(i); return [r[0] + r[2] / 2, r[1] + r[3] / 2] })
  await page.mouse.click(mx, my, { button: 'right' })
  await sleep(150)
  const menu = await page.evaluate(() => [...document.querySelectorAll('.menu button span')].map(s => s.textContent))
  await shot('02-menu')
  check('right-click opens a plain menu with Go in', menu.includes('Go in'), JSON.stringify(menu))
  await page.keyboard.press('Escape')

  // Flights are short, and any press ends one where it is.
  const ms = await page.evaluate(() => { const s = window.__spike; s.fit(0); return s.cam.flightMs })
  check('a flight takes at most 700 ms', ms > 0 && ms <= 700, String(ms))
  await page.evaluate(() => window.__spike.fit(window.__spike.id('backend.military')))
  await sleep(80)
  await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' })
  check('a click ends a flight', !(await page.evaluate(() => window.__spike.cam.flying)))

  // Reduced motion: no flight at all.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await sleep(100)
  const cut = await page.evaluate(() => { const s = window.__spike; s.fit(s.id('backend')); return s.cam.flying })
  check('reduced motion cuts instead of flying', cut === false)
  await page.emulateMediaFeatures([])

  // Keyboard only: find War, name what it uses, open a cited line, return to War.
  await open('model=knights-of-darkness')
  await focusMap()
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control')
  await page.keyboard.type('War')
  await page.keyboard.press('Enter')
  await landed()
  const tabTo = async (test, max = 80) => {
    for (let k = 0; k < max; k++) {
      await page.keyboard.press('Tab')
      if (await page.evaluate(test)) return true
    }
    return false
  }
  const title = await page.evaluate(() => document.title)
  const reachedShow = await tabTo(() => document.activeElement?.textContent === 'Show what it uses')
  await page.keyboard.press('Enter')
  await landed()
  const sel = await page.evaluate(() => window.__spike.tree.els[window.__spike.renderer.selected]?.title)
  const reachedCite = await tabTo(() => document.activeElement?.classList.contains('d-cite'))
  const dependency = await page.evaluate(() => document.activeElement.closest('li').querySelector('b').textContent)
  await page.keyboard.press('Enter')
  const reachedLine = await tabTo(() => document.activeElement?.classList.contains('cite'), 10)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.reader').hidden, { timeout: 15000 }).catch(() => {})
  const reading = await page.evaluate(() => !document.querySelector('.reader').hidden)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Backspace')
  await sleep(300)
  await landed()
  const backTo = await page.evaluate(() => window.__spike.tree.els[window.__spike.renderer.selected]?.title)
  const kb = { title, reachedShow, sel, reachedCite, dependency, reachedLine, reading, backTo }
  check('keyboard only: find War, name a dependency, open its citation, return to War', /^War · /.test(title) && reachedShow && sel === 'War' && reachedCite && !!dependency && reachedLine && reading && backTo === 'War', JSON.stringify(kb))
  await shot('04-keyboard')

  // A lens legend never sits on the details panel.
  await open('model=knights-of-darkness&in=backend&lens=size')
  const legend = await page.evaluate(() => { const l = document.querySelector('.lens-legend').getBoundingClientRect(), d = document.getElementById('details').getBoundingClientRect(); return { shown: l.height > 0, clear: l.bottom <= d.top || l.right <= d.left || l.left >= d.right } })
  check('the lens legend keeps off the details panel', legend.shown && legend.clear, JSON.stringify(legend))

  // Small text reads at AA contrast on the panels.
  const contrast = await page.evaluate(() => {
    const lum = c => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    const probe = document.createElement('span')
    document.body.append(probe)
    const out = {}
    for (const v of ['--dim', '--faint']) { probe.style.color = `var(${v})`; out[v] = (lum(getComputedStyle(probe).color) + 0.05) / (lum('rgb(11, 15, 24)') + 0.05) }
    probe.remove()
    return out
  })
  check('dim text is at least 4.5:1 on the panels', Object.values(contrast).every(r => r >= 4.5), JSON.stringify(contrast))

  // Assistive technology: search is a combobox whose highlighted result is the active option, and
  // putting it away gives focus back to where it was.
  await open('model=knights-of-darkness')
  await focusMap()
  await page.keyboard.press('/')
  await page.keyboard.type('market')
  await sleep(300)
  await page.keyboard.press('ArrowDown')
  const combo = await page.evaluate(() => {
    const i = document.querySelector('.palette input'), on = document.querySelector('.palette .row.on')
    const sub = on?.querySelector('.sub')
    // The path's contrast on the highlight, composited over the palette as drawn.
    const rgba = c => { const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1] }
    const over = (fg, bg) => fg.slice(0, 3).map((v, k) => v * fg[3] + bg[k] * (1 - fg[3]))
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
    const box = over(rgba(getComputedStyle(document.querySelector('.palette')).backgroundColor), [4, 6, 12]), row = over(rgba(getComputedStyle(on).backgroundColor), box), text = over(rgba(getComputedStyle(sub).color), row)
    // The highlight itself is marked by an amber edge, at 3:1 against the row.
    const edge = getComputedStyle(on).boxShadow.match(/rgba?\([^)]*\)/)?.[0]
    return { role: i.getAttribute('role'), expanded: i.getAttribute('aria-expanded'), list: document.getElementById(i.getAttribute('aria-controls'))?.getAttribute('role'), active: i.getAttribute('aria-activedescendant') === on?.id && on?.getAttribute('role') === 'option' && on?.getAttribute('aria-selected') === 'true', second: [...document.querySelectorAll('.palette .row')].indexOf(on) === 1, subRatio: ratio(text, row), edgeRatio: edge ? ratio(rgba(edge), row) : 0 }
  })
  await sleep(500)
  combo.status = await page.evaluate(() => document.querySelector('.palette [role=status]')?.textContent)
  check('search is a combobox over a listbox, its highlight the active option, its count announced', combo.role === 'combobox' && combo.expanded === 'true' && combo.list === 'listbox' && combo.active && combo.second && /\d+ results?/.test(combo.status), JSON.stringify(combo))
  check('the highlighted result path reads at 4.5:1, and the highlight has a 3:1 edge', combo.subRatio >= 4.5 && combo.edgeRatio >= 3, JSON.stringify(combo))
  await page.keyboard.press('Escape')
  check('Esc gives focus back to the map it was opened from', await page.evaluate(() => document.activeElement === document.querySelector('#stage canvas')))
  // Assistive technology activates an option with a click, not a mousedown.
  await page.click('#travel')
  await page.keyboard.type('Market and merchant bots')
  await sleep(300)
  await page.evaluate(() => document.querySelector('.palette .row.on').click())
  await sleep(300)
  const ran = await page.evaluate(() => ({ open: !document.querySelector('.palette').hidden, focus: document.activeElement?.id }))
  check('a click on an option runs it and gives focus back to the Search button', !ran.open && ran.focus === 'travel', JSON.stringify(ran))
  await open('model=knights-of-darkness')

  // One visible focus ring everywhere, and selecting from the outline keeps focus in the panel.
  await page.evaluate(() => document.querySelector('#details .d-outline button').focus())
  await page.keyboard.press('ArrowDown')
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { cls: document.activeElement.className, style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor } })
  check('an outline row shows a 2 px amber focus ring', ring.style === 'solid' && ring.width === '2px' && ring.color === 'rgb(251, 191, 36)', JSON.stringify(ring))
  await page.keyboard.press('Enter')
  await sleep(600)
  const after = await page.evaluate(() => ({ focus: document.activeElement?.tagName, inPanel: document.getElementById('details').contains(document.activeElement), said: document.getElementById('announce').textContent }))
  check('selecting from the outline moves focus to the new heading and announces it', after.focus === 'H2' && after.inPanel && /^Selected .+: uses \d+, used by \d+$/.test(after.said), JSON.stringify(after))
  await page.keyboard.press('Escape')
  await sleep(300)
  const putDown = await page.evaluate(() => ({ inPanel: document.getElementById('details').contains(document.activeElement), on: document.activeElement?.tagName, said: document.getElementById('announce').textContent }))
  check('Esc puts the selection down with focus kept in the panel, and says so', putDown.inPanel && putDown.said === 'Selection cleared', JSON.stringify(putDown))

  // State in words: the open view, and whether a menu is open.
  const state = await page.evaluate(async () => {
    const current = [...document.querySelectorAll('#views a[aria-current="page"]')].map(a => a.textContent)
    const lens = document.querySelector('.lens-current'), model = document.querySelector('.model-current')
    const before = [lens.getAttribute('aria-expanded'), model.getAttribute('aria-expanded')]
    lens.click(); await new Promise(r => setTimeout(r, 50))
    const lensOpen = lens.getAttribute('aria-expanded')
    document.body.click(); model.click(); await new Promise(r => setTimeout(r, 50))
    const modelOpen = model.getAttribute('aria-expanded')
    document.body.click(); await new Promise(r => setTimeout(r, 50))
    return { current, before, lensOpen, modelOpen, after: [lens.getAttribute('aria-expanded'), model.getAttribute('aria-expanded')] }
  })
  // Menus: the map list opens on the open map, Tab out of either menu closes it, and the card menu gives focus back.
  await page.click('.model-current')
  const onOpen = await page.evaluate(() => document.activeElement?.classList.contains('on'))
  await page.evaluate(() => [...document.querySelectorAll('.model-menu a')].at(-1).focus())
  await page.keyboard.press('Tab')
  const modelClosed = await page.evaluate(() => document.querySelector('.model-menu').hidden)
  await page.click('.lens-current')
  for (let k = 0; k < 8; k++) await page.keyboard.press('Tab')
  const lensClosed = await page.evaluate(() => document.querySelector('.lens-menu').hidden && document.querySelector('.lens-current').getAttribute('aria-expanded') === 'false')
  await focusMap()
  await page.evaluate(() => window.__spike.select(window.__spike.id('backend')))
  await page.keyboard.down('Shift'); await page.keyboard.press('F10'); await page.keyboard.up('Shift')
  await sleep(200)
  const menuOpen = await page.evaluate(() => !document.querySelector('.menu').hidden)
  await page.keyboard.press('Escape')
  const menuBack = await page.evaluate(() => document.activeElement === document.querySelector('#stage canvas'))
  check('the map list opens on the open map and Tab out closes it; Colour by closes on Tab out; the card menu gives focus back', onOpen && modelClosed && lensClosed && menuOpen && menuBack, JSON.stringify({ onOpen, modelClosed, lensClosed, menuOpen, menuBack }))
  check('the open view is aria-current and menus say whether they are open', state.current.join() === 'Architecture' && state.before.join() === 'false,false' && state.lensOpen === 'true' && state.modelOpen === 'true' && state.after.join() === 'false,false', JSON.stringify(state))

  // A phone, and 200% zoom (800 CSS px): the bar wraps and every control in it stays on screen and
  // reachable; the arrow legend folds into one button; cards and labels start below the bar.
  for (const [width, height] of [[390, 800], [320, 568], [800, 500]]) {
    await page.setViewport({ width, height, isMobile: width < 700, hasTouch: width < 700 })
    await open('model=knights-of-darkness&in=backend')
    const bar = await page.evaluate(() => {
      const top = document.getElementById('top').getBoundingClientRect()
      const off = [...document.querySelectorAll('#top button, #top a')].filter(e => e.getClientRects().length && !e.closest('[hidden]')).map(e => [e.textContent.trim().slice(0, 20), e.getBoundingClientRect()]).filter(([, r]) => r.left < 0 || r.right > innerWidth + 0.5 || r.bottom > top.bottom + 0.5).map(([t]) => t)
      const want = ['Search', 'Help', 'Architecture', 'Connections', 'Requests'].filter(t => ![...document.querySelectorAll('#top button, #top a')].some(e => e.getClientRects().length && e.textContent.includes(t)))
      const lens = document.querySelector('.lens-current')?.getClientRects().length > 0
      const legend = [...document.querySelectorAll('#arrows > *')].filter(e => e.getClientRects().length).map(e => e.textContent)
      return { off, want, lens, legend, welcome: !document.getElementById('welcome').hidden, barBottom: top.bottom, bar: getComputedStyle(document.documentElement).getPropertyValue('--bar') }
    })
    check(`at ${width} px every bar control is on screen`, !bar.off.length && !bar.want.length && bar.lens && Math.abs(parseFloat(bar.bar) - bar.barBottom) < 1.5, JSON.stringify(bar))
    // Sticky titles and off-screen chips start below the bar, however tall it wraps.
    const safe = await page.evaluate(() => ({ safeTop: window.__spike.safeTop(), bar: document.getElementById('top').getBoundingClientRect().bottom }))
    check(`at ${width} px titles and chips keep below the bar`, safe.safeTop >= safe.bar, JSON.stringify(safe))
    // The lens menu opens on screen wherever its button wrapped to.
    await page.click('.lens-current')
    const lensMenu = await page.evaluate(() => { const r = document.querySelector('.lens-menu').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] })
    await page.keyboard.press('Escape')
    check(`at ${width} px the Colour by menu opens on screen`, lensMenu[0] >= 0 && lensMenu[1] <= width, JSON.stringify(lensMenu))
    check(`at ${width} px the arrow legend is one button until opened`, bar.legend.length === 1 && bar.legend[0] === 'Arrows', JSON.stringify(bar))
    await page.click('#arrows .a-toggle')
    const opened = await page.evaluate(() => ({ items: [...document.querySelectorAll('#arrows > *')].filter(e => e.getClientRects().length).length, expanded: document.querySelector('#arrows .a-toggle').getAttribute('aria-expanded') }))
    check(`at ${width} px the arrow legend opens on its button`, opened.items > 2 && opened.expanded === 'true', JSON.stringify(opened))

    // Help keeps all its columns on screen: one column, scrolling, nothing cut on either side.
    await page.click('#help')
    await sleep(200)
    const help = await page.evaluate(() => [...document.querySelectorAll('.help-col')].map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] }))
    check(`at ${width} px Help keeps every column on screen`, help.length >= 3 && help.every(([l, r]) => l >= 0 && r <= width), JSON.stringify(help))
    const helpTop = await page.evaluate(() => Math.round(document.querySelector('.help-overlay h2').getBoundingClientRect().top))
    check(`at ${width} px Help opens at its top`, helpTop >= 0, String(helpTop))
    await page.keyboard.press('Escape')

    // Search keeps a file's path readable, so two files of one name stay apart.
    await focusMap()
    await page.keyboard.press('/')
    await page.keyboard.type('MarketTransaction')
    await sleep(400)
    const paths = await page.evaluate(() => [...document.querySelectorAll('.palette .row .sub')].map(s => Math.round(s.getBoundingClientRect().width)))
    check(`at ${width} px search rows show each path`, paths.length > 1 && paths.every(w => w > 100), JSON.stringify(paths))
    await page.keyboard.press('Escape')

    // The reader names the file and line on a row of its own, clear of Copy.
    await open('model=knights-of-darkness&file=backend/src/main/java/com/knightsofdarkness/web/market/MarketController.java&line=67')
    await page.waitForFunction(() => !document.querySelector('.reader')?.hidden, { timeout: 15000 }).catch(() => {})
    const reader = await page.evaluate(() => {
      const r = s => { const e = document.querySelector(s); const b = e?.getBoundingClientRect(); return b ? [b.left, b.top, b.right, b.bottom] : null }
      const where = r('.reader-where'), title = r('.reader-title'), acts = r('.reader-actions')
      const overlap = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
      return { where: where && where[2] - where[0], titleOverActions: overlap(title, acts), whereOverActions: overlap(where, acts), right: acts && acts[2] }
    })
    check(`at ${width} px the reader names file and line clear of its buttons`, reader.where > 100 && !reader.titleOverActions && !reader.whereOverActions && reader.right <= width, JSON.stringify(reader))

    // A first visit: Got it is the topmost thing at its centre, not the outline bar.
    await page.evaluate(() => localStorage.removeItem('zoom.introSeen'))
    await page.goto(`${base}?model=knights-of-darkness`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__spike?.ready && !document.getElementById('welcome').hidden, { timeout: 60000 })
    const ok = await page.evaluate(() => { const b = document.querySelector('#welcome .ok').getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; return { top: document.elementFromPoint(x, y)?.className, y: Math.round(y), legend: document.getElementById('arrows').getClientRects().length } })
    check(`at ${width} px the welcome's Got it can be pressed, and the legend waits`, ok.top === 'ok' && ok.legend === 0, JSON.stringify(ok))
    await page.click('#welcome .ok')
    check(`at ${width} px Got it puts the welcome away`, await page.evaluate(() => document.getElementById('welcome').hidden))
    // A first visit by a link to a selection: the sheet is up, and Got it still stands clear of it.
    await page.evaluate(() => localStorage.removeItem('zoom.introSeen'))
    await page.goto(`${base}?model=knights-of-darkness&at=backend`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__spike?.ready && !document.getElementById('welcome').hidden, { timeout: 60000 })
    await sleep(300)
    const okSheet = await page.evaluate(() => { const b = document.querySelector('#welcome .ok').getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.className })
    check(`at ${width} px Got it stands clear of an open sheet`, okSheet === 'ok', okSheet)
    await page.click('#welcome .ok')
  }
  await page.setViewport({ width: 1600, height: 1000 })

  // Layout: a container of parts fills its body with them, however few they are. Files keep to a
  // 2 × 2 grid's card size, so a one-file app opens with its siblings (publish-test checks that).
  await open('model=knights-of-darkness')
  const fill = await page.evaluate(() => {
    const { tree: t, world } = window.__spike, r = world.rect, out = []
    for (let i = 1; i < t.size; i++) {
      const c = t.children[i]
      if (!c.length) continue
      const w = r[i * 4 + 2], h = r[i * 4 + 3], bw = w - 2 * 0.045 * w, bh = h - 0.14 * h - 1.5 * 0.045 * w
      const x0 = Math.min(...c.map(k => r[k * 4])), x1 = Math.max(...c.map(k => r[k * 4] + r[k * 4 + 2]))
      const y0 = Math.min(...c.map(k => r[k * 4 + 1])), y1 = Math.max(...c.map(k => r[k * 4 + 1] + r[k * 4 + 3]))
      out.push({ title: t.els[i].title, n: c.length, parts: c.every(k => t.children[k].length), cover: Math.round((100 * (x1 - x0) * (y1 - y0)) / (bw * bh)) })
    }
    const parts = out.filter(o => o.parts).sort((a, b) => a.cover - b.cover)
    return { least: parts[0], many: parts.filter(o => o.n >= 3), few: parts.filter(o => o.n <= 2) }
  })
  // On main they covered 19-74%.
  check('a container of parts is filled by them: none under 55%, those of three or more over 80%', fill.least.cover >= 55 && fill.many.length > 0 && fill.many.every(f => f.cover >= 80), JSON.stringify(fill))
  check('a container of two parts is filled, not a small cluster', fill.few.length > 0 && fill.few.every(f => f.cover >= 55), JSON.stringify(fill.few))

  // The whole map is laid out for the stage's shape: it fills the stage on one side, at 1920 wide
  // and on a phone held sideways, and the cards inside Game server carry readable titles at 1920.
  for (const [width, height, mobile] of [[1920, 1080, false], [844, 390, true]]) {
    await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile })
    await open('model=knights-of-darkness')
    await landed()
    await sleep(600)
    const whole = await page.evaluate(() => {
      const s = window.__spike, r = s.world.rect, z = s.cam.z, stage = document.getElementById('stage').getBoundingClientRect()
      const top = document.getElementById('top').getBoundingClientRect().bottom + 8, bottom = stage.bottom - (innerWidth < 1100 ? 58 : 28)
      const k = s.tree.children[s.id('backend')][0]
      return { across: +((r[2] * z) / stage.width).toFixed(2), down: +((r[3] * z) / (bottom - top)).toFixed(2), nested: +Math.min(r[k * 4 + 3] * z * 0.15, 24).toFixed(1) }
    })
    check(`at ${width}×${height} the whole map fills the stage on one side`, Math.max(whole.across, whole.down) >= 0.9, JSON.stringify(whole))
    if (width === 1920) check('at 1920 the cards inside the server are titled at 10 px or more', whole.nested >= 10, JSON.stringify(whole))
  }
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
