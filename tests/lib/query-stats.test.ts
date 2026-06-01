import { describe, it, expect } from 'vitest'
import { normalizeSql } from '#/lib/query-stats'

describe('normalizeSql', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeSql('SELECT   *\n  FROM users')).toBe('SELECT * FROM users')
  })

  it('replaces string and numeric literals with ?', () => {
    expect(normalizeSql("SELECT * FROM t WHERE id = '00000000-0000' AND n = 42")).toBe(
      'SELECT * FROM t WHERE id = ? AND n = ?',
    )
  })

  it('collapses IN-lists to IN (?)', () => {
    expect(normalizeSql('SELECT * FROM t WHERE id IN (1, 2, 3)')).toBe(
      'SELECT * FROM t WHERE id IN (?)',
    )
  })
})
