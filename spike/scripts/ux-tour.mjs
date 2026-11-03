// Drives the game-style controls with real mouse and keyboard input and screenshots each one.
// usage: node scripts/ux-tour.mjs [outDir]   (dev server running)
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'shots/ux'
const base = process.env.SPIKE_URL ?? 'http://localhost:5180/'
mkdirSync(outDir, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--window-size=1600,1000', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: Number(process.env.DPR ?? 1) },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
await page.goto(`${base}?model=galaxy-wars`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
await page.evaluate(() => localStorage.clear())
await sleep(500)
const shot = async name => { await page.screenshot({ path: join(outDir, `${name}.png`) }); console.log('shot', name) }
const centre = id => page.evaluate(id => {
  const s = window.__spike, i = s.id(id), r = s.world.rect
  return s.cam.toScreen(r[i * 4] + r[i * 4 + 2] / 2, r[i * 4 + 1] + r[i * 4 + 3] / 2)
}, id)
const landed = async () => { await page.waitForFunction(() => !window.__spike.cam.flying, { timeout: 8000 }); await sleep(350) }
const key = async (k, mods = []) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(k); for (const m of mods.reverse()) await page.keyboard.up(m) }
/** Right-clicks a card and picks a command wheel item by its label. */
const wheel = async (id, label) => {
  const [x, y] = await centre(id)
  await page.mouse.click(x, y, { button: 'right' })
  await sleep(300)
  const at = await page.evaluate(label => {
    const e = [...document.querySelectorAll('.radial .item')].find(e => e.firstChild.textContent === label)
    if (!e) return null
    const r = e.getBoundingClientRect()
    return [r.x + r.width / 2, r.y + r.height / 2]
  }, label)
  if (at) return page.mouse.click(at[0], at[1])
  throw new Error(`no wheel item ${label}`)
}

// 1. Command palette: type a few letters, fuzzy results.
await key('k', ['Control'])
await sleep(200)
await page.keyboard.type('secrun', { delay: 40 })
await sleep(300)
await shot('01-palette')
await key('Enter')
await landed()
await sleep(400)
await shot('02-palette-travelled')

// 2. Target cycling: look at what SectorRuntime calls without losing it.
await key(']'); await landed(); await key(']'); await landed()
await shot('03-target-cycling')
await key('Enter'); await landed()
await shot('04-walked-to-target')

// 3. Back, like an RPG's return.
await key('Backspace'); await landed()
await shot('05-back')

// 4. Radial command wheel on a card.
const [rx, ry] = await centre('galaxyWars.server.gameServer.simulation.sector.sectorRegistry')
await page.mouse.move(rx, ry)
await page.mouse.click(rx, ry, { button: 'right' })
await sleep(350)
await page.mouse.move(rx + 80, ry - 60)
await sleep(150)
await shot('07-radial-wheel')
await key('Escape')

// 5. Route: select a start, then "Route here" on the destination's wheel; click a stop to go there.
await page.evaluate(() => { const s = window.__spike; s.select(s.id('galaxyWars.clients.browserClient.session')); s.fly(0) })
await landed()
await wheel('galaxyWars.postgreSQL', 'Route here')
await landed()
await sleep(500)
await shot('08-route')
await page.click('.rp-stop:nth-of-type(3)'); await landed()
await shot('09-route-waypoint')
await key('Escape'); await key('Escape')

// 6. Nested tooltips: hover, hold to lock, hover a name inside.
await page.evaluate(() => { const s = window.__spike; s.select(-1); s.fly(s.id('galaxyWars.server.gameServer.transport')) })
await landed()
const [tx, ty] = await centre('galaxyWars.server.gameServer.transport.tcpGameServer')
await page.mouse.move(tx, ty)
await sleep(1600)
const link = await page.$('.tip .tip-link')
if (link) { const b = await link.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await sleep(900) }
await shot('10-nested-tooltips')
await page.mouse.move(5, 500)
await sleep(300)

// 7. Pins, from the wheel, point the way when off screen.
await wheel('galaxyWars.server.gameServer.transport.tcpGameServer', 'Pin')
await sleep(200)
await page.evaluate(() => { const s = window.__spike; s.fly(s.id('galaxyWars.tooling.devTool')) })
await landed()
await page.mouse.move(5, 500)
await sleep(300)
await shot('11-pin-offscreen')

// 8. Controls screen.
await key('?')
await sleep(300)
await shot('12-controls-screen')
console.log(JSON.stringify({ errors }))
await browser.close()
