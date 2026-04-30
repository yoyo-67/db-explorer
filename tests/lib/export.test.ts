import { describe, it, expect } from 'vitest'
import { exportFilename, rowsToCsv } from '#/lib/export'
import type { ColumnInfo } from '#/lib/types'

const cols = (...names: string[]): ColumnInfo[] =>
  names.map((name) => ({ name, dataType: 'text', isNullable: true }))

describe('rowsToCsv', () => {
  it('emits header only for an empty row list', () => {
    expect(rowsToCsv(cols('id', 'name'), [])).toBe('id,name\r\n')
  })

  it('serializes rows in column order', () => {
    const out = rowsToCsv(cols('id', 'name'), [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ])
    expect(out).toBe('id,name\r\n1,Alice\r\n2,Bob\r\n')
  })

  it('quotes cells containing commas, quotes, or newlines', () => {
    const out = rowsToCsv(cols('a', 'b'), [
      { a: 'has, comma', b: 'plain' },
      { a: 'has "quote"', b: 'has\nnewline' },
    ])
    expect(out).toContain('"has, comma"')
    expect(out).toContain('"has ""quote"""')
    expect(out).toContain('"has\nnewline"')
  })

  it('serializes objects/arrays as JSON', () => {
    const out = rowsToCsv(cols('payload'), [{ payload: { a: 1, b: [2, 3] } }])
    expect(out).toContain('"{""a"":1,""b"":[2,3]}"')
  })

  it('emits an empty cell for null/undefined', () => {
    const out = rowsToCsv(cols('id', 'note'), [{ id: 1, note: null }])
    expect(out).toBe('id,note\r\n1,\r\n')
  })
})

describe('exportFilename', () => {
  it('builds <schema>.<table>.p<page>.<ext>', () => {
    expect(exportFilename('public', 'users', 3, 'csv')).toBe('public.users.p3.csv')
  })
})
