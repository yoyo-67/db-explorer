import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('#/server/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

const { getColumnFacets } = await import('#/server/column-facets')

/** Answer each catalog read by a fragment of its SQL, whatever order they run in. */
function answer(routes: Array<[string, unknown[]]>) {
  mockQuery.mockImplementation(async (sql: string) => {
    for (const [fragment, rows] of routes) if (sql.includes(fragment)) return { rows }
    return { rows: [] }
  })
}

// A block body: `mockReset()` returns the mock, and a function returned from a
// hook is run as its teardown — with no SQL.
beforeEach(() => {
  mockQuery.mockReset()
})

describe('getColumnFacets', () => {
  it('reads index position, stats and comments per column', async () => {
    answer([
      [
        'FROM pg_attribute',
        [
          { table: 'orders', column: 'customer_id', leads_index: true, in_index: true, null_frac: 0, n_distinct: 40, comment: null },
          { table: 'orders', column: 'status', leads_index: false, in_index: true, null_frac: 0.25, n_distinct: 3, comment: 'lifecycle' },
          { table: 'orders', column: 'notes', leads_index: false, in_index: false, null_frac: null, n_distinct: null, comment: null },
        ],
      ],
      ['FROM pg_stat_user_tables', [{ table: 'orders', last_analyze: new Date('2026-09-01T10:00:00Z') }]],
    ])

    const facets = await getColumnFacets('public')

    expect(facets.columns['orders.customer_id']).toEqual({ index: 'lead', nullFrac: 0, nDistinctRaw: 40, comment: null, rowEstimate: null })
    expect(facets.columns['orders.status']).toEqual({ index: 'member', nullFrac: 0.25, nDistinctRaw: 3, comment: 'lifecycle', rowEstimate: null })
    // Never analyzed: unknown, not zero.
    expect(facets.columns['orders.notes']).toEqual({ index: null, nullFrac: null, nDistinctRaw: null, comment: null, rowEstimate: null })
    expect(facets.analyzedAt).toEqual({ orders: '2026-09-01T10:00:00.000Z' })
  })

  it('sizes each column from reltuples, which persists — not the live counters, which reset', async () => {
    answer([
      [
        'FROM pg_attribute',
        [
          { table: 'orders', column: 'id', leads_index: true, in_index: true, null_frac: 0, n_distinct: -1, comment: null, reltuples: 1200 },
          { table: 'fresh', column: 'id', leads_index: true, in_index: true, null_frac: null, n_distinct: null, comment: null, reltuples: -1 },
        ],
      ],
    ])
    const facets = await getColumnFacets('public')
    expect(facets.columns['orders.id'].rowEstimate).toBe(1200)
    // -1 is Postgres for "never vacuumed or analyzed": unknown, not zero.
    expect(facets.columns['fresh.id'].rowEstimate).toBeNull()
  })

  it('passes the schema as a parameter, never in the SQL text', async () => {
    answer([])
    await getColumnFacets('weird"schema')
    expect(mockQuery).toHaveBeenCalledTimes(2)
    for (const [sql, params] of mockQuery.mock.calls) {
      expect(sql).not.toContain('weird')
      expect(params).toEqual(['weird"schema'])
    }
  })

  it('reports a table that was never analyzed as null', async () => {
    answer([['FROM pg_stat_user_tables', [{ table: 'fresh', last_analyze: null }]]])
    expect((await getColumnFacets('public')).analyzedAt).toEqual({ fresh: null })
  })
})
