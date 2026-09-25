import { describe, expect, it } from 'vitest'
import { PROBE_COLUMN, buildNeighborhood, labelColumns } from '#/lib/row-neighborhood'
import type { FetchOutcome, FetchRows, FetchedRow, NeighborhoodSchema, NeighborNode, RowFetch } from '#/lib/row-neighborhood'
import type { SchemaGraphEdge } from '#/lib/types'

const edge = (
  fromTable: string,
  fromColumn: string,
  toTable: string,
  basis: SchemaGraphEdge['basis'] = 'declared',
  indexed = true,
): SchemaGraphEdge => ({ fromTable, fromColumn, toTable, toColumn: 'id', basis, nullable: true, indexed })

const table = (keyColumn: string | null = 'id', label: string | string[] | null = null, rowCount = 100, kind: 'table' | 'view' = 'table') => ({
  kind,
  rowCount,
  keyColumn,
  labelColumns: label === null ? [] : Array.isArray(label) ? label : [label],
})

const schema: NeighborhoodSchema = {
  edges: [
    edge('customers', 'account_id', 'accounts'),
    edge('orders', 'customer_id', 'customers'),
    edge('invoices', 'order_id', 'orders', 'model'),
    edge('invoices', 'refund_order_id', 'orders', 'model'),
    edge('invoices', 'currency_id', 'currencies'),
    edge('payments', 'invoice_id', 'invoices'),
    edge('audit', 'order_id', 'orders', 'convention', false),
    edge('big_log', 'order_id', 'orders', 'declared', true),
    edge('order_view', 'order_id', 'orders'),
    edge('notes', 'order_id', 'orders'),
    edge('categories', 'parent_id', 'categories'),
  ],
  tables: {
    accounts: table('id', 'name'),
    customers: table('id', 'name'),
    orders: table('id', 'status'),
    invoices: table('id'),
    currencies: table('id', 'code'),
    payments: table('id'),
    audit: table('id'),
    big_log: table('id', null, 5_000_000),
    order_view: table(null, null, 10, 'view'),
    notes: table(null, null),
    categories: table('id', 'name'),
  },
}

const db: Record<string, FetchedRow[]> = {
  accounts: [{ id: '7', name: 'Acme' }],
  customers: [{ id: '1', name: 'Ada', account_id: '7' }],
  orders: [
    { id: '10', status: 'paid', customer_id: '1' },
    { id: '11', status: 'open', customer_id: '99' },
  ],
  invoices: [
    { id: '100', order_id: '10', refund_order_id: '10', currency_id: '3' },
    { id: '101', order_id: '10', refund_order_id: null, currency_id: '3' },
  ],
  currencies: [{ id: '3', code: 'EUR' }],
  payments: [{ id: '500', invoice_id: '100' }],
  notes: [{ order_id: '10', body: 'x' }],
  categories: [
    { id: '1', name: 'root', parent_id: null },
    { id: '2', name: 'mid', parent_id: '1' },
    { id: '3', name: 'leaf', parent_id: '2' },
    { id: '5', name: 'self', parent_id: '5' },
  ],
}

function fakeFetch(
  data: Record<string, FetchedRow[]>,
  failing: Record<string, 'timeout' | 'mismatch' | 'failed'> = {},
  failWhen?: (request: RowFetch) => FetchOutcome | null,
) {
  const calls: RowFetch[] = []
  const fetchRows: FetchRows = async (request) => {
    calls.push(request)
    const failure = failing[request.table]
    if (failure) return { error: failure }
    const forced = failWhen?.(request)
    if (forced) return forced
    const rows: FetchedRow[] = []
    for (const value of request.values) {
      // Postgres compares typed: an uppercase uuid in a text column still
      // finds its lowercase row. Case-folding stands in for that here.
      const matches = (data[request.table] ?? []).filter((row) => row[request.column]?.toLowerCase() === value.toLowerCase())
      for (const row of matches.slice(0, request.limit)) {
        rows.push({ ...Object.fromEntries(request.select.map((c) => [c, row[c] ?? null])), [PROBE_COLUMN]: value })
      }
    }
    return { rows }
  }
  return { fetchRows, calls }
}

const find = (nodes: NeighborNode[], table: string, kind: NeighborNode['kind'] = 'row') =>
  nodes.filter((n) => n.table === table && n.kind === kind)

