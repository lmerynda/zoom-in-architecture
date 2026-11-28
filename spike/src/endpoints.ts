import type { ElementJson, EntryPointJson, ModelJson } from './model'

/**
 * A map's HTTP surface, read from its Requests model: every endpoint with its method and path, the
 * resource it is grouped under, its handler, what it returns, and what the project's own tests
 * saw of it. Built from the model's JSON, not a Tree, so either view can hold it: the Requests view
 * from its own model, Architecture from the Requests model beside it.
 */
export interface Endpoint {
  /** Its element id in the Requests model. */
  id: string
  method: string
  route: string
  /** "POST /market/{id}/buy" */
  title: string
  /** The top-level part that serves it, and the resource group directly under that part. */
  app: string
  appTitle: string
  group: string
  groupTitle: string
  /** Its first step: the handler method, the file it is in and the line it starts at. */
  handler: { path: string; line: number; name: string } | null
  /** What it answers with, as written in the code: "ActionResult<MarketPurchaseDto>"; '' when not known. */
  returns: string
  /** The types it answers with, as the code names them: every response's model; none when not known. */
  answers: string[]
  /** Requests the project's own tests made to it; null when the map was not traced. */
  seen: number | null
  statuses: string
  tables: string
  /** Every card of its path, by file: a step's id in this endpoint for each path. */
  cards: { path: string; id: string }[]
}

export interface Api {
  endpoints: Endpoint[]
  /** The map was traced with the project's own tests: an endpoint with no requests was not called. */
  traced: boolean
  /** The Requests model's element parents, for crossing a place between views. */
  parent: Map<string, string | null>
  /** Element titles by id, for the parts calling an endpoint. */
  title: Map<string, string>
  /** Who calls each endpoint at runtime: the calling element, its top-level part, and the relation's words. */
  callers: Map<string, { from: string; top: string; title: string }[]>
}

const VERBS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY|ALL|WS|WEBSOCKET'
const TITLE = new RegExp(`^(${VERBS})\\s+((?:\\/|…)\\S*)$`, 'i')
/** A type as code writes it: a name, qualified or not, with generic or bracketed arguments; no phrase. */
const TYPE = /^[\p{L}_$][\p{L}\p{M}\p{N}_$.]*(?:[<[][\p{L}\p{M}\p{N}_$.,<>[\]?\s]*[>\]])?$/u
/** A name in a type, qualified or not, in any script: java.util.List, CaféResult. */
const TYPE_NAME = /[\p{L}_$][\p{L}\p{M}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{M}\p{N}_$]*)*/gu
/** The order methods are listed in. */
export const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const methodRank = (m: string) => { const k = METHOD_ORDER.indexOf(m); return k < 0 ? METHOD_ORDER.length : k }

/**
 * An endpoint's method and path, from its metadata, or, in maps built before endpoints carried
 * metadata, from a title of the form "GET /owners/find". Such a map shortens a path under a group
 * of its own ("GET …/edit" under "/owners/{ownerId}"): `parent`, the group's title, gives it back
 * whole. Null for anything else.
 */
export function endpointOf(e: Pick<ElementJson, 'title' | 'metadata'>, parent = ''): { method: string; route: string } | null {
  const m = e.metadata
  if (m?.method) return { method: m.method.toUpperCase(), route: m.route ?? e.title.replace(/^\S+\s+/, '') }
  const t = e.title.match(TITLE)
  if (!t) return null
  const group = parent.split(' · ')[0]
  return { method: t[1].toUpperCase(), route: t[2].startsWith('…') && group.startsWith('/') ? group.replace(/\/$/, '') + t[2].slice(1) : t[2] }
}

/** A route's parameter in any style and script: {id}, {id:int}, :slug, <int:id>. */
const PARAM = /\{([^}:]+)(?::[^}]*)?\}|:([\p{L}\p{M}\p{N}_]+)|<(?:[^:<>/]+:)?([\p{L}\p{M}\p{N}_]+)>/gu
/** The names of a route's parameters: "/market/{id}/buy" → id; ":slug" and "<int:id>" too. */
export function routeParams(route: string): string[] {
  return [...route.matchAll(PARAM)].map(m => m[1] ?? m[2] ?? m[3])
}

