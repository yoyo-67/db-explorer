import { describe, expect, it } from 'vitest'
import { filterInputForValue, isFilterableValue } from '#/lib/inspect/value-filter'
import { compileFilters } from '#/lib/filter-dsl'

describe('filterInputForValue', () => {
  it('asks the DSL for a null test', () => {
    expect(filterInputForValue(null)).toBe('null')
  })

  it('asks for exact equality, not a substring match', () => {
    expect(filterInputForValue('foo')).toBe('=foo')
  })

  it('survives a value that starts with a DSL operator', () => {
    expect(filterInputForValue('>=3')).toBe('=>=3')
  })
})

describe('round trip through the filter DSL', () => {
  it('compiles a clicked text value to an exact comparison', () => {
    const where = compileFilters({ status: filterInputForValue('open') }, { status: 'text' })
    expect(where).toBe("status::text = 'open'")
  })

  it('compiles a clicked null to IS NULL', () => {
    expect(compileFilters({ note: filterInputForValue(null) }, { note: 'text' })).toBe(
      'note IS NULL',
    )
  })

  it('keeps a non-text column free of a cast so its index still applies', () => {
    expect(compileFilters({ kind: filterInputForValue('draft') }, { kind: 'order_kind' })).toBe(
      "kind = 'draft'",
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
