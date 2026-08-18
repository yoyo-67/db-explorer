import { describe, it, expect } from 'vitest'
import {
  compileFilters,
  compilePredicate,
  parsePredicate,
} from '#/lib/filter-dsl'

describe('parsePredicate', () => {
  it('returns null for empty / whitespace input', () => {
    expect(parsePredicate('')).toBeNull()
    expect(parsePredicate('   ')).toBeNull()
  })

  it('parses null and !null tokens (case-insensitive)', () => {
    expect(parsePredicate('null')).toEqual({ kind: 'null', negated: false })
    expect(parsePredicate('NULL')).toEqual({ kind: 'null', negated: false })
    expect(parsePredicate('!null')).toEqual({ kind: 'null', negated: true })
    expect(parsePredicate('not null')).toEqual({ kind: 'null', negated: true })
  })

  it('parses comparison operators', () => {
    expect(parsePredicate('>10')).toEqual({ kind: 'cmp', op: '>', value: '10' })
    expect(parsePredicate('< 5')).toEqual({ kind: 'cmp', op: '<', value: '5' })
    expect(parsePredicate('>=2')).toEqual({ kind: 'cmp', op: '>=', value: '2' })
    expect(parsePredicate('<= 7')).toEqual({ kind: 'cmp', op: '<=', value: '7' })
    expect(parsePredicate('= foo')).toEqual({ kind: 'cmp', op: '=', value: 'foo' })
  })

  it('parses regex with leading ~', () => {
    expect(parsePredicate('~^foo')).toEqual({ kind: 'regex', pattern: '^foo' })
  })

  it('falls back to ILIKE for plain text input', () => {
    expect(parsePredicate('alice')).toEqual({ kind: 'ilike', pattern: 'alice' })
  })

  it('treats a bare comparison op without value as ILIKE (degrade not throw)', () => {
    // Malformed inputs should never throw
    expect(parsePredicate('>')).toEqual({ kind: 'ilike', pattern: '>' })
  })
})

describe('compilePredicate', () => {
  it('compiles null / not null', () => {
    expect(compilePredicate({ kind: 'null', negated: false }, 'email')).toBe(
      'email IS NULL',
    )
    expect(compilePredicate({ kind: 'null', negated: true }, 'email')).toBe(
      'email IS NOT NULL',
    )
  })

  it('emits raw numeric comparison when value parses as a number', () => {
    expect(compilePredicate({ kind: 'cmp', op: '>', value: '10' }, 'age')).toBe(
      `age > '10'`,
    )
  })

  it('falls back to ::text for non-numeric comparisons', () => {
    expect(compilePredicate({ kind: 'cmp', op: '=', value: 'foo' }, 'name')).toBe(
      `name::text = 'foo'`,
    )
  })

  it('compiles regex via ::text ~', () => {
    expect(compilePredicate({ kind: 'regex', pattern: '^a' }, 'slug')).toBe(
      `slug::text ~ '^a'`,
    )
  })

  it('compiles ILIKE wrapping the pattern with %', () => {
    expect(compilePredicate({ kind: 'ilike', pattern: 'bar' }, 'title')).toBe(
      `title::text ILIKE '%bar%'`,
    )
  })

  it('escapes single quotes inside ILIKE patterns', () => {
    expect(compilePredicate({ kind: 'ilike', pattern: "o'brien" }, 'name')).toBe(
      `name::text ILIKE '%o''brien%'`,
    )
  })

  it('quotes identifiers that are not safe bare identifiers', () => {
    // Mixed case forces quoting via pg-format %I.
    expect(
      compilePredicate({ kind: 'ilike', pattern: 'x' }, 'WeirdName'),
    ).toBe(`"WeirdName"::text ILIKE '%x%'`)
  })
})

describe('compileFilters', () => {
  it('returns empty string when nothing parses', () => {
    expect(compileFilters({})).toBe('')
    expect(compileFilters({ x: '', y: '   ' })).toBe('')
  })

  it('joins multiple predicates with AND', () => {
    const sql = compileFilters({ age: '>10', name: 'alice' })
    expect(sql).toBe(`age > '10' AND name::text ILIKE '%alice%'`)
  })

  it('skips columns whose input is empty', () => {
    const sql = compileFilters({ age: '>10', name: '' })
    expect(sql).toBe(`age > '10'`)
  })
})

describe('types with no equality against a literal', () => {
  it('matches array columns as text rather than failing', () => {
    // `proacl = 'x'` is a malformed-array-literal error on the server
    const sql = compilePredicate(parsePredicate('postgres')!, 'proacl', 'ARRAY')
    expect(sql).toBe("proacl::text ILIKE '%postgres%'")
  })

  it('matches user-defined columns as text', () => {
    const sql = compilePredicate(parsePredicate('unit')!, 'indpred', 'USER-DEFINED')
    expect(sql).toBe("indpred::text ILIKE '%unit%'")
  })

  it('leaves oid columns comparing natively, so the index still applies', () => {
    const sql = compilePredicate(parsePredicate('1259')!, 'oid', 'oid')
    expect(sql).toBe("oid = '1259'")
  })
})
