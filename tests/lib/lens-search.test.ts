import { describe, expect, it } from 'vitest'
import {
  DAMP_OFF,
  dampKeysFromSearch,
  serializeDampKeys,
  validateLensSearch,
} from '#/lib/lens-search'

describe('validateLensSearch', () => {
  it('keeps the three known params', () => {
    expect(
      validateLensSearch({ damp: 'historical', basis: 'declared', focus: 'data_recording' }),
    ).toEqual({ damp: 'historical', basis: 'declared', focus: 'data_recording' })
  })

  it('drops an unknown basis rather than filtering to nothing', () => {
    expect(validateLensSearch({ basis: 'guessed' }).basis).toBeUndefined()
  })

  it('keeps the fallback notice from a Group this schema does not have', () => {
    expect(validateLensSearch({ absentGroup: 'Recordings' }).absentGroup).toBe(
      'Recordings',
    )
  })

  it('keeps the incoming switch three-valued, so absent can defer to the browser', () => {
    expect(validateLensSearch({}).incoming).toBeUndefined()
    expect(validateLensSearch({ incoming: true }).incoming).toBe(true)
    expect(validateLensSearch({ incoming: false }).incoming).toBe(false)
    // Round-tripped through a URL both arrive as strings.
    expect(validateLensSearch({ incoming: 'true' }).incoming).toBe(true)
    expect(validateLensSearch({ incoming: 'false' }).incoming).toBe(false)
    expect(validateLensSearch({ incoming: 'yes' }).incoming).toBeUndefined()
  })

  it('treats empty strings as absent', () => {
    expect(validateLensSearch({ damp: '', focus: '' })).toEqual({
      damp: undefined,
      basis: undefined,
      focus: undefined,
      absentGroup: undefined,
      incoming: undefined,
    })
  })
})

describe('dampKeysFromSearch', () => {
  it('damps historical and aggregation by default', () => {
    expect(dampKeysFromSearch(undefined)).toEqual(['historical', 'agg'])
  })

  it('turns damping off only for the explicit off value', () => {
    expect(dampKeysFromSearch(DAMP_OFF)).toEqual([])
  })

  it('accepts one key on its own', () => {
    expect(dampKeysFromSearch('historical')).toEqual(['historical'])
  })

  it('ignores unknown keys', () => {
    expect(dampKeysFromSearch('historical,nonsense')).toEqual(['historical'])
  })
})

describe('serializeDampKeys', () => {
  it('leaves the default out of the URL', () => {
    expect(serializeDampKeys(['historical', 'agg'])).toBeUndefined()
    expect(serializeDampKeys(['agg', 'historical'])).toBeUndefined()
  })

  it('writes the explicit off value when nothing is damped', () => {
    expect(serializeDampKeys([])).toBe(DAMP_OFF)
  })

  it('round-trips a partial selection', () => {
    const serialized = serializeDampKeys(['agg'])
    expect(serialized).toBe('agg')
    expect(dampKeysFromSearch(serialized)).toEqual(['agg'])
  })
})