/** The Requests model's surface: its endpoints, ordered by app, resource and path. */
export function buildApi(model: ModelJson): Api {
  const byId = new Map(model.elements.map(e => [e.id, e]))
  const kids = new Map<string, ElementJson[]>()
  for (const e of model.elements) if (e.parent) kids.set(e.parent, [...(kids.get(e.parent) ?? []), e])
  const top = (e: ElementJson) => { let a = e; while (a.parent && byId.has(a.parent)) a = byId.get(a.parent)!; return a }
  const traced = !!model.published?.traced
  const endpoints: Endpoint[] = []
  for (const e of model.elements) {
    const mr = endpointOf(e, e.parent ? byId.get(e.parent)?.title : '')
    if (!mr) continue
    const app = top(e)
    let g = e
    while (g.parent && g.parent !== app.id && byId.has(g.parent)) g = byId.get(g.parent)!
    const steps = kids.get(e.id) ?? []
    const step = (s: ElementJson) => (s.metadata?.role === 'step' ? Number(s.metadata.step) : Number(s.title.match(/^(\d+) · /)?.[1] ?? NaN))
    const first = steps.filter(s => s.metadata?.path && step(s) === 1)[0] ?? steps.find(s => s.metadata?.path)
    const handler = first?.metadata?.path ? {
      path: first.metadata.path,
      // 0: the map does not say where in the file it starts.
      line: Number(first.metadata.span?.split('-')[0]) || 0,
      name: `${first.technology || first.metadata.path.split('/').pop()!.replace(/\.\w+$/, '')}.${first.title.replace(/^\d+ · /, '').replace(/\(\)$/, '')}`,
    } : null
    const response = steps.find(s => s.metadata?.role === 'response' && s.metadata.model) ?? steps.find(s => s.metadata?.role === 'response')
    const returns = response?.metadata?.model ?? e.description.match(/ returns (.+?)(?: as \w+)?\.?$/)?.[1] ?? ''
    // Every response's model; in maps built before responses carried one, the type the description
    // names in "returns Vets as JSON", when it is a type, not words ("what the handler returns") or
    // a format alone ("returns JSON").
    const models = [...new Set(steps.flatMap(s => (s.metadata?.role === 'response' && s.metadata.model ? [s.metadata.model] : [])))]
    const said = e.description.match(/ returns (.+?) as \w+\.?$/)?.[1] ?? ''
    const answers = models.length ? models : TYPE.test(said) ? [said] : []
    const seen = traced && e.metadata?.seen != null ? Number(e.metadata.seen) : null
    endpoints.push({
      id: e.id, method: mr.method, route: mr.route, title: `${mr.method} ${mr.route}`,
      app: app.id, appTitle: app.title, group: g === e ? app.id : g.id, groupTitle: g === e ? app.title : g.title,
      handler, returns, answers, seen, statuses: e.metadata?.statuses ?? '', tables: e.metadata?.tables ?? '',
      cards: steps.filter(s => s.metadata?.path).map(s => ({ path: s.metadata!.path, id: s.id })),
    })
  }
  // By path, a parameter after the fixed words beside it: /market/allies before /market/{id}/buy.
  const key = (r: string) => r.toLowerCase().replace(/[{:<]/g, '￿')
  const byRoute = (a: string, b: string) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)
  endpoints.sort((a, b) => a.appTitle.localeCompare(b.appTitle) || a.groupTitle.localeCompare(b.groupTitle) || byRoute(a.route, b.route) || methodRank(a.method) - methodRank(b.method))
  // Who calls each endpoint: a runtime relation from outside it into it or any of its steps.
  const within = (id: string, root: string) => { for (let a: string | null | undefined = id; a; a = byId.get(a)?.parent) if (a === root) return true; return false }
  const owner = new Map<string, string>()
  for (const ep of endpoints) { owner.set(ep.id, ep.id); for (const s of kids.get(ep.id) ?? []) owner.set(s.id, ep.id) }
  const callers = new Map<string, { from: string; top: string; title: string }[]>()
  for (const r of model.relations) {
    const ep = owner.get(r.target), src = byId.get(r.source)
    // A call at runtime; or, in maps built before callers carried a kind, a link from another app
    // (not from a person: "builds, tests and runs it" is no call).
    const runtime = (r.kind ?? (r.evidence ? 'runtime' : 'code')) === 'runtime'
    if (!ep || !src || within(r.source, ep)) continue
    const fromApp = !r.kind && top(src).id !== top(byId.get(ep)!).id && !/^(actor|person|user)$/.test(top(src).kind)
    if (!runtime && !fromApp) continue
    const list = callers.get(ep) ?? []
    if (!list.some(c => c.from === r.source)) list.push({ from: r.source, top: top(src).id, title: r.title })
    callers.set(ep, list)
  }
  return {
    endpoints, traced, callers,
    parent: new Map(model.elements.map(e => [e.id, e.parent])),
    title: new Map(model.elements.map(e => [e.id, e.title])),
  }
}

