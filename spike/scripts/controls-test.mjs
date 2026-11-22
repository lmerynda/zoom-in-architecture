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
} catch (e) {
  failed++
  console.log('FAIL', e.stack ?? e)
} finally {
  if (errors.length) { failed++; console.log('FAIL page errors', errors.slice(0, 5)) }
  await browser.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
