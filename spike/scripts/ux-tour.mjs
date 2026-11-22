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
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: Number(process.env.DPR ?? 1) },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
await page.goto(`${base}?model=acme`, { waitUntil: 'load' })
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
await page.keyboard.type('chkout', { delay: 40 })
await sleep(300)
await shot('01-palette')
await key('Enter')
await landed()
await sleep(400)
await shot('02-palette-travelled')

// 2. Target cycling: look at what Checkout calls without losing it.
await key(']'); await landed(); await key(']'); await landed()
await shot('03-target-cycling')
await key('Enter'); await landed()
await shot('04-walked-to-target')

// 3. Back, like an RPG's return.
await key('Backspace'); await landed()
await shot('05-back')

// 4. Right-click: a plain menu on a card.
const [rx, ry] = await centre('acme.ordering.checkout')
await page.mouse.click(rx, ry, { button: 'right' })
await sleep(300)
await shot('07-context-menu')
await key('Escape')

// 5. A preview on a card too small to read.
await page.evaluate(() => { const s = window.__spike; s.select(-1); s.fly(0) })
await landed()
const [tx, ty] = await centre('acme.ordering.checkout')
await page.mouse.move(tx, ty)
await sleep(700)
await shot('10-preview')
await page.mouse.move(5, 500)
await sleep(300)

// 8. Controls screen.
await key('?')
await sleep(300)
await shot('12-controls-screen')
console.log(JSON.stringify({ errors }))
await browser.close()
