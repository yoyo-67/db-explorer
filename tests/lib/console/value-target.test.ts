import { describe, expect, it } from 'vitest'
import { valueTargetAt, type ConsoleSchema } from '#/lib/console/completion'
import type { ColumnInfo, TableInfo } from '#/lib/types'

function col(name: string, dataType: string): ColumnInfo {
  return { name, dataType, isNullable: true }
}

function table(name: string, columns: ColumnInfo[]): TableInfo {
  return { name, schema: 'public', kind: 'table', rowCount: 0, lastModified: null, columns, pkColumn: 'id' }
}

const schema: ConsoleSchema = {
  schema: 'public',
  tables: [
    table('orders', [col('id', 'integer'), col('status', 'text'), col('total_cents', 'integer')]),
    table('customers', [col('id', 'integer'), col('email', 'text')]),
  ],
  fks: [],
  models: {},
}

/** Cursor written as `|`, the way the editor has it. */
function target(withCursor: string) {
  const cursor = withCursor.indexOf('|')
  return valueTargetAt(schema, withCursor.replace('|', ''), cursor)
}

describe('finding the column a value is being compared to', () => {
  it('reads the column on the left of an equals', () => {
    expect(target("SELECT * FROM orders WHERE status = |")).toMatchObject({
      table: 'orders',
      column: 'status',
      quoted: false,
    })
  })

  it('reads it through an alias', () => {
    expect(target('SELECT * FROM orders o WHERE o.status = |')).toMatchObject({
      table: 'orders',
      column: 'status',
    })
  })

  it('knows the cursor is already inside quotes', () => {
    const found = target("SELECT * FROM orders WHERE status = 'act|")
    expect(found).toMatchObject({ column: 'status', quoted: true })
    // The value replaces what is inside the quotes, not the quote itself.
    expect(found?.from).toBe("SELECT * FROM orders WHERE status = '".length)
  })

  it('replaces a partial bare word', () => {
    const found = target('SELECT * FROM orders WHERE status = act|')
    expect(found?.from).toBe('SELECT * FROM orders WHERE status = '.length)
  })

  it('takes every comparison operator, not just equals', () => {
    for (const op of ['=', '!=', '<>', '>', '<', '>=', '<=']) {
      expect(target(`SELECT * FROM orders WHERE status ${op} |`)?.column).toBe('status')
    }
    expect(target('SELECT * FROM orders WHERE status LIKE |')?.column).toBe('status')
    expect(target('SELECT * FROM orders WHERE status ILIKE |')?.column).toBe('status')
  })

  it('works inside an IN list, at the first value and at a later one', () => {
    expect(target('SELECT * FROM orders WHERE status IN (|')?.column).toBe('status')
    expect(target("SELECT * FROM orders WHERE status IN ('a', |")?.column).toBe('status')
    expect(target("SELECT * FROM orders WHERE status IN ('a', 'b|")).toMatchObject({
      column: 'status',
      quoted: true,
    })
  })

  it('says whether the column wants quoting, so a number is not offered as text', () => {
    expect(target('SELECT * FROM orders WHERE status = |')?.needsQuotes).toBe(true)
    expect(target('SELECT * FROM orders WHERE total_cents = |')?.needsQuotes).toBe(false)
  })

  it('resolves a bare column against the only table that has it', () => {
    expect(
      target('SELECT * FROM orders o JOIN customers c ON c.id = o.id WHERE email = |'),
    ).toMatchObject({ table: 'customers', column: 'email' })
  })

  it('has no target where there is no comparison', () => {
    expect(target('SELECT | FROM orders')).toBeNull()
    expect(target('SELECT * FROM orders WHERE |')).toBeNull()
    expect(target('SELECT * FROM orders WHERE status |')).toBeNull()
  })

  it('has no target for a column no table in the query has', () => {
    expect(target('SELECT * FROM orders WHERE nonsense = |')).toBeNull()
  })

  it('does not offer values on the right of a column-to-column comparison', () => {
    // `o.id = c.` is qualifying a second column, not typing a literal.
    expect(target('SELECT * FROM orders o JOIN customers c ON o.id = c.|')).toBeNull()
  })
})
