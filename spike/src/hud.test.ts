import { describe, expect, it } from 'vitest'
import { ago } from './hud'

describe('ago', () => {
  const now = Date.parse('2026-11-09T12:00:00Z')
  it('says how old an upload is in its largest whole unit', () => {
    expect(ago('2026-11-09T11:59:30Z', now)).toBe('just now')
    expect(ago('2026-11-09T11:56:00Z', now)).toBe('4 min ago')
    expect(ago('2026-11-09T10:00:00Z', now)).toBe('2 h ago')
    expect(ago('2026-11-08T11:00:00Z', now)).toBe('1 day ago')
    expect(ago('2026-11-06T12:00:00Z', now)).toBe('3 days ago')
  })
})
