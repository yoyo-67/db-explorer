import { describe, expect, it } from 'vitest'
import { validateNeighborhoodSearch } from '#/lib/neighborhood-search'

describe('validateNeighborhoodSearch', () => {
  it('keeps two hops, as a number or a string', () => {
    expect(validateNeighborhoodSearch({ hops: 2 })).toEqual({ hops: 2 })
    expect(validateNeighborhoodSearch({ hops: '2' })).toEqual({ hops: 2 })
  })

  it('treats anything else as the one-hop default, left out of the URL', () => {
    for (const hops of [1, '1', 3, 'banana', null, undefined]) {
      expect(validateNeighborhoodSearch({ hops })).toEqual({})
    }
  })

  it('keeps a non-empty lookup column', () => {
    expect(validateNeighborhoodSearch({ col: 'uuid' })).toEqual({ col: 'uuid' })
    expect(validateNeighborhoodSearch({ col: '' })).toEqual({})
    expect(validateNeighborhoodSearch({ col: 4 })).toEqual({})
  })
})
