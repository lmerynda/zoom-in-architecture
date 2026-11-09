import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installSkills } from './zoom.mjs'

describe('install-skill', () => {
  const dirs = []
  const temp = () => { const d = mkdtempSync(join(tmpdir(), 'zoom-skill-')); dirs.push(d); return d }
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  it('installs each skill for Claude Code and Codex, naming the checkout its commands run from', () => {
    const zoom = temp().replace(/\\/g, '/'), home = temp()
    mkdirSync(join(zoom, 'skills', 'map-repo'), { recursive: true })
    writeFileSync(join(zoom, 'skills', 'map-repo', 'SKILL.md'), '---\nname: map-repo\n---\n\nRun `node <zoom>/spike/scripts/zoom.mjs graph <repo>`.\n')
    const stale = join(home, '.claude', 'skills', 'map-repo', 'old.md')
    mkdirSync(join(stale, '..'), { recursive: true })
    writeFileSync(stale, 'from an older install')

    expect(installSkills(home, zoom)).toEqual([join(home, '.claude', 'skills', 'map-repo'), join(home, '.codex', 'skills', 'map-repo')])
    for (const tool of ['.claude', '.codex']) {
      expect(readFileSync(join(home, tool, 'skills', 'map-repo', 'SKILL.md'), 'utf8')).toBe(
        `---\nname: map-repo\n---\n\n<!-- Installed by \`node ${zoom}/spike/scripts/zoom.mjs install-skill\` from ${zoom}/skills/map-repo: edit it there and install again. -->\n\n` +
        `Run \`node ${zoom}/spike/scripts/zoom.mjs graph <repo>\`.\n`)
    }
    // An install replaces the last one whole.
    expect(existsSync(stale)).toBe(false)
  })
})
