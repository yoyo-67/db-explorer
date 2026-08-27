import { describe, expect, it } from 'vitest'
import {
  buildRowEdit,
  describeFieldBlock,
  describeRowBlock,
  fieldBlock,
  fieldShape,
  fieldText,
  pgArrayLiteral,
  rowBlock,
  rowChanges,
  sameFieldText,
  validateRowEdit,
} from '#/lib/row-edit'
import type { ColumnInfo } from '#/lib/types'

function col(name: string, dataType: string, extra: Partial<ColumnInfo> = {}): ColumnInfo {
  return { name, dataType, isNullable: true, ...extra }
}

const columns: ColumnInfo[] = [
  col('id', 'integer', { isNullable: false }),
  col('email', 'character varying', { isNullable: false }),
  col('note', 'text'),
  col('age', 'integer'),
  col('active', 'boolean'),
  col('payload', 'jsonb'),
  col('tags', 'ARRAY'),
  col('created_at', 'timestamp with time zone'),
  col('slug', 'text', { isGenerated: true }),
]

describe('fieldText — the value as the input holds it', () => {
  it('keeps a string as it stands, never reformatting it', () => {
    expect(fieldText('  spaced  ')).toBe('  spaced  ')
    expect(fieldText('{"a":1}')).toBe('{"a":1}')
  })

  it('renders null as null, not as the word', () => {
    expect(fieldText(null)).toBeNull()
  })

  it('renders numbers and booleans as the literal Postgres will read', () => {
    expect(fieldText(42)).toBe('42')
    expect(fieldText(false)).toBe('false')
  })

  it('lays out a json object so it can be read and edited', () => {
    expect(fieldText({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('renders an array as the Postgres array literal, not as JSON', () => {
    expect(fieldText(['a', 'b'])).toBe('{a,b}')
  })
})

describe('pgArrayLiteral', () => {
  it('writes an empty array as the empty literal', () => {
    expect(pgArrayLiteral([])).toBe('{}')
  })

  it('leaves plain elements bare', () => {
    expect(pgArrayLiteral(['a', 'b', 'c'])).toBe('{a,b,c}')
    expect(pgArrayLiteral([1, 2])).toBe('{1,2}')
  })

  it('quotes an element carrying a delimiter, a brace or a quote', () => {
    expect(pgArrayLiteral(['a,b'])).toBe('{"a,b"}')
    expect(pgArrayLiteral(['{x}'])).toBe('{"{x}"}')
    expect(pgArrayLiteral(['say "hi"'])).toBe('{"say \\"hi\\""}')
    expect(pgArrayLiteral(['back\\slash'])).toBe('{"back\\\\slash"}')
  })

  it('quotes an element that would otherwise read as the NULL keyword', () => {
    expect(pgArrayLiteral(['NULL'])).toBe('{"NULL"}')
    expect(pgArrayLiteral([null])).toBe('{NULL}')
  })

  it('quotes an empty string, which bare would be nothing at all', () => {
    expect(pgArrayLiteral([''])).toBe('{""}')
  })

  it('refuses an array holding an array or an object', () => {
    expect(pgArrayLiteral([['a']])).toBeNull()
    expect(pgArrayLiteral([{ a: 1 }])).toBeNull()
  })
})

describe('fieldShape — what input a column gets', () => {
  it('reads the kind off the column type', () => {
    expect(fieldShape(col('age', 'integer')).kind).toBe('numeric')
    expect(fieldShape(col('active', 'boolean')).kind).toBe('boolean')
    expect(fieldShape(col('payload', 'jsonb')).kind).toBe('json')
  })

  it('gives json and unbounded text room to breathe', () => {
    expect(fieldShape(col('payload', 'jsonb')).multiline).toBe(true)
    expect(fieldShape(col('note', 'text')).multiline).toBe(true)
    expect(fieldShape(col('email', 'character varying')).multiline).toBe(false)
  })
})

describe('rowBlock — whether the row can be edited at all', () => {
  it('lets a table row with a primary key through', () => {
    expect(rowBlock({ tableKind: 'table', pkColumn: 'id', pkValue: '7' })).toBeNull()
  })

  it('stops a view: it has no rows of its own to update', () => {
    expect(rowBlock({ tableKind: 'view', pkColumn: 'id', pkValue: '7' })).toBe('view')
  })

  it('stops a table with no primary key: nothing identifies one row', () => {
    expect(rowBlock({ tableKind: 'table', pkColumn: null, pkValue: '7' })).toBe('no-pk')
  })

  it('stops a row whose key is null, which no equality can match', () => {
    expect(rowBlock({ tableKind: 'table', pkColumn: 'id', pkValue: null })).toBe('null-pk')
  })

  it('explains every block in a sentence', () => {
    for (const block of ['view', 'no-pk', 'null-pk'] as const) {
      expect(describeRowBlock(block).length).toBeGreaterThan(10)
    }
  })
})

describe('fieldBlock — whether one column can be edited', () => {
  it('lets an ordinary column through', () => {
    expect(fieldBlock(col('email', 'character varying'), 'x', 'id')).toBeNull()
  })

  it('stops the primary key, which is the handle the update is keyed on', () => {
    expect(fieldBlock(col('id', 'integer'), '7', 'id')).toBe('primary-key')
  })

  it('stops a generated column, which the database computes', () => {
    expect(fieldBlock(col('slug', 'text', { isGenerated: true }), 'a', 'id')).toBe('generated')
  })

  it('stops a value no text box can round-trip', () => {
    expect(fieldBlock(col('tags', 'ARRAY'), [['a']], 'id')).toBe('nested')
    expect(fieldBlock(col('tags', 'ARRAY'), ['a'], 'id')).toBeNull()
  })

  it('stops a column whose bytes were decoded for display', () => {
    // The box would hold the decoded document, and writing it back would store
    // that text as the bytes — the compressed original overwritten by a
    // rendering of itself.
    const events = col('events', 'bytea', { compression: { codec: 'brotli', encoding: 'json' } })
    expect(fieldBlock(events, '[]', 'id')).toBe('compressed')
  })

  it('explains every block in a sentence', () => {
    for (const block of ['primary-key', 'generated', 'nested', 'compressed'] as const) {
      expect(describeFieldBlock(block).length).toBeGreaterThan(10)
    }
  })
})

describe('sameFieldText — did this field actually change', () => {
  it('compares text exactly, whitespace included', () => {
    expect(sameFieldText('a', 'a', 'text')).toBe(true)
    expect(sameFieldText('a', 'a ', 'text')).toBe(false)
  })

  it('treats null as its own value, not as an empty string', () => {
    expect(sameFieldText(null, null, 'text')).toBe(true)
    expect(sameFieldText(null, '', 'text')).toBe(false)
  })

  it('compares json by what it means, so reformatting is not a change', () => {
    expect(sameFieldText('{"a":1,"b":2}', '{\n "b": 2,\n "a": 1\n}', 'json')).toBe(true)
    expect(sameFieldText('{"a":1}', '{"a":2}', 'json')).toBe(false)
  })

  it('falls back to text when json does not parse — a half-typed edit is a change', () => {
    expect(sameFieldText('{"a":1}', '{"a":1', 'json')).toBe(false)
  })
})

describe('rowChanges — the diff the review step shows', () => {
  const row = {
    id: 7,
    email: 'a@b.c',
    note: null,
    age: 30,
    active: true,
    payload: { a: 1 },
    tags: ['x'],
    created_at: '2026-08-21T00:00:00.000Z',
    slug: 'a-b-c',
  }

  it('is empty when the draft matches the row', () => {
    expect(rowChanges({ row, draft: { email: 'a@b.c', age: '30' }, columns, pkColumn: 'id' })).toEqual([])
  })

  it('reports only the fields that moved, with what they moved from', () => {
    expect(
      rowChanges({ row, draft: { email: 'z@b.c', age: '30', note: 'hi' }, columns, pkColumn: 'id' }),
    ).toEqual([
      { column: 'email', from: 'a@b.c', to: 'z@b.c' },
      { column: 'note', from: null, to: 'hi' },
    ])
  })

  it('keeps the column order of the table, not the order they were typed in', () => {
    const changes = rowChanges({
      row,
      draft: { age: '31', email: 'z@b.c' },
      columns,
      pkColumn: 'id',
    })
    expect(changes.map((c) => c.column)).toEqual(['email', 'age'])
  })

  it('counts clearing a field to NULL as a change', () => {
    expect(rowChanges({ row, draft: { email: null }, columns, pkColumn: 'id' })).toEqual([
      { column: 'email', from: 'a@b.c', to: null },
    ])
  })

  it('ignores a reformatted json field, and reports a real json edit', () => {
    expect(rowChanges({ row, draft: { payload: '{ "a": 1 }' }, columns, pkColumn: 'id' })).toEqual([])
    expect(rowChanges({ row, draft: { payload: '{"a":2}' }, columns, pkColumn: 'id' })).toEqual([
      { column: 'payload', from: '{\n  "a": 1\n}', to: '{"a":2}' },
    ])
  })

  it('never reports a blocked column, however the draft got a value for it', () => {
    expect(
      rowChanges({ row, draft: { id: '8', slug: 'zzz' }, columns, pkColumn: 'id' }),
    ).toEqual([])
  })
})

describe('buildRowEdit', () => {
  const row = { id: 7, email: 'a@b.c', note: null, age: 30, active: true, payload: null, tags: null, created_at: null, slug: 'a' }

  it('is null when nothing changed — there is no update to run', () => {
    expect(
      buildRowEdit({ schema: 'public', table: 'users', row, draft: {}, columns, tableKind: 'table', pkColumn: 'id' }),
    ).toBeNull()
  })

  it('carries the key, the table and the diff', () => {
    expect(
      buildRowEdit({
        schema: 'public',
        table: 'users',
        row,
        draft: { email: 'z@b.c' },
        columns,
        tableKind: 'table',
        pkColumn: 'id',
      }),
    ).toEqual({
      schema: 'public',
      table: 'users',
      pkColumn: 'id',
      pkValue: '7',
      changes: [{ column: 'email', from: 'a@b.c', to: 'z@b.c' }],
    })
  })

  it('is null when the row itself cannot be edited', () => {
    expect(
      buildRowEdit({
        schema: 'public',
        table: 'users_v',
        row,
        draft: { email: 'z@b.c' },
        columns,
        tableKind: 'view',
        pkColumn: 'id',
      }),
    ).toBeNull()
  })
})

describe('validateRowEdit — what the client can catch before the round trip', () => {
  const edit = (changes: Array<{ column: string; from: string | null; to: string | null }>) => ({
    schema: 'public',
    table: 'users',
    pkColumn: 'id',
    pkValue: '7',
    changes,
  })

  it('passes a sound edit', () => {
    expect(validateRowEdit(edit([{ column: 'age', from: '30', to: '31' }]), columns)).toEqual([])
  })

  it('names a NOT NULL column being cleared', () => {
    const errors = validateRowEdit(edit([{ column: 'email', from: 'a', to: null }]), columns)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('email')
    expect(errors[0]).toContain('NOT NULL')
  })

  it('names a number that is not one', () => {
    const errors = validateRowEdit(edit([{ column: 'age', from: '30', to: 'thirty' }]), columns)
    expect(errors[0]).toContain('age')
  })

  it('accepts the numbers Postgres accepts', () => {
    for (const value of ['-1', '1.5', '1e6', 'NaN', 'Infinity']) {
      expect(validateRowEdit(edit([{ column: 'age', from: '1', to: value }]), columns)).toEqual([])
    }
  })

  it('names json that will not parse', () => {
    const errors = validateRowEdit(edit([{ column: 'payload', from: null, to: '{oops' }]), columns)
    expect(errors[0]).toContain('payload')
  })

  it('names a boolean that is neither', () => {
    expect(validateRowEdit(edit([{ column: 'active', from: 'true', to: 'maybe' }]), columns)).toHaveLength(1)
    expect(validateRowEdit(edit([{ column: 'active', from: 'true', to: 'false' }]), columns)).toEqual([])
  })

  it('names a column the table does not have', () => {
    expect(validateRowEdit(edit([{ column: 'nope', from: null, to: 'x' }]), columns)).toHaveLength(1)
  })

  it('rejects an edit with nothing in it', () => {
    expect(validateRowEdit(edit([]), columns)).toHaveLength(1)
  })
})