describe('buildNeighborhood', () => {
  it('returns null when the root row does not exist', async () => {
    const { fetchRows } = fakeFetch(db)
    expect(await buildNeighborhood({ table: 'orders', column: 'id', value: '404' }, schema, 1, fetchRows)).toBeNull()
  })

  it('puts parents at -1 and children at +1, with labels', async () => {
    const { fetchRows } = fakeFetch(db)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    const root = graph.nodes.find((n) => n.id === graph.root)!
    expect(root).toMatchObject({ kind: 'row', table: 'orders', depth: 0, key: '10', label: 'paid' })
    expect(find(graph.nodes, 'customers')).toEqual([expect.objectContaining({ depth: -1, key: '1', label: 'Ada' })])
    expect(find(graph.nodes, 'invoices').map((n) => n.depth)).toEqual([1, 1])
    // One hop only: the customer's account is two away.
    expect(find(graph.nodes, 'accounts')).toEqual([])
  })

  it('draws a row reached along two edges once, with both edges', async () => {
    const { fetchRows } = fakeFetch(db)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    const invoice = find(graph.nodes, 'invoices').find((n) => n.kind === 'row' && n.key === '100')!
    const into = graph.edges.filter((e) => e.from === invoice.id && e.to === graph.root)
    expect(into.map((e) => e.column).sort()).toEqual(['order_id', 'refund_order_id'])
  })

  it('never queries a gated child edge, and says why', async () => {
    const { fetchRows, calls } = fakeFetch(db)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    expect(find(graph.nodes, 'audit', 'skipped')).toEqual([expect.objectContaining({ reason: 'unindexed', column: 'order_id', value: '10' })])
    expect(calls.map((c) => c.table)).not.toContain('audit')
  })

  it('reads an indexed child edge however big the table — a limited index lookup costs the same on any size', async () => {
    const { fetchRows, calls } = fakeFetch(db)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    expect(calls.map((c) => c.table)).toContain('big_log')
    expect(find(graph.nodes, 'big_log', 'skipped')).toEqual([])
  })

  it('leaves views out — they reference nothing of their own', async () => {
    const { fetchRows, calls } = fakeFetch(db)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    expect(graph.nodes.filter((n) => n.table === 'order_view')).toEqual([])
    expect(calls.map((c) => c.table)).not.toContain('order_view')
  })

  it('shows a table with no key by the column it was reached through', async () => {
    const { fetchRows } = fakeFetch(db)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    expect(find(graph.nodes, 'notes')).toEqual([
      expect.objectContaining({ key: null, keyColumn: null, column: 'order_id', value: '10' }),
    ])
  })

  it('caps children per edge and adds a more node', async () => {
    const many = { ...db, invoices: Array.from({ length: 7 }, (_, i) => ({ id: String(200 + i), order_id: '10', refund_order_id: null, currency_id: null })) }
    const { fetchRows, calls } = fakeFetch(many)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    expect(find(graph.nodes, 'invoices')).toHaveLength(5)
    expect(find(graph.nodes, 'invoices', 'more')).toEqual([expect.objectContaining({ column: 'order_id', value: '10', depth: 1 })])
    expect(calls.find((c) => c.table === 'invoices' && c.column === 'order_id')?.limit).toBe(6)
  })

  it('marks a parent id that points at no row as missing', async () => {
    const { fetchRows } = fakeFetch(db)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '11' }, schema, 1, fetchRows))!
    expect(find(graph.nodes, 'customers', 'missing')).toEqual([expect.objectContaining({ column: 'id', value: '99', depth: -1 })])
  })

  it('goes two hops in the same direction only', async () => {
    const { fetchRows } = fakeFetch(db)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 2, fetchRows))!
    expect(find(graph.nodes, 'accounts')).toEqual([expect.objectContaining({ depth: -2, label: 'Acme' })])
    expect(find(graph.nodes, 'payments')).toEqual([expect.objectContaining({ depth: 2 })])
    // An invoice's own parents are siblings of the question, not part of it.
    expect(find(graph.nodes, 'currencies')).toEqual([])
  })

  it('follows a self-reference without looping', async () => {
    const { fetchRows } = fakeFetch(db)
    const chain = (await buildNeighborhood({ table: 'categories', column: 'id', value: '3' }, schema, 2, fetchRows))!
    expect(find(chain.nodes, 'categories').map((n) => [n.kind === 'row' && n.key, n.depth])).toEqual([
      ['3', 0],
      ['2', -1],
      ['1', -2],
    ])
    const self = (await buildNeighborhood({ table: 'categories', column: 'id', value: '5' }, schema, 2, fetchRows))!
    expect(self.nodes).toHaveLength(1)
    expect(self.edges).toEqual([{ from: self.root, to: self.root, column: 'parent_id', basis: 'declared' }])
  })

  it('turns a failed fetch into skipped nodes and keeps the rest', async () => {
    const { fetchRows } = fakeFetch(db, { invoices: 'timeout' })
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    expect(find(graph.nodes, 'invoices', 'skipped')).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'timeout', column: 'order_id' })]),
    )
    expect(find(graph.nodes, 'customers')).toHaveLength(1)
  })

  it('stops at the node budget and says so', async () => {
    const { fetchRows } = fakeFetch(db)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows, { nodeBudget: 2 }))!
    expect(graph.nodes).toHaveLength(2)
    expect(graph.truncated).toBe(true)
  })

  it('throws when the root itself cannot be read', async () => {
    const { fetchRows } = fakeFetch(db, { orders: 'failed' })
    await expect(buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows)).rejects.toThrow(/could not read/i)
  })
})

