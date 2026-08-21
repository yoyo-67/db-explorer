import { describe, expect, it } from 'vitest'
import { conditionForValue, isFilterableValue } from '#/lib/inspect/value-filter'
import { compileCondition } from '#/server/filter-sql'

describe('conditionForValue', () => {
  it('asks for a null test when the clicked value is null', () => {
    expect(conditionForValue('status', null)).toMatchObject({
      column: 'status',
      op: 'isNull',
      values: [],
    })
  })

  it('asks for exact equality, never a substring match', () => {
    expect(conditionForValue('status', 'open')).toMatchObject({
      column: 'status',
      op: 'eq',
      values: ['open'],
    })
  })

  it('keeps a value that reads like an operator as the value it is', () => {
    expect(conditionForValue('qty', '>=3').values).toEqual(['>=3'])
  })

  it('names the condition after its column, so a second click replaces the first', () => {
    expect(conditionForValue('status', 'open').id).toBe(conditionForValue('status', 'done').id)
  })
})

describe('round trip into SQL', () => {
  it('compiles a clicked text value to an exact comparison', () => {
    expect(compileCondition(conditionForValue('status', 'open'), 'text')).toBe(
      "status = 'open'",
    )
  })

  it('compiles a clicked null to IS NULL', () => {
    expect(compileCondition(conditionForValue('note', null), 'text')).toBe('note IS NULL')
  })

  it('casts an enum column, which has no equality against a bare literal', () => {
    expect(compileCondition(conditionForValue('kind', 'draft'), 'USER-DEFINED')).toBe(
      "kind::text = 'draft'",
    )
  })
})

describe('isFilterableValue', () => {
  it('accepts null and rejects blank text', () => {
    expect(isFilterableValue(null)).toBe(true)
    expect(isFilterableValue('x')).toBe(true)
    expect(isFilterableValue('')).toBe(false)
    expect(isFilterableValue('   ')).toBe(false)
  })
})