/**
 * Filters on the endpoint list: one app, or a given set (a component's, a feature's, a client's
 * calls) named by `label`; a method; only the ones no test called; words in the path, handler or type.
 */
export interface ApiFilter { app?: string | null; ids?: string[]; label?: string; method?: string | null; unseen?: boolean; query?: string }

export function filterApi(api: Api, f: ApiFilter): Endpoint[] {
  const q = (f.query ?? '').trim().toLowerCase()
  const ids = f.ids ? new Set(f.ids) : null
  return api.endpoints.filter(ep =>
    (!f.app || ep.app === f.app) &&
    (!ids || ids.has(ep.id)) &&
    (!f.method || ep.method === f.method) &&
    (!f.unseen || ep.seen === 0) &&
    (!q || `${ep.title} ${ep.handler?.name ?? ''} ${ep.returns}`.toLowerCase().includes(q)))
}

/** Endpoints grouped by resource, in list order, each group with its count. */
export function groupApi(eps: Endpoint[], manyApps: boolean): { key: string; title: string; endpoints: Endpoint[] }[] {
  const out = new Map<string, { key: string; title: string; endpoints: Endpoint[] }>()
  for (const ep of eps) {
    const key = ep.group
    const g = out.get(key) ?? { key, title: manyApps && ep.group !== ep.app ? `${ep.appTitle} · ${ep.groupTitle}` : ep.groupTitle, endpoints: [] }
    g.endpoints.push(ep)
    out.set(key, g)
  }
  return [...out.values()]
}

/** How many endpoints each method has, in METHOD_ORDER and then by name. */
export function methodCounts(eps: Endpoint[]): [string, number][] {
  const m = new Map<string, number>()
  for (const ep of eps) m.set(ep.method, (m.get(ep.method) ?? 0) + 1)
  return [...m].sort((a, b) => methodRank(a[0]) - methodRank(b[0]) || a[0].localeCompare(b[0]))
}

/** The top-level parts that call endpoints and serve none: clients. */
export function clientParts(api: Api): Set<string> {
  const serving = new Set(api.endpoints.map(ep => ep.app))
  const out = new Set<string>()
  for (const list of api.callers.values()) for (const c of list) if (!serving.has(c.top)) out.add(c.top)
  return out
}

/** The endpoints whose handler is in a file, in the order they stand in it. */
export function servedBy(api: Api, path: string): Endpoint[] {
  // Stable: endpoints whose line the map does not say keep the list's order.
  return api.endpoints.filter(ep => ep.handler?.path === path).sort((a, b) => a.handler!.line - b.handler!.line)
}

/** A way in and the top-level part whose code it is in; `name`, the method or callback it starts, when the code says. */
export interface Mark { path: string; line: number; top: string; name?: string }
/** Ways in by kind: HTTP routes from the scanner's marks; the rest from the map's own entry points (EntryPointJson). */
export interface Marks { route: Mark[]; schedule: Mark[]; message: Mark[]; socket: Mark[]; main: Mark[] }

