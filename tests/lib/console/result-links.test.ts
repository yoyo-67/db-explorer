import { describe, expect, it } from 'vitest'
import { linkResultColumns } from '#/lib/console/result-links'
import type { ColumnInfo, ForeignKey, TableInfo } from '#/lib/types'

const fks: ForeignKey[] = [
  { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id' },
  {
    fromTable: 'orders',
    fromColumn: 'cart_id',
    toTable: 'carts',
    toColumn: 'id',
    basis: 'convention',
  },
]

const tables = [
  { name: 'orders', pkColumn: 'id' },
  { name: 'customers', pkColumn: 'id' },
] as TableInfo[]

function column(name: string, source?: ColumnInfo['source']): ColumnInfo {
  return { name, dataType: '', isNullable: true, ...(source ? { source } : {}) }
}

const from = (table: string, col: string) => ({ schema: 'public', table, column: col })

describe('linkResultColumns', () => {
  it('links a column that is a foreign key in the table it came from', () => {
    const [linked] = linkResultColumns(
      [column('customer_id', from('orders', 'customer_id'))],
      fks,
      tables,
    )
    expect(linked.references).toEqual({
      table: 'customers',
      column: 'id',
      basis: undefined,
    })
  })

  it('carries the basis through, so a hand-written edge stays marked as one', () => {
    const [linked] = linkResultColumns(
      [column('cart_id', from('orders', 'cart_id'))],
      fks,
      tables,
    )
    expect(linked.references?.basis).toBe('convention')
  })

  // An alias renames the output column, not the column it was read from — which
  // is the whole reason the source is asked of the database rather than guessed
  // from the name.
  it('links through an alias', () => {
    const [linked] = linkResultColumns(
      [column('who', from('orders', 'customer_id'))],
      fks,
      tables,
    )
    expect(linked.references?.table).toBe('customers')
  })

  it('links a primary key back to its own row', () => {
    const [linked] = linkResultColumns([column('id', from('customers', 'id'))], fks, tables)
    expect(linked.references).toEqual({ table: 'customers', column: 'id', basis: undefined })
  })

  it('leaves a computed column alone, having no source to trace', () => {
    const [linked] = linkResultColumns([column('count')], fks, tables)
    expect(linked.references).toBeUndefined()
  })

  it('leaves an ordinary column alone', () => {
    const [linked] = linkResultColumns(
      [column('total_cents', from('orders', 'total_cents'))],
      fks,
      tables,
    )
    expect(linked.references).toBeUndefined()
  })

  it('returns the same array contents when nothing can be linked', () => {
    const columns = [column('a'), column('b')]
    expect(linkResultColumns(columns, [], tables)).toEqual(columns)
  })
})
