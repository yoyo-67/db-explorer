import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()

vi.mock('#/server/db', () => ({
  createConnection: vi.fn(),
  disconnect: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
  queryWithTimeout: vi.fn(),
  StatementTimeoutError: class extends Error {},
  getConnection: () => ({}),
  getPresetName: () => null,
  setPresetName: vi.fn(),
}))

const { readCatalogEdges, resetCatalogEdgeCache } = await import('#/server/catalog-fks')

class PgError extends Error {
  constructor(readonly code: string) {
    super(`pg error ${code}`)
  }
}

function mockCatalogRows(rows: Record<string, unknown>[]) {
  mockQuery.mockResolvedValueOnce({ rows })
}

function mockAuthidReadable(readable: boolean) {
  mockQuery.mockResolvedValueOnce({ rows: [{ readable }] })
}

beforeEach(() => {
  mockQuery.mockReset()
  resetCatalogEdgeCache()
})

describe('readCatalogEdges', () => {
  it('reads the catalog map the server declares', async () => {
    mockAuthidReadable(true)
    mockCatalogRows([
      { fktable: 'pg_extension', fkcols: ['extowner'], pktable: 'pg_authid', pkcols: ['oid'], is_opt: false },
    ])

    const edges = await readCatalogEdges()

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

  it('asks the server for the map only once, since it cannot change under us', async () => {
    mockAuthidReadable(true)
    mockCatalogRows([
      { fktable: 'pg_class', fkcols: ['relowner'], pktable: 'pg_authid', pkcols: ['oid'], is_opt: false },
    ])

    await readCatalogEdges()
    await readCatalogEdges()

    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('falls back to the built-in list where the server has no such function', async () => {
    mockAuthidReadable(true)
    mockQuery.mockRejectedValueOnce(new PgError('42883'))

    const edges = await readCatalogEdges()

    expect(edges.length).toBeGreaterThan(0)
    expect(edges).toContainEqual({
      fromTable: 'pg_class',
      fromColumn: 'relnamespace',
      toTable: 'pg_namespace',
      toColumn: 'oid',
      basis: 'catalog',
      optional: true,
    })
  })

  it('retargets the role edges of the fallback list too when pg_authid is closed', async () => {
    mockAuthidReadable(false)
    mockQuery.mockRejectedValueOnce(new PgError('42883'))

    const edges = await readCatalogEdges()

    expect(edges.some((e) => e.toTable === 'pg_authid')).toBe(false)
    expect(edges.some((e) => e.toTable === 'pg_roles')).toBe(true)
  })

  it('gives up on any other failure rather than pretending the catalog is flat', async () => {
    mockAuthidReadable(true)
    mockQuery.mockRejectedValueOnce(new PgError('42501'))

    await expect(readCatalogEdges()).rejects.toThrow(/42501/)
  })
})
