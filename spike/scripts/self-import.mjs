// Publishes this repository as "zoom-in-architecture" from its committed map (maps/), so every
// checkout has a real codebase for tours and recordings at code level. The viewer is this
// repository's own, so the bundle is stored directly rather than uploaded.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundle } from './map.mjs'
import { storeBundle } from './store.mjs'

export const SELF = 'zoom-in-architecture'

export function selfImport() {
  const map = JSON.parse(readFileSync(join(import.meta.dirname, '../maps', `${SELF}.json`), 'utf8'))
  const r = bundle(join(import.meta.dirname, '../..'), map, { name: SELF, loose: true })
  if (!r.bundle) throw new Error(`self-import failed:\n${r.errors.join('\n')}`)
  storeBundle(r.bundle)
}
