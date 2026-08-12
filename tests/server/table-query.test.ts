import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
const mockQueryWithTimeout = vi.fn()

class StatementTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Query exceeded statement_timeout of ${timeoutMs}ms`)
    this.name = 'StatementTimeoutError'
  }
}

vi.mock('#/server/db', () => ({
  createConnection: vi.fn(),
  disconnect: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
  queryWithTimeout: (...args: unknown[]) => mockQueryWithTimeout(...args),
  StatementTimeoutError,
  getConnection: () => ({}),
  getPresetName: () => null,
  setPresetName: vi.fn(),
}))

vi.mock('#/server/perf-log', () => ({
  appendPerfEntry: vi.fn(),
  readPerfLog: vi.fn(async () => []),
}))

// The real reader would load the committed 343-table map from local/, making
// these unit tests depend on internal schema metadata. The trace merge itself is
// covered by tests/lib/row-trace.test.ts.
vi.mock('#/server/local-metadata', () => ({
  readSchemaMap: vi.fn(async () => null),
  readTableCatalog: vi.fn(async () => null),
}))

const {
  getTablePage,
  getRowChildren,
  getRowDetail,
  EXACT_COUNT_THRESHOLD,
  COUNT_TIMEOUT_MS,
} = await import('#/server/functions')

beforeEach(() => {
  mockQuery.mockReset()
  mockQueryWithTimeout.mockReset()
})

function mockColumns(names: string[]) {
  mockQuery.mockResolvedValueOnce({
    rows: names.map((name) => ({
      column_name: name,
      data_type: 'text',
      is_nullable: 'YES',
    })),
  })
}

function mockApprox(rowCount: number) {
  mockQuery.mockResolvedValueOnce({ rows: [{ row_count: String(rowCount) }] })
}

describe('getTablePage SQL builder', () => {
  it('emits a paginated SELECT with schema-qualified identifiers and offset', async () => {
    mockColumns(['id', 'name'])
    mockQuery.mockResolvedValueOnce({ rows: [] }) // data
    mockApprox(50)
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '50' }] }) // exact count

    await getTablePage({ schema: 'public', table: 'users', page: 3, pageSize: 25 })

    const dataSql = mockQuery.mock.calls[1][0] as string
    expect(dataSql).toBe('SELECT * FROM public.users   LIMIT 25 OFFSET 50')
  })

  it('returns approximate count when n_live_tup is at/above the threshold and no filter', async () => {
    mockColumns(['id'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(EXACT_COUNT_THRESHOLD)

    const page = await getTablePage({ schema: 'public', table: 'big' })

    expect(page.isCountApproximate).toBe(true)
    expect(page.count).toBe(EXACT_COUNT_THRESHOLD)
    // No exact count query was issued
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })

  it('forces an exact count when exactCount=true is passed even on a big table', async () => {
    mockColumns(['id'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(EXACT_COUNT_THRESHOLD * 5)
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '999' }] })

    const page = await getTablePage({
      schema: 'public',
      table: 'big',
      exactCount: true,
    })

    expect(page.isCountApproximate).toBe(false)
    expect(page.count).toBe(999)
    const countSql = mockQuery.mock.calls[3][0] as string
    expect(countSql).toMatch(/SELECT COUNT\(\*\)/)
  })

  it('compiles the filter into a WHERE clause and forces exact count', async () => {
    mockColumns(['id', 'email'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(EXACT_COUNT_THRESHOLD * 10) // big — would be approx without filter
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '7' }] })

    const page = await getTablePage({
      schema: 'public',
      table: 'users',
      filter: { email: 'alice' },
    })

    const dataSql = mockQuery.mock.calls[1][0] as string
    expect(dataSql).toContain(`WHERE email::text ILIKE '%alice%'`)
    expect(page.isCountApproximate).toBe(false)
    expect(page.count).toBe(7)
  })

  it('drops filters whose column is not in the table', async () => {
    mockColumns(['id'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(10)
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '0' }] })

    await getTablePage({
      schema: 'public',
      table: 'users',
      filter: { evil: 'x' },
    })

    const dataSql = mockQuery.mock.calls[1][0] as string
    expect(dataSql).not.toContain('WHERE')
  })

  it('emits ORDER BY with a quoted identifier and validated direction', async () => {
    mockColumns(['id', 'created_at'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(10)
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '0' }] })

    await getTablePage({
      schema: 'public',
      table: 'users',
      sort: { column: 'created_at', direction: 'desc' },
    })

    const dataSql = mockQuery.mock.calls[1][0] as string
    expect(dataSql).toContain('ORDER BY created_at DESC')
  })

  it('ignores sort when the column is not in the table', async () => {
    mockColumns(['id'])
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockApprox(10)
    mockQuery.mockResolvedValueOnce({ rows: [{ c: '0' }] })

    await getTablePage({
      schema: 'public',
      table: 'users',
      sort: { column: 'not_a_column', direction: 'asc' },
    })

    const dataSql = mockQuery.mock.calls[1][0] as string
    expect(dataSql).not.toContain('ORDER BY')
  })

  // Bug 1: tables never analyzed report n_live_tup=0, which falsely tripped an
  // exact COUNT(*) seqscan on multi-million-row tables. The approx query must
  // fall back to pg_class.reltuples so unanalyzed-but-huge tables stay approximate.
  it('approx row count falls back to reltuples so zero n_live_tup never triggers an exact count', async () => {
    mockColumns(['id'])
    mockQuery.mockResolvedValueOnce({ rows: [] }) // data
    mockApprox(EXACT_COUNT_THRESHOLD) // approx (>= threshold => no exact count)

    await getTablePage({ schema: 'public', table: 'big' })

    const approxSql = mockQuery.mock.calls[2][0] as string
    expect(approxSql).toMatch(/reltuples/)
    expect(approxSql).toMatch(/GREATEST/)
  })
})

describe('foreign-key lookups use native typed comparison (index-friendly)', () => {
  // Bug 2: WHERE col::text = '...' casts the indexed PK/FK column to text,
  // forcing a seqscan. Compare natively so the index is used.
  it('getRowChildren matches the FK column without a ::text cast', async () => {
    mockColumns(['id', 'parent_id']) // fetchColumns for the child table
    mockQuery.mockResolvedValueOnce({ rows: [] }) // data

    await getRowChildren({
      schema: 'public',
      childTable: 'child',
      fkColumn: 'parent_id',
      parentValue: 'abc',
    })

    const sql = mockQuery.mock.calls[1][0] as string
    expect(sql).not.toContain('::text')
    expect(sql).toContain("WHERE parent_id = 'abc'")
  })

  it('getRowDetail looks up the root row without a ::text cast', async () => {
    mockRowDetailMetadata({ columns: ['id'], root: { id: 'abc' } })

    await getRowDetail('public', 'parent', 'abc')

    const rootSql = mockQuery.mock.calls[2][0] as string
    expect(rootSql).not.toContain('::text')
    expect(rootSql).toContain("WHERE id = 'abc'")
  })
})

/**
 * BUILD-SPEC §5.2. The point of the split is that "not counted" is the common
 * case, not an error: 45% of inferred columns are unindexed, so counting every
 * neighbour eagerly would seq-scan once per related table.
 */
describe('getRowDetail split count batch', () => {
  it('counts indexed references on small tables eagerly and leaves the rest uncounted', async () => {
    mockRowDetailMetadata({
      columns: ['id'],
      root: { id: 'abc' },
      fks: [
        fkRow('small_indexed', 'parent_id', 'parent', 'id'),
        fkRow('small_unindexed', 'parent_id', 'parent', 'id'),
        fkRow('huge_indexed', 'parent_id', 'parent', 'id'),
      ],
      stats: {
        parent: 10,
        small_indexed: 50,
        small_unindexed: 50,
        huge_indexed: EXACT_COUNT_THRESHOLD,
      },
      indexed: ['small_indexed.parent_id', 'huge_indexed.parent_id'],
    })
    mockTimeoutQuery({ rows: [{ k: 'small_indexed.parent_id', c: '7' }] })

    const detail = await getRowDetail('public', 'parent', 'abc')
    const byTable = Object.fromEntries(detail.children.map((c) => [c.table, c]))

    expect(byTable.small_indexed).toMatchObject({ total: 7, indexed: true })
    expect(byTable.small_unindexed).toMatchObject({
      total: null,
      countSkipped: 'unindexed',
    })
    expect(byTable.huge_indexed).toMatchObject({ total: null, countSkipped: 'large' })

    // Only the safe reference is in the batch — that is the whole budget.
    const batch = mockQueryWithTimeout.mock.calls[0][0] as string
    expect(batch).toContain('small_indexed')
    expect(batch).not.toContain('small_unindexed')
    expect(batch).not.toContain('huge_indexed')
  })

  it('bounds the eager batch with a statement timeout', async () => {
    mockRowDetailMetadata({
      columns: ['id'],
      root: { id: 'abc' },
      fks: [fkRow('child', 'parent_id', 'parent', 'id')],
      stats: { parent: 1, child: 10 },
      indexed: ['child.parent_id'],
    })
    mockTimeoutQuery({ rows: [{ k: 'child.parent_id', c: '2' }] })

    await getRowDetail('public', 'parent', 'abc')

    expect(mockQueryWithTimeout.mock.calls[0][1]).toBe(COUNT_TIMEOUT_MS)
  })

  it('degrades to uncounted neighbours on timeout rather than failing the row', async () => {
    mockRowDetailMetadata({
      columns: ['id'],
      root: { id: 'abc' },
      fks: [fkRow('child', 'parent_id', 'parent', 'id')],
      stats: { parent: 1, child: 10 },
      indexed: ['child.parent_id'],
    })
    mockQueryWithTimeout.mockRejectedValueOnce(new StatementTimeoutError(3000))

    const detail = await getRowDetail('public', 'parent', 'abc')

    expect(detail.children[0]).toMatchObject({ total: null, countSkipped: 'timeout' })
  })

  it('never counts a reference whose parent value is null', async () => {
    mockRowDetailMetadata({
      columns: ['id', 'other_id'],
      root: { id: 'abc', other_id: null },
      fks: [fkRow('child', 'other_ref_id', 'parent', 'other_id')],
      stats: { parent: 1, child: 10 },
      indexed: ['child.other_ref_id'],
    })

    const detail = await getRowDetail('public', 'parent', 'abc')

    expect(detail.children[0].total).toBeNull()
    expect(mockQueryWithTimeout).not.toHaveBeenCalled()
  })
})

describe('getRowDetail outgoing hops', () => {
  it('checks each set reference exactly and marks a missing target dangling', async () => {
    mockRowDetailMetadata({
      columns: ['id', 'project_id', 'batch_id'],
      root: { id: 'abc', project_id: 'p1', batch_id: null },
      fks: [
        fkRow('video', 'project_id', 'project', 'id'),
        fkRow('video', 'batch_id', 'batch', 'id'),
      ],
      stats: { video: 1, project: 1, batch: 1 },
      indexed: [],
      table: 'video',
    })
    mockTimeoutQuery({ rows: [{ k: 'project_id', e: false }] })

    const detail = await getRowDetail('public', 'video', 'abc')
    const byColumn = Object.fromEntries(detail.outgoing.map((o) => [o.column, o]))

    expect(byColumn.project_id).toMatchObject({
      targetTable: 'project',
      value: 'p1',
      resolves: false,
    })
    // A null value is nothing to resolve, so it is unchecked rather than dangling.
    expect(byColumn.batch_id).toMatchObject({ value: null, resolves: null })
    const batch = mockQueryWithTimeout.mock.calls[0][0] as string
    expect(batch).toContain('EXISTS')
    expect(batch).not.toContain('batch_id')
  })
})

function fkRow(fromTable: string, fromColumn: string, toTable: string, toColumn: string) {
  return {
    from_table: fromTable,
    from_column: fromColumn,
    to_table: toTable,
    to_column: toColumn,
  }
}

/**
 * Queue the metadata queries `getRowDetail` makes, in order: the table's columns,
 * its primary key, the root row, every declared FK, then the filtered table-stats
 * and leading-index lookups the count budget needs.
 */
function mockRowDetailMetadata(opts: {
  columns: string[]
  root: Record<string, unknown> | null
  fks?: Array<ReturnType<typeof fkRow>>
  stats?: Record<string, number>
  indexed?: string[]
  table?: string
}) {
  mockColumns(opts.columns)
  mockQuery.mockResolvedValueOnce({ rows: [{ column_name: 'id' }] }) // resolvePrimaryKey
  mockQuery.mockResolvedValueOnce({ rows: opts.root ? [opts.root] : [] }) // root row
  mockQuery.mockResolvedValueOnce({ rows: opts.fks ?? [] }) // getForeignKeys
  mockQuery.mockResolvedValueOnce({
    rows: Object.entries(opts.stats ?? { [opts.table ?? 'parent']: 0 }).map(
      ([table_name, row_count]) => ({ table_name, row_count: String(row_count) }),
    ),
  }) // fetchTableStats
  mockQuery.mockResolvedValueOnce({
    rows: (opts.indexed ?? []).map((key) => {
      const dot = key.lastIndexOf('.')
      return { table_name: key.slice(0, dot), column_name: key.slice(dot + 1) }
    }),
  }) // fetchIndexedColumnsFor
}

function mockTimeoutQuery(result: { rows: Array<Record<string, unknown>> }) {
  mockQueryWithTimeout.mockResolvedValueOnce(result)
}
