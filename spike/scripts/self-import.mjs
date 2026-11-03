// Imports this repository into the viewer as "zoom-in-architecture": a real codebase that every
// checkout has, for tours and recordings at code level.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export const SELF = 'zoom-in-architecture'

export function selfImport() {
  const run = args => execFileSync(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] })
  run(['scripts/import-code.mjs', join(import.meta.dirname, '../..'), '--name', SELF])
  run(['scripts/extract-likec4.mjs', SELF])
}
