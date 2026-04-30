import { describe, it, expect } from 'vitest'
import { PresetResolutionError, resolvePresets } from '#/lib/preset-resolver'

describe('resolvePresets', () => {
  it('returns [] for non-array input', () => {
    expect(resolvePresets(null, {})).toEqual([])
    expect(resolvePresets({}, {})).toEqual([])
    expect(resolvePresets('nope', {})).toEqual([])
  })

  it('passes presets through unchanged when no ${...} refs exist', () => {
    const raw = [
      { name: 'Local', host: '127.0.0.1', port: 5432, database: 'd', user: 'u', password: 'p' },
    ]
    expect(resolvePresets(raw, {})).toEqual(raw)
  })

  it('substitutes ${VAR} from the provided env', () => {
    const raw = [
      { name: 'Prod', host: '${DB_HOST}', port: 5432, database: 'd', user: 'u', password: '${DB_PWD}' },
    ]
    const out = resolvePresets(raw, { DB_HOST: 'db.internal', DB_PWD: 'secret' })
    expect(out[0].host).toBe('db.internal')
    expect(out[0].password).toBe('secret')
  })

  it('throws PresetResolutionError naming the missing variable', () => {
    const raw = [{ name: 'Prod', host: '${DB_HOST}', port: 5432, database: 'd', user: 'u', password: 'p' }]
    expect(() => resolvePresets(raw, {})).toThrow(PresetResolutionError)
    try {
      resolvePresets(raw, {})
    } catch (err) {
      expect(err).toBeInstanceOf(PresetResolutionError)
      const e = err as PresetResolutionError
      expect(e.missingVars).toEqual(['DB_HOST'])
      expect(e.presetName).toBe('Prod')
      expect(e.message).toContain('DB_HOST')
      expect(e.message).toContain('Prod')
    }
  })

  it('treats empty string env values as missing (no silent empty substitution)', () => {
    const raw = [{ name: 'Prod', host: 'h', port: 5432, database: 'd', user: 'u', password: '${DB_PWD}' }]
    expect(() => resolvePresets(raw, { DB_PWD: '' })).toThrow(PresetResolutionError)
  })

  it('reports each missing variable once', () => {
    const raw = [{ name: 'Prod', host: '${X}/${X}', port: 5432, database: 'd', user: 'u', password: '${Y}' }]
    try {
      resolvePresets(raw, {})
    } catch (err) {
      const e = err as PresetResolutionError
      expect(new Set(e.missingVars)).toEqual(new Set(['X', 'Y']))
    }
  })

  it('preserves non-string fields untouched', () => {
    const raw = [
      { name: 'Local', host: 'h', port: 5432, database: 'd', user: 'u', password: 'p', ssl: true },
    ]
    const out = resolvePresets(raw, {})
    expect(out[0].port).toBe(5432)
    expect(out[0].ssl).toBe(true)
  })
})
