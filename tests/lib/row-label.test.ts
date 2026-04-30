import { describe, it, expect } from 'vitest'
import { getRowLabel } from '#/lib/row-label'
import type { ColumnInfo, ForeignKey } from '#/lib/types'

const cols = (...names: string[]): ColumnInfo[] =>
  names.map((name) => ({ name, dataType: 'text', isNullable: true }))

describe('getRowLabel', () => {
  it('prefers well-known label fields', () => {
    expect(getRowLabel({ id: 1, name: 'Alice' })).toBe('Alice')
    expect(getRowLabel({ id: 1, title: 'Hello' })).toBe('Hello')
    expect(getRowLabel({ id: 1, email: 'a@b.c' })).toBe('a@b.c')
  })

  it('uses preference order: name > title > email > username > label > slug', () => {
    expect(getRowLabel({ name: 'Alice', title: 'X' })).toBe('Alice')
    expect(getRowLabel({ title: 'X', email: 'a@b' })).toBe('X')
  })

  it('skips FK columns when scanning generic strings', () => {
    const fks: ForeignKey[] = [
      { fromTable: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id' },
    ]
    const label = getRowLabel(
      { id: 1, user_id: 'fk-uuid', notes: 'hello world' },
      cols('id', 'user_id', 'notes'),
      fks,
      'orders',
    )
    expect(label).toBe('hello world')
  })

  it('falls back to short string when no well-known field is present', () => {
    expect(getRowLabel({ id: 1, status: 'open' }, cols('id', 'status'))).toBe('open')
  })

  it('falls back to Row #id when nothing usable', () => {
    expect(getRowLabel({ id: 42 }, cols('id'))).toBe('Row #42')
  })

  it('falls back to literal "Row" when no id either', () => {
    expect(getRowLabel({}, [])).toBe('Row')
  })

  it('skips overly-long strings (≥ 100 chars)', () => {
    const long = 'a'.repeat(150)
    expect(getRowLabel({ id: 7, blob: long }, cols('id', 'blob'))).toBe('Row #7')
  })

  it('treats empty strings as no-label', () => {
    expect(getRowLabel({ name: '', id: 1 })).toBe('Row #1')
  })
})
