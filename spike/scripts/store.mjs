// The viewer service's side of an import: it stores the bundle a mapped project uploads and serves
// only from it. Nothing here knows where the project lives, and nothing reads it.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

/** The service's own folder (spike/): imports/, public/models/ and model/ live under it, wherever a command runs. */
export const ROOT = join(import.meta.dirname, '..')
const at = (root, ...p) => join(root, ...p)

/** The largest upload the service takes, in bytes: ZOOM_MAX_UPLOAD_MB, or 64 MB. */
export const maxUpload = (env = process.env) => (Number(env.ZOOM_MAX_UPLOAD_MB) || 64) * 1024 * 1024

/**
 * Whether an upload lacks the service's token. The service listens on this machine only unless it
 * is started with --host; a shared one sets ZOOM_TOKEN, and every upload must carry it.
 */
export const unauthorised = (authorization, env = process.env) => !!env.ZOOM_TOKEN && authorization !== `Bearer ${env.ZOOM_TOKEN}`

/** Plain model names only: the viewer serves models/<name>.json and nothing else. */
export const isName = name => typeof name === 'string' && /^[\w.-]+$/.test(name) && !/^\.+$/.test(name)

const humanize = s => s.replace(/[-_.]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase())

// The dev server watches public/models; a half-written file must never be read, and one cut off by a crash must never replace a good one.
export const writeAtomic = (file, text) => { const fd = openSync(`${file}.tmp`, 'w'); try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) } renameSync(`${file}.tmp`, file) }

/** Every model the viewer can open: the samples extracted from model/ and the imports. */
export function writeIndex(root = ROOT) {
  const list = dir => (existsSync(at(root, dir)) ? readdirSync(at(root, dir)).filter(n => statSync(at(root, dir, n)).isDirectory()) : [])
  const title = name => { try { return JSON.parse(readFileSync(at(root, 'imports', name, 'import.json'), 'utf8')).title } catch { return humanize(name) } }
  const has = file => existsSync(at(root, 'public/models', file))
  mkdirSync(at(root, 'public/models'), { recursive: true })
  const entries = [
    ...list('imports').filter(n => has(`${n}.json`)).map(n => ({ name: n, title: title(n), source: 'import', ...(has(`${n}.requests.json`) ? { views: ['requests'] } : {}) })),
    ...list('model').filter(n => has(`${n}.json`)).map(n => ({ name: n, title: n, source: 'sample' })),
  ]
  writeAtomic(at(root, 'public/models', 'index.json'), JSON.stringify(entries))
}

/**
 * Checks an uploaded bundle: a plain name, a model of that name, and sources only for files the
 * model shows, under relative paths. Returns the reasons it is refused, or none.
 */
export function refusals(bundle, root = ROOT) {
  const out = []
  if (!bundle || typeof bundle !== 'object') return ['the upload is not a bundle']
  if (!isName(bundle.name)) out.push(`"${bundle.name}" is not a model name: use letters, digits, ".", "-" and "_"`)
  if (!bundle.model || !Array.isArray(bundle.model.elements)) out.push('the bundle has no model')
  if (!bundle.map || !Array.isArray(bundle.map.nodes)) out.push('the bundle has no map')
  if (out.length) return out
  if (existsSync(at(root, 'model', bundle.name))) out.push(`"${bundle.name}" is a sample model's name; pass --name`)
  const shown = new Set(bundle.model.elements.map(e => e.metadata?.path).filter(Boolean))
  for (const p of Object.keys(bundle.sources ?? {})) {
    if (!shown.has(p) || p.startsWith('/') || posix.normalize(p) !== p || p.split('/').includes('..')) out.push(`source "${p}" is not a file the model shows`)
  }
  return out
}

/**
 * Stores a bundle as import `name`: imports/<name>/ keeps the map, its title and the uploaded
 * sources; public/models/<name>.json (and .requests.json) is what the viewer opens. The models are
 * written last, since writing them is what tells open viewers to update.
 */
export function storeBundle(bundle, root = ROOT) {
  const refused = refusals(bundle, root)
  if (refused.length) throw new Error(refused.join('\n'))
  const { name } = bundle
  const dir = at(root, 'imports', name)
  mkdirSync(dir, { recursive: true })
  // The sources are swapped in whole, so a reader never sees half of one upload and half of another.
  const fresh = at(dir, 'sources.new'), old = at(dir, 'sources.old')
  rmSync(fresh, { recursive: true, force: true })
  for (const [p, text] of Object.entries(bundle.sources ?? {})) {
    mkdirSync(dirname(at(fresh, p)), { recursive: true })
    writeAtomic(at(fresh, p), text)
  }
  mkdirSync(fresh, { recursive: true })
  rmSync(old, { recursive: true, force: true })
  if (existsSync(at(dir, 'sources'))) renameSync(at(dir, 'sources'), old)
  renameSync(fresh, at(dir, 'sources'))
  rmSync(old, { recursive: true, force: true })
  writeAtomic(at(dir, 'map.json'), `${JSON.stringify(bundle.map, null, 2)}\n`)
  writeAtomic(at(dir, 'import.json'), `${JSON.stringify({ title: bundle.model.title ?? humanize(name), ...(bundle.published ? { published: bundle.published } : {}) }, null, 2)}\n`)
  mkdirSync(at(root, 'public/models'), { recursive: true })
  // Each model says what it was built from, so a reader can tell a current map from an old one.
  const stamp = m => JSON.stringify(bundle.published ? { ...m, published: bundle.published } : m)
  writeAtomic(at(root, 'public/models', `${name}.json`), stamp(bundle.model))
  if (bundle.requests) writeAtomic(at(root, 'public/models', `${name}.requests.json`), stamp(bundle.requests))
  else rmSync(at(root, 'public/models', `${name}.requests.json`), { force: true })
  writeIndex(root)
}

/** An uploaded file's source for the code view, or null: only a file the stored model shows. */
export function storedSource(name, path, root = ROOT) {
  if (!isName(name) || typeof path !== 'string') return null
  try {
    const model = JSON.parse(readFileSync(at(root, 'public/models', `${name}.json`), 'utf8'))
    if (!model.elements.some(e => e.metadata?.path === path)) return null
    return readFileSync(at(root, 'imports', name, 'sources', path))
  } catch { return null }
}

/** The map an import was published with, for an agent re-mapping it, or null. */
export function storedMap(name, root = ROOT) {
  if (!isName(name)) return null
  try { return readFileSync(at(root, 'imports', name, 'map.json'), 'utf8') } catch { return null }
}

/** What an import's last upload was built from ({commit, dirty, at}), or null when it does not say. */
export function storedPublished(name, root = ROOT) {
  if (!isName(name)) return null
  try { return JSON.parse(readFileSync(at(root, 'imports', name, 'import.json'), 'utf8')).published ?? null } catch { return null }
}
