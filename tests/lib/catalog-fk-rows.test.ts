import { describe, it, expect } from 'vitest'
import { shapeCatalogForeignKeys } from '#/lib/catalog-fk-rows'
import type { CatalogFkRow } from '#/lib/catalog-fk-rows'

function row(overrides: Partial<CatalogFkRow>): CatalogFkRow {
  return {
    fktable: 'pg_extension',
    fkcols: ['extowner'],
    pktable: 'pg_authid',
    pkcols: ['oid'],
    isArray: false,
    isOpt: false,
    ...overrides,
  }
}

describe('shapeCatalogForeignKeys', () => {
  it('turns a single-column row into a catalog edge', () => {
    const { edges } = shapeCatalogForeignKeys([row({})], { canReadAuthid: true })

    expect(edges).toEqual([
      {
        fromTable: 'pg_extension',
        fromColumn: 'extowner',
        toTable: 'pg_authid',
        toColumn: 'oid',
        basis: 'catalog',
        optional: false,
      },
    ])
  })

  it('carries is_opt through, since an optional oid is 0 rather than null', () => {
    const { edges } = shapeCatalogForeignKeys(
      [row({ fktable: 'pg_class', fkcols: ['relam'], pktable: 'pg_am', isOpt: true })],
      { canReadAuthid: true },
    )

    expect(edges[0].optional).toBe(true)
  })

  it('drops array and composite rows, which a single-column link cannot express', () => {
    const { edges, skipped } = shapeCatalogForeignKeys(
      [
        row({}),
        row({ fkcols: ['extconfig'], pktable: 'pg_class', isArray: true }),
        row({
          fktable: 'pg_index',
          fkcols: ['indrelid', 'indkey'],
          pktable: 'pg_attribute',
          pkcols: ['attrelid', 'attnum'],
        }),
      ],
      { canReadAuthid: true },
    )

    expect(edges).toHaveLength(1)
    expect(skipped).toEqual({ arrays: 1, composite: 1 })
  })

  it('retargets pg_authid to pg_roles where the catalog itself is not readable', () => {
    const { edges } = shapeCatalogForeignKeys([row({})], { canReadAuthid: false })

    expect(edges[0].toTable).toBe('pg_roles')
    expect(edges[0].toColumn).toBe('oid')
  })

  it('leaves every other target alone when pg_authid is unreadable', () => {
    const { edges } = shapeCatalogForeignKeys(
      [row({ fkcols: ['extnamespace'], pktable: 'pg_namespace' })],
      { canReadAuthid: false },
    )

    expect(edges[0].toTable).toBe('pg_namespace')
  })
})
