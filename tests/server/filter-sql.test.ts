import { describe, it, expect } from 'vitest'
import { compileFilters, compilePredicate } from '#/server/filter-sql'
import { parsePredicate } from '#/lib/filter-dsl'

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

describe('compilePredicate for in', () => {
  it('compiles a value list to native IN, so the index still applies', () => {
    expect(
      compilePredicate({ kind: 'in', values: ['a', 'b'], hasNull: false }, 'status', 'text'),
    ).toBe(`status IN ('a', 'b')`)
  })

  it('ORs in an IS NULL test when the null member is selected', () => {
    expect(
      compilePredicate({ kind: 'in', values: ['a'], hasNull: true }, 'status', 'text'),
    ).toBe(`(status IN ('a') OR status IS NULL)`)
  })

  it('compiles a null-only selection to a bare IS NULL', () => {
    expect(
      compilePredicate({ kind: 'in', values: [], hasNull: true }, 'status', 'text'),
    ).toBe(`status IS NULL`)
  })

  it('escapes quotes inside values', () => {
    expect(
      compilePredicate({ kind: 'in', values: ["o'brien"], hasNull: false }, 'name', 'text'),
    ).toBe(`name IN ('o''brien')`)
  })

  it('casts array columns to text, which have no equality against a literal', () => {
    expect(
      compilePredicate({ kind: 'in', values: ['x'], hasNull: false }, 'proacl', 'ARRAY'),
    ).toBe(`proacl::text IN ('x')`)
  })

  it('casts when the column type is unknown', () => {
    expect(
      compilePredicate({ kind: 'in', values: ['x'], hasNull: false }, 'mystery'),
    ).toBe(`mystery::text IN ('x')`)
  })

  it('leaves a uuid column comparing natively', () => {
    expect(
      compilePredicate({ kind: 'in', values: ['1259'], hasNull: false }, 'oid', 'oid'),
    ).toBe(`oid IN ('1259')`)
  })
})
