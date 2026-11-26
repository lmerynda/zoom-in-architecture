// Black-box checks that the map's surface comes first: every endpoint listed in one action from a
// cold map, in both views, grouped and filterable; search finds endpoints from any view; the default
// view states each part's endpoints and a controller what it serves; an endpoint is told by its
// effect; a feature meets its pages and endpoints; and the address and view switch keep the place
// and the request. On knights-of-darkness, whose Requests model is traced.
// usage: node scripts/endpoints-test.mjs [outDir]   (dev server running)
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'shots/endpoints'
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
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shot = name => page.screenshot({ path: join(outDir, `${name}.png`) })
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(ok ? 'pass' : 'FAIL', name, ok ? '' : detail) }
const map = 'model=knights-of-darkness'
const ready = async () => {
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => { try { localStorage.setItem('zoom.introSeen', '1') } catch { /* */ } })
  // The Requests model beside the map arrives on its own: wait for the surface it gives.
  await page.waitForFunction(() => window.__spike.renderer.surface != null, { timeout: 10000 }).catch(() => {})
  await sleep(500)
}
const open = async q => { await page.goto(`${base}?${q}`, { waitUntil: 'load' }); await ready() }
const landed = async () => { await page.waitForFunction(() => !window.__spike.cam.flying, { timeout: 30000 }); await sleep(400) }
const selected = () => page.evaluate(() => { const s = window.__spike, i = s.renderer.selected; return i > 0 ? s.tree.els[i].id : null })
const query = () => page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)))
const panel = () => page.evaluate(() => ({
  kind: document.querySelector('#details .d-kind')?.textContent, h2: document.querySelector('#details h2')?.textContent,
  text: document.getElementById('details').innerText,
  rows: [...document.querySelectorAll('#details .d-ep')].map(b => b.querySelector('b').textContent),
}))
const clickText = (sel, text) => page.evaluate((sel, text) => { const b = [...document.querySelectorAll(sel)].find(x => x.textContent.startsWith(text)); b?.click(); return !!b }, sel, text)
const crossed = async view => { await page.waitForFunction(v => (new URLSearchParams(location.search).get('view') ?? '') === v && window.__spike?.ready, { timeout: 60000 }, view); await ready() }

