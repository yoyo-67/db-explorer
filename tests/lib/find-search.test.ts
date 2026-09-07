import { describe, expect, it } from 'vitest'
import { reachTableSearch, validateFindSearch } from '#/lib/find/find-search'
import { decodeConditions } from '#/lib/filter-model'

describe('validateFindSearch', () => {
  it('keeps a pasted value and an owner', () => {
    expect(validateFindSearch({ v: 'abc', owner: 'users' })).toEqual({
      v: 'abc',
      owner: 'users',
    })
  })

  it('drops empties and non-strings rather than searching for them', () => {
    expect(validateFindSearch({ v: '', owner: 7 })).toEqual({
      v: undefined,
      owner: undefined,
    })
  })
})

describe('reachTableSearch', () => {
  it('round-trips through the filter model as an equality condition', () => {
    const search = reachTableSearch('user_id', '9f1c2b4e-7a30-4d51-9c88-2f0e5a6b1d77')
    const [condition] = decodeConditions(search.q)
    expect(condition.column).toBe('user_id')
    expect(condition.op).toBe('eq')
    expect(condition.values).toEqual(['9f1c2b4e-7a30-4d51-9c88-2f0e5a6b1d77'])
  })

  it('survives a value carrying the separator the encoding uses', () => {
    const [condition] = decodeConditions(reachTableSearch('slug', 'a~b|c').q)
    expect(condition.values).toEqual(['a~b|c'])
  })
})
