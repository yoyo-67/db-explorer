import { describe, expect, it } from 'vitest'
import { startupPreset } from '#/lib/startup-preset'
import type { ConnectionPreset } from '#/lib/types'

const preset = (name: string) =>
  ({ name, host: 'h', port: 1, database: 'd', user: 'u', password: 'p' }) as ConnectionPreset

describe('startupPreset', () => {
  it('is the preset DB_EXPLORER_PRESET names', () => {
    const presets = [preset('local'), preset('netlab remote')]
    expect(startupPreset(presets, { DB_EXPLORER_PRESET: 'netlab remote' })?.name).toBe('netlab remote')
  })

  it('is none when unset or naming no preset', () => {
    expect(startupPreset([preset('a')], {})).toBeNull()
    expect(startupPreset([preset('a')], { DB_EXPLORER_PRESET: 'b' })).toBeNull()
  })
})
