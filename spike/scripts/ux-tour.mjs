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

// 4. Control group: save this view to slot 1, fly elsewhere, recall.
await key('1', ['Control'])
await sleep(300)
await page.evaluate(() => { const s = window.__spike; s.select(s.id('galaxyWars.clients.browserClient')); s.fly(s.id('galaxyWars.clients.browserClient')) })
await landed()
await key('2', ['Control'])
await sleep(200)
await key('1'); await landed()
await shot('06-control-group-recalled')

// 5. Radial command wheel on a card.
const [rx, ry] = await centre('galaxyWars.server.gameServer.simulation.sector.sectorRegistry')
await page.mouse.move(rx, ry)
await page.mouse.click(rx, ry, { button: 'right' })
await sleep(350)
await page.mouse.move(rx + 80, ry - 60)
await sleep(150)
await shot('07-radial-wheel')
await key('Escape')

// 6. Route: select a start, R, click the destination.
await page.evaluate(() => { const s = window.__spike; s.select(s.id('galaxyWars.clients.browserClient.session')); s.fly(0) })
await landed()
await key('r')
await sleep(200)
const [dx, dy] = await centre('galaxyWars.postgreSQL')
await page.mouse.click(dx, dy)
await landed()
await sleep(500)
await shot('08-route')
await key('n'); await landed(); await key('n'); await landed()
await shot('09-route-waypoint')
await key('Escape'); await key('Escape')

// 7. Nested tooltips: hover, hold to lock, hover a name inside.
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

// 8. Pins point the way when off screen.
await page.mouse.move(tx, ty)
await key('p')
await sleep(200)
await page.evaluate(() => { const s = window.__spike; s.fly(s.id('galaxyWars.tooling.devTool')) })
await landed()
await page.mouse.move(5, 500)
await sleep(300)
await shot('11-pin-offscreen')

// 9. Controls screen.
await key('?')
await sleep(300)
await shot('12-controls-screen')
console.log(JSON.stringify({ errors }))
await browser.close()
