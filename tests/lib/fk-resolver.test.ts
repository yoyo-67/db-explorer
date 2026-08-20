import { describe, it, expect } from 'vitest'
import {
  buildFkIndex,
  enrichColumnsWithFks,
  isLinkableFkValue,
  resolveFk,
} from '#/lib/fk-resolver'
import type { ColumnInfo, ForeignKey } from '#/lib/types'

const fks: ForeignKey[] = [
  { fromTable: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id' },
  { fromTable: 'orders', fromColumn: 'product_id', toTable: 'products', toColumn: 'id' },
  { fromTable: 'comments', fromColumn: 'post_id', toTable: 'posts', toColumn: 'id' },
]

describe('resolveFk', () => {
  it('returns the target for a matching (table, column) pair', () => {
    expect(resolveFk(fks, 'orders', 'user_id')).toEqual({ table: 'users', column: 'id' })
  })

  it('returns undefined when the table does not match', () => {
    expect(resolveFk(fks, 'users', 'user_id')).toBeUndefined()
  })

  it('returns undefined when the column does not match', () => {
    expect(resolveFk(fks, 'orders', 'foo')).toBeUndefined()
  })
})

describe('buildFkIndex', () => {
  it('keys by `${fromTable}.${fromColumn}`', () => {
    const idx = buildFkIndex(fks)
    expect(idx.get('orders.user_id')).toEqual({ table: 'users', column: 'id' })
    expect(idx.get('comments.post_id')).toEqual({ table: 'posts', column: 'id' })
  })

  it('returns an empty map for an empty FK list', () => {
    expect(buildFkIndex([]).size).toBe(0)
  })
})

describe('enrichColumnsWithFks', () => {
  const cols: ColumnInfo[] = [
    { name: 'id', dataType: 'integer', isNullable: false },
    { name: 'user_id', dataType: 'integer', isNullable: true },
    { name: 'note', dataType: 'text', isNullable: true },
  ]

  it('adds references to FK columns only', () => {
    const enriched = enrichColumnsWithFks(cols, fks, 'orders')
    expect(enriched.find((c) => c.name === 'user_id')?.references).toEqual({
      table: 'users',
      column: 'id',
    })
    expect(enriched.find((c) => c.name === 'id')?.references).toBeUndefined()
    expect(enriched.find((c) => c.name === 'note')?.references).toBeUndefined()
  })

  it('does not mutate the input columns', () => {
    enrichColumnsWithFks(cols, fks, 'orders')
    expect(cols.find((c) => c.name === 'user_id')?.references).toBeUndefined()
  })

  it('returns the columns unchanged when FK list is empty', () => {
    const enriched = enrichColumnsWithFks(cols, [], 'orders')
    expect(enriched).toEqual(cols)
  })
})

describe('isLinkableFkValue', () => {
  const catalogTarget = { table: 'pg_authid', column: 'oid', basis: 'catalog' as const }
  const declaredTarget = { table: 'data_project', column: 'id', basis: 'declared' as const }

  it('refuses 0 on a catalog oid, which is InvalidOid rather than a row', () => {
    expect(isLinkableFkValue(0, catalogTarget)).toBe(false)
    expect(isLinkableFkValue('0', catalogTarget)).toBe(false)
  })

  it('accepts any other oid', () => {
    expect(isLinkableFkValue(10, catalogTarget)).toBe(true)
  })

  it('leaves 0 alone on a declared key, where it is an ordinary id', () => {
    expect(isLinkableFkValue(0, declaredTarget)).toBe(true)
  })

  it('refuses null and undefined, which point nowhere in any schema', () => {
    expect(isLinkableFkValue(null, declaredTarget)).toBe(false)
    expect(isLinkableFkValue(undefined, declaredTarget)).toBe(false)
  })
})