describe('buildNeighborhood, review fixes', () => {
  it('draws every keyless child as its own node', async () => {
    const two = { ...db, notes: [{ order_id: '10', body: 'a' }, { order_id: '10', body: 'b' }] }
    const { fetchRows } = fakeFetch(two)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    expect(find(graph.nodes, 'notes')).toHaveLength(2)
  })

  it('reads each reference on its own, so one bad value cannot hide another edge', async () => {
    const withLegacy: NeighborhoodSchema = {
      ...schema,
      edges: [...schema.edges, edge('orders', 'legacy_customer', 'customers', 'convention')],
    }
    const data = { ...db, orders: [{ id: '10', status: 'paid', customer_id: '1', legacy_customer: 'N/A' }] }
    const { fetchRows } = fakeFetch(data, {}, (request) =>
      request.values.includes('N/A') ? { error: 'mismatch' } : null,
    )
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, withLegacy, 1, fetchRows))!
    expect(find(graph.nodes, 'customers')).toEqual([expect.objectContaining({ key: '1' })])
    expect(find(graph.nodes, 'customers', 'skipped')).toEqual([expect.objectContaining({ reason: 'mismatch', value: 'N/A' })])
  })

  it('matches a fetched row by the value asked for, not by re-comparing text', async () => {
    const data = { ...db, orders: [{ id: '10', status: 'paid', customer_id: 'AB' }], customers: [{ id: 'ab', name: 'Ada' }] }
    const { fetchRows } = fakeFetch(data)
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    expect(find(graph.nodes, 'customers', 'missing')).toEqual([])
    expect(find(graph.nodes, 'customers')).toEqual([expect.objectContaining({ key: 'ab' })])
  })

  it('carries why a read failed into the node', async () => {
    const { fetchRows } = fakeFetch(db, {}, (request) =>
      request.table === 'invoices' ? { error: 'failed', detail: 'permission denied for table invoices' } : null,
    )
    const graph = (await buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows))!
    expect(find(graph.nodes, 'invoices', 'skipped')).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'failed', detail: 'permission denied for table invoices' })]),
    )
  })

  it('says why the root could not be read', async () => {
    const { fetchRows } = fakeFetch(db, {}, (request) =>
      request.table === 'orders' ? { error: 'failed', detail: 'permission denied for table orders' } : null,
    )
    await expect(buildNeighborhood({ table: 'orders', column: 'id', value: '10' }, schema, 1, fetchRows)).rejects.toThrow(
      /permission denied for table orders/,
    )
  })
})

describe('labelColumns', () => {
  const col = (name: string, dataType = 'text') => ({ name, dataType })

  it('tries the fields the row page names a row by, in its order', () => {
    expect(labelColumns([col('email'), col('title'), col('name')], new Set())).toEqual(['name', 'title', 'email'])
  })

  it('falls back to the other text columns, in table order, as the row page does', () => {
    const columns = [col('id', 'uuid'), col('user_id', 'uuid'), col('role', 'USER-DEFINED'), col('note', 'character varying'), col('created_at', 'timestamp with time zone')]
    expect(labelColumns(columns, new Set(['id', 'user_id']))).toEqual(['role', 'note'])
  })

  it('leaves out the key and the reference columns, even when they are text', () => {
    expect(labelColumns([col('code'), col('parent_code'), col('kind')], new Set(['code', 'parent_code']))).toEqual(['kind'])
  })

  it('is empty when nothing could name a row', () => {
    expect(labelColumns([col('id', 'integer'), col('created_at', 'date')], new Set(['id']))).toEqual([])
  })
})

describe('node labels', () => {
  it('uses the first label column the row has a value in', async () => {
    const small: NeighborhoodSchema = {
      edges: [],
      tables: { assignments: table('id', ['name', 'role']) },
    }
    const fetch: FetchRows = async () => ({ rows: [{ id: 'a1', name: null as unknown as string, role: 'Project manager' }] })
    const graph = await buildNeighborhood({ table: 'assignments', column: 'id', value: 'a1' }, small, 1, fetch)
    expect(graph?.nodes[0]).toMatchObject({ kind: 'row', label: 'Project manager' })
  })

  it('reads every label column', async () => {
    const small: NeighborhoodSchema = { edges: [], tables: { assignments: table('id', ['name', 'role']) } }
    const seen: RowFetch[] = []
    const fetch: FetchRows = async (request) => {
      seen.push(request)
      return { rows: [{ id: 'a1' }] }
    }
    await buildNeighborhood({ table: 'assignments', column: 'id', value: 'a1' }, small, 1, fetch)
    expect(seen[0].select).toEqual(expect.arrayContaining(['name', 'role']))
  })
})
