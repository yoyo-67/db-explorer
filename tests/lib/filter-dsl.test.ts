import { describe, it, expect } from 'vitest'
import { encodeInFilter, parsePredicate } from '#/lib/filter-dsl'

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



describe('in predicate (set filter)', () => {
  it('parses a pipe-separated value list', () => {
    expect(parsePredicate('in:alpha|beta')).toEqual({
      kind: 'in',
      values: ['alpha', 'beta'],
      hasNull: false,
    })
  })

  it('reads the \\N token as the NULL member rather than the literal text', () => {
    expect(parsePredicate('in:alpha|\\N')).toEqual({
      kind: 'in',
      values: ['alpha'],
      hasNull: true,
    })
  })

  it('unescapes \\| and \\\\ so values may contain the separator', () => {
    expect(parsePredicate('in:a\\|b|c\\\\d')).toEqual({
      kind: 'in',
      values: ['a|b', 'c\\d'],
      hasNull: false,
    })
  })

  it('keeps a value that merely looks like the null token', () => {
    // `\\N` is the token; `\\\\N` is a backslash followed by N.
    expect(parsePredicate('in:\\\\N')).toEqual({
      kind: 'in',
      values: ['\\N'],
      hasNull: false,
    })
  })

  it('treats an empty selection as no filter at all', () => {
    expect(parsePredicate('in:')).toBeNull()
  })

  it('leaves text merely containing in: alone', () => {
    expect(parsePredicate('checking in: later')).toEqual({
      kind: 'ilike',
      pattern: 'checking in: later',
    })
  })

  it('round-trips through encodeInFilter', () => {
    const input = encodeInFilter(['a|b', 'c\\d', '\\N', null])
    expect(parsePredicate(input)).toEqual({
      kind: 'in',
      values: ['a|b', 'c\\d', '\\N'],
      hasNull: true,
    })
  })

  it('encodes an empty selection as the empty string, which clears the filter', () => {
    expect(encodeInFilter([])).toBe('')
  })
})