/**
 * The ways into the map's code, by kind, once per file and line: the HTTP routes its files mark,
 * and the entry points the published map lists (`entryPoints`): scheduled jobs, message and event
 * handlers, socket entry points, program mains. A timer, handler or socket in a browser app (a
 * webapp part) or in a page or component file (a poll, an animation, a live view) is the page's own,
 * not a way into the system; a worker that also calls an API keeps its own.
 */
export function markedEntries(els: Pick<ElementJson, 'id' | 'parent' | 'kind' | 'metadata'>[], entryPoints: EntryPointJson[]): Marks {
  const byId = new Map(els.map(e => [e.id, e]))
  const top = (e: Pick<ElementJson, 'id' | 'parent'>) => { let a = e; while (a.parent && byId.has(a.parent)) a = byId.get(a.parent)!; return a.id }
  const page = (path: string) => /\.(tsx|jsx|vue|svelte|html?)$/i.test(path)
  const seen = new Set<string>()
  const out: Marks = { route: [], schedule: [], message: [], socket: [], main: [] }
  for (const e of els) {
    const path = e.metadata?.path
    if (!path) continue
    for (const m of (e.metadata?.marks ?? '').split(' ')) {
      const [line, kind] = m.split(':')
      if (kind !== 'route' || seen.has(`${path}:${line}`)) continue
      seen.add(`${path}:${line}`)
      out.route.push({ path, line: Number(line), top: top(e) })
    }
  }
  for (const ep of entryPoints) {
    const e = byId.get(ep.element), path = e?.metadata?.path
    if (!e || !path) continue
    const t = top(e)
    if (ep.kind !== 'main' && (page(path) || byId.get(t)?.kind === 'webapp')) continue
    out[ep.kind].push({ path, line: ep.line, top: t, ...(ep.name ? { name: ep.name } : {}) })
  }
  for (const k of ['route', 'schedule', 'message', 'socket', 'main'] as const) out[k].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
  return out
}

/** What the top-level cards are, in a reader's words, singular and plural; anything else is a part. */
const TOP_KINDS: [RegExp, string, string][] = [
  [/^(app|webapp|service|mobile|api|backend|frontend)$/, 'app', 'apps'],
  [/^(database|store|queue)$/, 'database', 'databases'],
  [/^(actor|person|user)$/, 'person', 'people'],
  [/^external$/, 'external system', 'external systems'],
  [/^system$/, 'system', 'systems'],
  [/^library$/, 'library', 'libraries'],
]

/** "2 apps, 1 database, 2 people": a map's top level counted by kind, apps and stores first, the rest as parts. */
export function topCounts(kinds: string[]): string[] {
  const n = new Map<number, number>()
  for (const k of kinds) { const t = TOP_KINDS.findIndex(([re]) => re.test(k)); n.set(t, (n.get(t) ?? 0) + 1) }
  const rank = (t: number) => (t < 0 ? TOP_KINDS.length : t)
  return [...n].sort((a, b) => rank(a[0]) - rank(b[0])).map(([t, c]) => `${c} ${t < 0 ? (c === 1 ? 'part' : 'parts') : TOP_KINDS[t][c === 1 ? 1 : 2]}`)
}

/** "kingdom_entity: UPDATE · user_entity: SELECT" per table, merged over several endpoints: every operation each saw. */
export function mergeTables(texts: string[]): string {
  const ops = new Map<string, Set<string>>()
  for (const t of texts) for (const part of t.split(' · ').map(s => s.trim()).filter(Boolean)) {
    const at = part.lastIndexOf(': ')
    const table = at < 0 ? part : part.slice(0, at)
    const set = ops.get(table) ?? new Set()
    for (const o of at < 0 ? [] : part.slice(at + 2).split(',')) if (o.trim()) set.add(o.trim())
    ops.set(table, set)
  }
  return [...ops].map(([t, s]) => (s.size ? `${t}: ${[...s].sort().join(', ')}` : t)).join(' · ')
}

/** A name as a whole word in code, in any script: Página in "Página p", not in "Páginas". `after` follows it. */
export const wordRe = (name: string, after = '') => new RegExp(`(?<![\\p{L}\\p{N}_$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_$])${after}`, 'u')

