// Publishes this repository as "zoom-in-architecture" from its committed map (maps/), so every
// checkout has a real codebase for tours and recordings at code level.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { publish } from './map.mjs'

export const SELF = 'zoom-in-architecture'

export function selfImport() {
  const map = JSON.parse(readFileSync(join(import.meta.dirname, '../maps', `${SELF}.json`), 'utf8'))
  const r = publish(join(import.meta.dirname, '../..'), map, { name: SELF, loose: true })
  if (!r.published) throw new Error(`self-import failed:\n${r.errors.join('\n')}`)
}