try {
  // 1. From a cold map, the API in one press: the welcome counts the endpoints and lists them all.
  await page.goto(`${base}?model=acme`, { waitUntil: 'load' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}?${map}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready && document.querySelector('#welcome button.api'), { timeout: 60000 })
  const welcome = await page.evaluate(() => document.getElementById('welcome').textContent)
  check('the welcome counts apps, a database and the endpoints, with See the API', /2 apps, 1 database, 2 people, 1 system, 67 endpoints, 19 features/.test(welcome) && /See the API · 67/.test(welcome), welcome)
  await shot('01-welcome')
  await page.click('#welcome button.api')
  await sleep(300)
  const list = await panel()
  const groups = await page.evaluate(() => [...document.querySelectorAll('#details .d-group h3')].map(h => h.textContent))
  const sum = groups.reduce((a, g) => a + Number(g.split(' · ').pop()), 0)
  check('one press lists all 67 endpoints, grouped by resource with counts', list.h2 === 'Endpoints · 67' && list.rows.length === 67 && groups.length === 10 && sum === 67, JSON.stringify({ h2: list.h2, rows: list.rows.length, groups }))
  check('the list says what the tests saw and what the code marks', /63 of 67 seen in tests · 72 routes marked in code, 67 placed/.test(list.text), list.text.slice(0, 300))
  check('focus goes to the list\'s heading', await page.evaluate(() => document.activeElement === document.querySelector('#details h2')))
  await shot('02-endpoint-list')
  await page.click('#welcome .ok')

  // Method filters and Unseen.
  const chips = await page.evaluate(() => [...document.querySelectorAll('#details .d-filters button')].map(b => `${b.textContent}:${b.getAttribute('aria-pressed')}`))
  check('method filters and Unseen · 4 are offered, All pressed', chips[0] === 'All · 67:true' && chips.some(c => /^GET · \d+:false$/.test(c)) && chips.some(c => /^POST · \d+:false$/.test(c)) && chips.at(-1) === 'Unseen · 4:false', JSON.stringify(chips))
  await page.focus('#details .d-filters button.unseen')
  await page.keyboard.press('Enter')
  await sleep(200)
  const unseen = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#details .d-ep')].map(b => b.getAttribute('aria-label')), focus: document.activeElement?.textContent, pressed: document.querySelector('#details .d-filters button.unseen')?.getAttribute('aria-pressed') }))
  check('Unseen lists the four endpoints no test called, and keeps focus on its chip', unseen.rows.length === 4 && unseen.rows.every(r => r.includes(', not seen in tests')) && unseen.focus === 'Unseen · 4' && unseen.pressed === 'true', JSON.stringify(unseen))
  await clickText('#details .d-filters button', 'POST')
  await sleep(200)
  const post = await page.evaluate(() => [...document.querySelectorAll('#details .d-ep .d-m')].map(m => m.textContent))
  check('POST and Unseen together narrow to the untested POSTs', post.length === 3 && post.every(m => m === 'POST'), JSON.stringify(post))
  await page.type('#details input[type=search]', 'refresh')
  await sleep(200)
  check('words narrow the list further', JSON.stringify((await panel()).rows) === '["/auth/refresh"]', JSON.stringify((await panel()).rows))
  await page.keyboard.press('Escape')
  await sleep(100)
  check('Esc in the words clears them first', (await panel()).rows.length === 3)
  await page.keyboard.press('Escape')
  await sleep(200)
  check('a second Esc puts the list down: the outline is back, focus on its heading', (await panel()).kind === 'Whole map' && await page.evaluate(() => document.activeElement === document.querySelector('#details h2')))

  // Reachable from the default view: the whole map's outline leads with the surface.
  const outline = await page.evaluate(() => [...document.querySelectorAll('#details .d-surface button')].map(b => b.textContent))
  check('the whole map\'s panel offers Endpoints · 67 and Unseen · 4', outline.includes('Endpoints · 67') && outline.includes('Unseen · 4'), JSON.stringify(outline))

  // 4. The default view states the surface: the apps' cards and panels, a controller's Serves.
  const cards = await page.evaluate(() => { const s = window.__spike; return ['backend', 'browser', 'devtools', 'backend.market', 'backend.market.offers.marketController'].map(id => s.renderer.surface(s.id(id))) })
  check('cards state their surface: endpoints served, endpoints called, scheduled jobs, a controller\'s routes', cards[0] === '67 endpoints · 1 scheduled job' && /^calls \d+ endpoints$/.test(cards[1]) && /^calls \d+ endpoints$/.test(cards[2]) && /^\d+ endpoints$/.test(cards[3]) && cards[4] === 'serves 5 endpoints', JSON.stringify(cards))
  await page.evaluate(() => { const s = window.__spike; s.controls.goSelect(s.id('browser')) })
  await landed()
  const client = await page.evaluate(() => [...document.querySelectorAll('#details .d-surface button')].map(b => b.textContent))
  check('a client\'s panel says how many endpoints it calls, and lists them', client.some(b => /^Calls \d+ endpoints$/.test(b)), JSON.stringify(client))
  await open(`${map}&at=backend.market.offers.marketController`)
  await landed()
  const serves = await page.evaluate(() => {
    const d = document.getElementById('details'), first = d.querySelector('.d-file').nextElementSibling
    return { lead: first?.querySelector('h3')?.textContent, rows: [...first.querySelectorAll('.d-ep b')].map(b => b.textContent) }
  })
  check('a controller\'s panel leads with Serves, its routes in file order', serves.lead === 'Serves · 5' && serves.rows.join() === '/market/create,/market/allies,/market/{resource},/market/{id}/buy,/market/{id}/withdraw', JSON.stringify(serves))
  await shot('03-controller-serves')
  // A Serves row crosses to Requests, on that endpoint.
  await clickText('#details .d-serves .d-ep', 'POST/market/{id}/buy')
  await crossed('requests')
  check('a Serves row opens its endpoint in Requests', (await selected()) === 'backend.market.e1', String(await selected()))

  // 4. Effect first: takes, reads and writes, returns (the generic kept), called by; the steps folded.
  await landed()
  const buy = await page.evaluate(() => {
    const d = document.getElementById('details'), sec = c => d.querySelector(`.d-effect.${c}`)
    const steps = d.querySelector('.d-impl')
    return {
      order: [...d.querySelectorAll('section')].map(s => s.querySelector('h3, .d-more')?.textContent.split(' · ')[0]),
      takes: [...sec('takes').querySelectorAll('b')].map(b => b.textContent),
      writes: [...sec('data').querySelectorAll('li.writes')].map(li => li.textContent),
      code: sec('data').querySelector('.d-rel b')?.textContent, note: sec('data').querySelector('.d-note')?.textContent ?? '',
      returns: sec('returns').querySelector('b')?.textContent, statuses: sec('returns').querySelector('.d-sub')?.textContent,
      callers: [...sec('callers').querySelectorAll('.d-rel')].map(b => `${b.querySelector('b').textContent}|${b.querySelector('em')?.textContent ?? ''}`),
      folded: steps?.querySelector('.d-more').getAttribute('aria-expanded') === 'false' && steps.querySelector('div').hidden,
      seen: d.querySelector('p.d-seen')?.textContent, handler: d.querySelector('.d-handler')?.textContent,
    }
  })
  await shot('04-buy-effects')
  check('buy leads with takes, reads and writes, returns and callers, steps after', buy.order.slice(0, 5).join() === 'Takes,Reads and writes,Returns,Called by,Implementation steps', JSON.stringify(buy.order))
  check('buy takes its id from the path and the DTO it is sent', buy.takes.includes('id') && buy.takes.includes('BuyMarketOfferDto') && !buy.takes.includes('MarketPurchaseDto'), JSON.stringify(buy.takes))
  check('buy returns ActionResult<MarketPurchaseDto>, with the statuses the tests saw', buy.returns === 'ActionResult<MarketPurchaseDto>' && /200 ×6,654 · 400 ×11 · 401 ×5 · 409 ×5/.test(buy.statuses), JSON.stringify(buy))
  check('buy names the tables it writes in tests, apart from the store call on its code path, and says they differ', buy.writes.some(w => w.startsWith('market_offer_entity') && w.endsWith('deletes, updates')) && buy.writes.length === 4 && buy.code === 'Game database' && /^4 of the 5 tables the tests saw are not on the code path the map follows \(market_offer_entity, market_transaction_entity, notification_entity, user_entity\)/.test(buy.note), JSON.stringify(buy))
  check('buy is called by the game client (outside the trace) and the development tools', buy.callers.some(c => c.startsWith('Game client|outside the trace')) && buy.callers.some(c => c.startsWith('Development tools|')), JSON.stringify(buy.callers))
  check('buy says it was seen in tests and who handles it; its steps are one expand away', /Seen in tests: 6,675 HTTP requests/.test(buy.seen) && buy.handler === 'Handled by MarketController.buyOffer' && buy.folded, JSON.stringify(buy))
  await clickText('#details .d-impl .d-more', 'Implementation steps')
  check('Implementation steps opens the request in order', await page.evaluate(() => !document.querySelector('.d-impl > div').hidden && document.querySelector('.d-impl .d-steps h3')?.textContent === 'The request, in order'))
  const response = await page.evaluate(() => { const s = window.__spike; return s.tree.els[s.id('backend.market.e1.response')].description })
  check('the response card keeps the generic type', response === 'Returns ActionResult<MarketPurchaseDto> as JSON.', response)
  // An endpoint no test called says so first.
  await page.evaluate(() => { const s = window.__spike; s.select(s.tree.els.findIndex(e => e.title === 'POST /config')) })
  await sleep(200)
  check('an endpoint no test called says so, in amber', await page.evaluate(() => document.querySelector('#details p.d-seen.none')?.textContent.startsWith('Not seen in tests')))

  // 1 in Requests too: the list, a row selects its endpoint, and its panel leads back to the list.
  await page.evaluate(() => { window.__spike.controls.enterPlace(0) })
  await landed()
  await clickText('#details .d-surface button', 'Endpoints · 67')
  await sleep(200)
  await clickText('#details .d-filters button', 'GET')
  await clickText('#details .d-ep', 'GET/war/spy-reports')
  await landed()
  check('in Requests a row selects its endpoint', (await selected()) === (await page.evaluate(() => window.__spike.tree.els.find(e => e.title === 'GET /war/spy-reports').id)))
  await clickText('#details .d-back', '← Back to Endpoints')
  await sleep(200)
  check('the endpoint leads back to the list, filter kept', await page.evaluate(() => document.querySelector('#details h2').textContent === 'Endpoints · 67' && document.querySelector('#details .d-filters button[aria-pressed=true]').textContent.startsWith('GET')))

  // 2. Search: one file shown by many endpoints is one row, opening out into them.
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.querySelector('#stage canvas').focus())
  await page.keyboard.press('/')
  await page.keyboard.type('KingdomRepository')
  await sleep(300)
  const shared = await page.evaluate(() => [...document.querySelectorAll('.palette .row')].map(r => `${r.querySelector('.kind').textContent}|${r.querySelector('b').textContent}`))
  check('search shows a shared file once, with how many places hold it', shared.filter(r => r.endsWith('|KingdomRepository')).length === 1 && /^file ×\d\d+\|KingdomRepository$/.test(shared.find(r => r.endsWith('|KingdomRepository'))), JSON.stringify(shared))
  await page.evaluate(() => [...document.querySelectorAll('.palette .row')].find(r => r.querySelector('b').textContent === 'KingdomRepository').click())
  await sleep(200)
  const out = await page.evaluate(() => ({ open: !document.querySelector('.palette').hidden, rows: [...document.querySelectorAll('.palette .row .sub')].map(s => s.textContent) }))
  check('picking it opens out into each endpoint it is a step of', out.open && out.rows.length > 20 && out.rows.slice(1).every(s => /^step \d+ of (GET|POST) /.test(s)), JSON.stringify(out).slice(0, 300))
  await shot('05-shared-file')
  await page.keyboard.press('Escape')

  // 2. Search from Architecture finds an endpoint by its words and crosses to it.
  await open(map)
  await page.evaluate(() => document.querySelector('#stage canvas').focus())
  await page.keyboard.press('/')
  await page.keyboard.type('endpoints')
  await sleep(300)
  check('"endpoints" offers the whole list first', await page.evaluate(() => document.querySelector('.palette .row b').textContent === 'Endpoints · 67'))
  await page.evaluate(() => { const i = document.querySelector('.palette input'); i.value = '' })
  await page.keyboard.type('buy')
  await sleep(300)
  const found = await page.evaluate(() => [...document.querySelectorAll('.palette .row')].map(r => `${r.querySelector('.kind').textContent}|${r.querySelector('b').textContent}`))
  check('search in Architecture finds the buy endpoints', found.includes('endpoint|POST /market/{id}/buy') && found.includes('endpoint|POST /kingdom/buy-land'), JSON.stringify(found))
  await shot('06-search-architecture')
  await page.evaluate(() => [...document.querySelectorAll('.palette .row')].find(r => r.querySelector('b').textContent === 'POST /market/{id}/buy').click())
  await crossed('requests')
  check('picking it opens Requests on that endpoint', (await selected()) === 'backend.market.e1', String(await selected()))

  // 5. A feature meets its pages, endpoints and data, nothing selected.
  await open(map)
  await page.evaluate(() => window.__spike.controls.feature('Market'))
  await landed()
  const feat = await page.evaluate(() => {
    const d = document.getElementById('details'), sec = c => [...d.querySelectorAll(`.${c} li`)].map(li => li.textContent)
    return { kind: d.querySelector('.d-kind').textContent, h2: d.querySelector('h2').textContent, pages: sec('d-pages'), endpoints: [...d.querySelectorAll('.d-serves .d-ep b')].map(b => b.textContent), data: sec('d-tables'), parts: sec('d-parts'), selected: window.__spike.renderer.selected }
  })
  await shot('07-feature')
  check('a feature shows its pages, its endpoints and the data they touch, nothing selected', feat.kind === 'Feature' && feat.h2 === 'Market' && feat.pages.join() === 'Market' && feat.endpoints.includes('/market/{id}/buy') && feat.endpoints.length === 5 && feat.data.some(t => t.startsWith('market_offer_entity')) && feat.parts.length > 0 && feat.selected === -1, JSON.stringify(feat))
  await page.keyboard.press('Escape')
  await sleep(200)
  check('Esc puts the feature down: the outline is back', await page.evaluate(() => document.getElementById('details').classList.contains('outline')))

  // 6. The address names the place and the selection together, and a reload restores both.
  await page.evaluate(() => { const s = window.__spike; s.controls.enterPlace(s.id('backend.market')) })
  await landed()
  await page.evaluate(() => { const s = window.__spike; s.select(s.id('backend.market.offers')) })
  await sleep(700)
  const q1 = await query()
  check('the address writes in= and at= together', q1.in === 'backend.market' && q1.at === 'backend.market.offers', JSON.stringify(q1))
  await page.reload({ waitUntil: 'load' })
  await ready()
  const back = await page.evaluate(() => { const s = window.__spike, p = s.renderer.breadcrumb(); return { sel: s.tree.els[s.renderer.selected]?.id, here: s.tree.els[p[p.length - 1]]?.id } })
  check('a reload frames the place and selects the selection', back.sel === 'backend.market.offers' && back.here === 'backend.market', JSON.stringify(back))

  // 6. Switching views keeps the request: a step of withdraw (in a file buy runs too) goes to Architecture and comes back to withdraw.
  await open(`${map}&view=requests`)
  const step = await page.evaluate(() => {
    const s = window.__spike, t = s.tree
    const ep = t.els.findIndex(e => e.title === 'POST /market/{id}/withdraw')
    const k = t.children[ep].find(c => t.els[c].title.endsWith('· MarketService'))
    s.controls.goSelect(k)
    return { id: t.els[k].id, ep: t.els[ep].id }
  })
  await landed()
  await sleep(400)
  const toArch = await page.evaluate(() => [...document.querySelectorAll('#views a')].find(a => a.textContent === 'Architecture').href)
  check('leaving Requests carries the file and the request', toArch.includes('file=backend/src/main/java/com/knightsofdarkness/web/market/MarketService.java') && toArch.includes(`req=${step.id}`), toArch)
  await page.goto(toArch, { waitUntil: 'load' })
  await ready()
  await sleep(400)
  check('Architecture selects the file and keeps the request in its address', /marketService$/.test(await selected()) && (await query()).req === step.id, JSON.stringify({ sel: await selected(), q: await query() }))
  const toReq = await page.evaluate(() => [...document.querySelectorAll('#views a')].find(a => a.textContent === 'Requests').href)
  await page.goto(toReq, { waitUntil: 'load' })
  await ready()
  check('switching back returns to the same step of withdraw, not of buy', (await selected()) === step.id, JSON.stringify({ sel: await selected(), want: step.id, toReq }))
  // A part crosses to the resource its handlers serve.
  await open(`${map}&at=backend.market`)
  await sleep(600)
  const part = await page.evaluate(() => [...document.querySelectorAll('#views a')].find(a => a.textContent === 'Requests').href)
  check('a part crosses to the resource of the endpoints it handles', new URL(part).searchParams.get('in') === 'backend.market', part)

  // Returning from Architecture comes back to the card left: the endpoint itself, or its response.
  for (const at of ['backend.market.e1', 'backend.market.e1.response']) {
    await open(`${map}&view=requests&at=${at}`)
    await sleep(500)
    await page.goto(await page.evaluate(() => [...document.querySelectorAll('#views a')].find(a => a.textContent === 'Architecture').href), { waitUntil: 'load' })
    await ready()
    await sleep(500)
    await page.goto(await page.evaluate(() => [...document.querySelectorAll('#views a')].find(a => a.textContent === 'Requests').href), { waitUntil: 'load' })
    await ready()
    check(`Requests → Architecture → Requests comes back to ${at}`, (await selected()) === at, String(await selected()))
  }

  // Takes reads the handler's parameters: what it is sent, apart from what it only builds for its reply.
  await open(`${map}&view=requests&at=backend.auth.e2`)
  await page.waitForFunction(() => /Also names/.test(document.querySelector('#details .d-effect.takes')?.textContent ?? ''), { timeout: 10000 }).catch(() => {})
  const auth = await page.evaluate(() => { const s = document.querySelector('#details .d-effect.takes'); return { taken: [...s.querySelectorAll('ul')[0].querySelectorAll('.d-rel')].map(b => b.innerText.replace(/\s+/g, ' ')), also: s.querySelectorAll('ul')[1]?.innerText ?? '' } })
  check('authenticate takes AuthRequestDto as its body and only names AuthResponseDto', auth.taken.some(t => t.startsWith('AuthRequestDto the request body')) && !auth.taken.some(t => t.startsWith('AuthResponseDto')) && auth.also.includes('AuthResponseDto'), JSON.stringify(auth))
  await open(`${map}&view=requests&at=backend.market.e1`)
  check('a table written and read counts as both', /In tests: writes 4 tables, reads 3/.test((await panel()).text), (await panel()).text.slice(0, 900))

  // A surface that arrives after a selection by keyboard is drawn, and focus stays on the heading.
  await page.setRequestInterception(true)
  const slow = r => { if (r.url().includes('knights-of-darkness.requests.json')) setTimeout(() => r.continue(), 2500); else r.continue() }
  page.on('request', slow)
  await page.goto(`${base}?${map}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready, { timeout: 60000 })
  await page.evaluate(() => [...document.querySelectorAll('#details .d-outline button')].find(b => b.querySelector('b').textContent === 'Game server').focus())
  await page.keyboard.press('Enter')
  await sleep(3500)
  const late = await page.evaluate(() => ({ surface: [...document.querySelectorAll('#details .d-surface button')].map(b => b.textContent), focus: document.activeElement === document.querySelector('#details h2') }))
  check('a surface that arrives late reaches the open panel, focus kept on its heading', late.surface.includes('Endpoints · 67') && late.focus, JSON.stringify(late))
  page.off('request', slow)
  await page.setRequestInterception(false)

  // A client's pages are on its surface.
  await open(`${map}&at=browser`)
  check('the game client lists its pages', await page.evaluate(() => [...document.querySelectorAll('#details .d-surface .d-more')].some(b => b.textContent === 'Pages · 15')))

  // A search's whole match list holds what the search matched.
  await page.evaluate(() => document.querySelector('#stage canvas').focus())
  await page.keyboard.press('/')
  await page.keyboard.type('post kingdom')
  await sleep(300)
  const more = await page.evaluate(() => [...document.querySelectorAll('.palette .row b')].map(b => b.textContent).find(t => /^All \d+ matching endpoints$/.test(t)))
  await page.evaluate(() => [...document.querySelectorAll('.palette .row')].find(r => /^All \d+ matching/.test(r.querySelector('b').textContent)).click())
  await sleep(300)
  check('"All N matching endpoints" lists those N', !!more && (await panel()).rows.length === Number(more.match(/\d+/)[0]), JSON.stringify({ more, rows: (await panel()).rows.length }))
  await page.keyboard.press('Escape')

  // Keyboard: an endpoint picked by search in Architecture opens in Requests with focus on its heading.
  await page.evaluate(() => document.querySelector('#stage canvas').focus())
  await page.keyboard.press('/')
  await page.keyboard.type('market buy')
  await sleep(300)
  await page.keyboard.press('Enter')
  await crossed('requests')
  check('an endpoint picked by keyboard opens with focus on its heading', await page.evaluate(() => document.activeElement === document.querySelector('#details h2')), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)))

  // A scheduled job shown from Requests opens its file in Architecture.
  await open(`${map}&view=requests`)
  await page.evaluate(() => { document.querySelector('#details .d-surface .d-more')?.click() })
  await clickText('#details .d-jobs .cite', 'BotClock')
  await crossed('')
  check('a scheduled job from Requests opens in Architecture', /botClock$/i.test(await selected() ?? ''), String(await selected()))

  // Older maps: every route, whole; their Serves name no line they do not know; a shared file's places differ.
  await open('model=petclinic')
  const pc = await page.evaluate(() => { [...document.querySelectorAll('#details .d-surface button')].find(b => b.textContent.startsWith('Endpoints')).click(); return [...document.querySelectorAll('#details .d-ep b')].map(b => b.textContent) })
  check('an older map lists every route, a shortened one whole', pc.length === 17 && pc.includes('/owners/{ownerId}/edit'), JSON.stringify(pc))
  await open('model=petclinic&at=petclinic.owners.ownerController')
  check('Serves names no line the map does not know', !/line 1\b/.test(await page.evaluate(() => document.querySelector('#details .d-serves').innerText)))
  await page.evaluate(() => window.__spike.controls.feature('Find owners'))
  await sleep(500)
  const fo = await page.evaluate(() => ({ pages: [...document.querySelectorAll('#details .d-pages li')].map(l => l.textContent), eps: [...document.querySelectorAll('#details .d-serves .d-ep')].map(b => b.getAttribute('aria-label').split(':')[0]) }))
  check('a feature on a shared controller gets the endpoints it names, and its templates as pages', fo.pages.length === 2 && !fo.eps.some(e => e.startsWith('POST /owners/new')) && fo.eps.some(e => e.startsWith('GET /owners/find')), JSON.stringify(fo))
  await open('model=petclinic&view=requests')
  await page.evaluate(() => document.querySelector('#stage canvas').focus())
  await page.keyboard.press('/')
  await page.keyboard.type('OwnerRepository')
  await sleep(300)
  await page.evaluate(() => [...document.querySelectorAll('.palette .row')].find(r => /^file ×/.test(r.querySelector('.kind').textContent))?.click())
  await sleep(200)
  const subs = await page.evaluate(() => [...document.querySelectorAll('.palette .row .sub')].slice(1).map(s => s.textContent))
  check('an older map\'s shared file opens out into places that say their route', subs.length > 2 && new Set(subs).size === subs.length && subs.every(s => /^step \d+ of (GET|POST) \//.test(s)), JSON.stringify(subs))
  await page.keyboard.press('Escape')
  await open('model=zoom-in-architecture')
  await page.evaluate(() => window.__spike.controls.feature('Map a repository'))
  await sleep(400)
  check('a map with no pages calls nothing a page', await page.evaluate(() => document.querySelector('#details .d-kind').textContent === 'Feature' && !document.querySelector('#details .d-pages')))

  // On a phone, See the API puts the welcome away so the list is in view.
  await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true })
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}?${map}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__spike?.ready && document.querySelector('#welcome button.api'), { timeout: 60000 })
  await page.click('#welcome button.api')
  await sleep(500)
  const phone = await page.evaluate(() => { const h = document.querySelector('#details h2').getBoundingClientRect(), f = document.querySelector('#details .d-filters').getBoundingClientRect(); const top = (x, y) => document.elementFromPoint(x, y)?.closest('#details') != null; return { welcome: document.getElementById('welcome').hidden, h2: top(h.left + 10, h.top + h.height / 2), filters: top(f.left + 10, f.top + f.height / 2) } })
  await shot('08-phone-list')
  check('on a phone See the API shows the list clear of the welcome', phone.welcome && phone.h2 && phone.filters, JSON.stringify(phone))
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