/** A file in a folder of pages: what a person looks at, by the project's own split. */
const PAGE_DIR = /(^|\/)(pages|screens|views|templates)\/|(^|\/)routes\/.*\.(tsx|jsx|vue|svelte|astro)$/i
/** A server-side template: a page as the server renders it. */
const TEMPLATE = /\.(html?|cshtml|razor|erb|jinja2?|hbs)$/i
/** A piece of a page by its name (MonumentPanel, OfferCard), though it sits in the pages folder. */
const PIECE = /(Panel|Modal|Dialog|Card|Button|Item|Row|Widget|Section|Tab|Header|Footer|Layout|Hook|Utils?|Helpers?)\.\w+$/

/**
 * A file a person looks at: a server-side template, or a file in a folder of pages whose name is not
 * a piece of one. (A component elsewhere is not a page.)
 */
export const isPage = (path: string) => TEMPLATE.test(path) || (PAGE_DIR.test(path) && !PIECE.test(path) && !LAYOUT.test(path))
/** A route file that frames pages rather than being one: __root, _layout. */
const LAYOUT = /\/_[^/]*$/

/**
 * The words of a name in any script and either Unicode form, lower case, camel case and acronyms
 * split: "Página deSaída" → página, de, saída; "getXMLSearch" → get, xml, search.
 */
const tokens = (s: string) => s.normalize('NFC').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2').replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
  .toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)
/** Words that end in s and are no plural. */
const SINGULAR_S = new Set(['news', 'series', 'species', 'alias', 'atlas', 'canvas', 'lens', 'chaos'])
/** A plural as its singular: owners → owner, pedidos → pedido; class, status, analysis and news stay. */
const fold = (w: string) => ([...w].length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) && !SINGULAR_S.has(w) ? w.slice(0, -1) : w)
const word = (w: string) => [...w].length > 2 && !['and', 'the', 'for', 'with'].includes(w)
/** Words of a name, plurals folded, small words dropped: "Find owners" → find, owner. */
const nameWords = (s: string) => tokens(s).filter(word).map(fold)

/** Words joined as code writes a phrase, the last one's plural folded: market, news → marketnews; sign, ups → signup. */
const joined = (t: string[]) => t.slice(0, -1).join('') + fold(t[t.length - 1])

/**
 * How many of a feature's words a route names: each word as it stands, or joined with up to two
 * words beside it, as code writes a phrase ("Sign up" is named by /signup and /sign-up, "Log in" by
 * logIn). A phrase named whole counts its short words too, so "Sign up" names /signup better than
 * /sign-in. The route's words are its fixed path and its method's name; a parameter ({user_id})
 * names a value, not the feature.
 */
export function namedWords(feature: string, route: string, method: string): number {
  const ts = tokens(feature), path = route.replace(PARAM, ' ')
  const have = new Set<string>()
  // Each segment of the path, and the method's name, as words and as their joined runs; a word
  // whose own parts are not known (signups) as written and as its singular.
  for (const seg of [...path.split('/'), method]) {
    const t = tokens(seg)
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j <= Math.min(t.length, i + 3); j++) { have.add(t.slice(i, j).join('')); have.add(joined(t.slice(i, j))) }
  }
  const hit = new Set<number>()
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j <= Math.min(ts.length, i + 3); j++) {
    const run = joined(ts.slice(i, j))
    if ([...run].length > 2 && have.has(run)) for (let k = i; k < j; k++) if (j - i > 1 || word(ts[k])) hit.add(k)
  }
  return hit.size
}

/**
 * A feature where the product's parts meet its surface: the cards that carry it, the pages among
 * them (see isPage), the endpoints whose handler is in a card that carries it, and the tables those
 * endpoints touched in tests. A handler that carries several features (one controller for finding,
 * adding and showing owners) gives the feature the endpoints whose route and method name its words
 * best (see namedWords), or whose answer is a type it alone lists, when no other feature of the
 * handler claims them too, by words, answer or page; the rest are `shared`, said as such, not
 * claimed. A route that renders one of its pages, or that one of its pages calls, is its own, even
 * when another feature's page makes it theirs too: a page is said in the code, not guessed.
 */
export function featureFacts(els: Pick<ElementJson, 'id' | 'parent' | 'title' | 'kind' | 'features' | 'metadata'>[], api: Api | null, name: string, calls: Map<string, string[]> = new Map()) {
  const byId = new Map(els.map(e => [e.id, e]))
  const carriers = els.filter(e => e.features?.includes(name))
  const featuresOf = (id: string) => { const out = new Set<string>(); for (let a = byId.get(id); a; a = a.parent ? byId.get(a.parent) : undefined) for (const f of a.features ?? []) out.add(f); return out }
  const pages = carriers.filter(e => isPage(e.metadata?.path ?? '')).map(e => e.id)
  const files = new Map(els.filter(e => e.metadata?.path).map(e => [e.metadata!.path, e.id]))
  const carried = (api?.endpoints ?? []).filter(ep => { const f = ep.handler && files.get(ep.handler.path); return !!f && featuresOf(f).has(name) })
  const handlerFeatures = (ep: Endpoint) => featuresOf(files.get(ep.handler!.path)!)
  const alone = (ep: Endpoint) => handlerFeatures(ep).size < 2
  // Among the routes of one shared handler, the ones a feature's words name best, when that tells
  // them from the rest; a handler's only route, when they name at least half of them. Words that
  // name nothing (a feature with none of its own) tell nothing. By the route and its method's name,
  // not its file's, which every route of the handler shares.
  const named = (f: string, ep: Endpoint) => {
    const hits = (x: Endpoint) => namedWords(f, x.route, x.handler?.name.split('.').pop() ?? '')
    const peers = (api?.endpoints ?? []).filter(x => x.handler?.path === ep.handler!.path).map(hits), mine = hits(ep)
    const best = Math.max(...peers), least = Math.min(...peers)
    return best > 0 && mine === best && (peers.length === 1 ? best >= Math.ceil(nameWords(f).length / 2) : best > least)
  }
  // The features of a shared handler that a route's answer carries: GET /vets returns Vets, a file
  // only "Vets as JSON or XML" lists. A type counts as a card of the route's own path whose file it
  // names whole and unambiguously (a qualified name by its folders; no literal value); the feature
  // is the card's own, not one of its folders'. Two of them claim it both, so neither has it.
  const answered = (ep: Endpoint): Set<string> => {
    const theirs = handlerFeatures(ep), stems = [...new Set(ep.cards.map(c => c.path))].map(p => [p, p.normalize('NFC').replace(/\.\w+$/, '')])
    const found = new Set<string>()
    for (const t of ep.answers) for (const id of t.normalize('NFC').replace(/(["'`]).*?\1/g, ' ').match(TYPE_NAME) ?? []) {
      const suffix = id.replace(/\./g, '/'), match = stems.filter(([, s]) => s === suffix || s.endsWith(`/${suffix}`))
      if (match.length !== 1) continue
      for (const f of byId.get(files.get(match[0][0]) ?? '')?.features ?? []) if (theirs.has(f)) found.add(f)
    }
    return found
  }
  // A route whose path renders one of a feature's pages, or that one of its pages calls (`calls`:
  // endpoint id → the page cards whose code calls it), serves that feature, whoever else its handler serves.
  const pagesOf = (f: string) => els.filter(e => e.features?.includes(f) && isPage(e.metadata?.path ?? ''))
  const byPage = (f: string, ep: Endpoint) => {
    const ps = pagesOf(f), paths = new Set(ps.map(e => e.metadata!.path)), ids = new Set(ps.map(e => e.id))
    return ep.cards.some(c => paths.has(c.path)) || (calls.get(ep.id) ?? []).some(p => ids.has(p))
  }
  // A shared handler's route is the feature's when its words or its answer point at it, and at none
  // of the handler's other features, nor is it another's by a page: a route claimed two ways is listed apart.
  const claims = (f: string, ep: Endpoint) => answered(ep).has(f) || named(f, ep)
  const own = (ep: Endpoint) => claims(name, ep) && ![...handlerFeatures(ep)].some(g => g !== name && (claims(g, ep) || byPage(g, ep)))
  const endpoints = (api?.endpoints ?? []).filter(ep => (carried.includes(ep) && (alone(ep) || own(ep))) || byPage(name, ep))
  const shared = carried.filter(ep => !endpoints.includes(ep))
  return { parts: carriers.filter(e => !pages.includes(e.id)).map(e => e.id), pages, endpoints, shared, tables: mergeTables(endpoints.map(ep => ep.tables)) }
}

/**
 * The parameter list of the handler declared at `line` (1-based; 0 when not known) of a file: the text between the
 * parentheses after its name, over as many lines as it runs. Null when it cannot be found.
 */
export function handlerParams(src: string, line: number, method: string): string | null {
  if (!method) return null
  // Where the map does not say (line 0), the first declaration of that name in the file.
  const all = src.split('\n'), text = (line >= 1 ? all.slice(line - 1, line + 15) : all).join('\n')
  const at = text.search(wordRe(method, '\\s*\\('))
  if (at < 0) return null
  const open = text.indexOf('(', at)
  let depth = 0
  for (let k = open; k < text.length; k++) {
    if (text[k] === '(') depth++
    else if (text[k] === ')' && --depth === 0) return text.slice(open + 1, k)
  }
  return null
}

/** Handler names too common to say which endpoint a page calls by them alone. */
const COMMON = new Set(['index', 'create', 'update', 'delete', 'remove', 'list', 'show', 'detail', 'details', 'handle', 'handler', 'read', 'get', 'post', 'put', 'patch', 'login', 'logout', 'main', 'root', 'health'])
const ident = (s: string) => s.toLowerCase().replace(/_/g, '')

/**
 * The endpoints a page's source calls, by the handler's own name: a client that wraps the API in
 * functions named after its handlers (`api.buyOffer(...)`, `LoginService.resetPassword(...)`) calls
 * `buyOffer` and `reset_password`. Names too short or too common to tell an endpoint are skipped.
 */
export function callsIn(src: string, eps: Endpoint[]): string[] {
  const called = new Set([...src.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map(m => ident(m[1])))
  return eps.filter(ep => { const m = ident(ep.handler?.name.split('.').pop() ?? ''); return m.length >= 6 && !COMMON.has(m) && called.has(m) }).map(ep => ep.id)
}

/** The line (1-based) a method of that name is first declared on, called with a parameter list; 0 when none is. */
export function declLine(src: string, method: string): number {
  if (!method) return 0
  const lines = src.split('\n'), re = wordRe(method, '\\s*\\(')
  const k = lines.findIndex(l => re.test(l) && !/^\s*(return|await|\.|\/\/|\*)|[=.]\s*$/.test(l) && !new RegExp(`[.=]\\s*${method}\\s*\\(`).test(l))
  return k + 1
}

/**
 * Which of the types a handler names it takes, and how: a parameter marked as the body is the
 * request body, one marked as a query or path value says so, any other is a parameter.
 */
export function takenTypes(params: string, types: string[]): Map<string, string> {
  const out = new Map<string, string>()
  // Split at top-level commas: generics hold commas of their own.
  const parts: string[] = []
  let depth = 0, from = 0
  for (let k = 0; k < params.length; k++) {
    const c = params[k]
    if ('<([{'.includes(c)) depth++
    else if ('>)]}'.includes(c)) depth--
    else if (c === ',' && depth === 0) { parts.push(params.slice(from, k)); from = k + 1 }
  }
  parts.push(params.slice(from))
  for (const t of types) {
    const p = parts.find(x => wordRe(t).test(x))
    if (!p) continue
    out.set(t, /@RequestBody|\[FromBody\]|\bBody\(|@Body\b/.test(p) ? 'the request body' : /@RequestParam|\[FromQuery\]|\bQuery\(|@Query\b/.test(p) ? 'a query parameter' : /@PathVariable|\[FromRoute\]|\bPath\(|@Param\b/.test(p) ? 'in the path' : 'a parameter of the handler')
  }
  return out
}
