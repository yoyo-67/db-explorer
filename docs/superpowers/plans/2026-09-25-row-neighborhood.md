# Row Neighborhood Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From any row, a page drawing the rows it references (left) and the rows referencing it (right), one or two hops out.

**Architecture:** A pure builder (`src/lib/row-neighborhood.ts`) walks the merged schema graph hop by hop and asks an injected `fetchRows` for rows, so every rule — gate, cap, dedup, budget, missing parents — is tested without a database. The server (`src/server/row-neighborhood.ts`) supplies the schema graph and a `fetchRows` that runs one `UNION ALL` statement per (table, column) under `queryWithTimeout`. A pure layered layout feeds a DOM-nodes-over-SVG-edges component on a new route.

**Tech Stack:** TanStack Start (file routes, `createServerFn`), React Query, Vitest (jsdom for components), pg + pg-format.

**Spec:** `docs/superpowers/specs/2026-09-25-row-neighborhood-design.md`

## Global Constraints

- Read-only: every row statement goes through `queryWithTimeout` (`BEGIN READ ONLY` + `SET LOCAL statement_timeout`).
- Identifiers via pg-format `%I`, values via `%L`. Never string-concatenated.
- Unknown is never zero: an unread count is a `more` node with no number; a skipped edge is a node with its reason.
- Child gate is the app's one rule: `countSkipReason(edge.indexed, rowCount, 100_000)` from `#/lib/row-trace`.
- `CHILDREN_PER_EDGE = 5`, `NODE_BUDGET = 80`, per-statement timeout `8000` ms.
- Table names always through `TableName` (`#/components/TableName`) — follows the *Table names* setting.
- Public repo: fixtures use generic names (`orders`, `customers`, `invoices`, `shop_db`).
- Pages use `island-shell rounded-xl` panels and the red error box used elsewhere.

## Review Focus

1. **A row reachable along two edges** (an invoice whose `order_id` and `refund_order_id` both point at the root) — one node, two edges. *Test in Task 1.*
2. **A self-referencing table** (`categories.parent_id → categories.id`, including a row that is its own parent) — no loop, one node. *Test in Task 1.*
3. **A child edge on an unindexed or huge table** — never queried, one `skipped` node with the reason. *Test in Task 1 (builder) and Task 3 (no SQL issued).*
4. **A neighbor table with no primary key** — its rows still appear, identified by the column they were reached by. *Test in Task 1.*
5. **`hops=banana` / `hops=3` in the URL** → 1. *Test in Task 5.*

## Rulings folded in from the spec

- The spec's architecture box named `fetchTraceEdges`; those edges carry no `indexed` or row count, which the gate needs. The server loads the merged `getSchemaGraph` like Find does. Same edges, same precedence.
- The spec allowed a hidden-child count "from the gated COUNT". This plan ships `more` nodes without a number (`hidden` dropped): one fewer query per edge, and the node links to the filtered table where the count is one click away.
- Nodes are DOM boxes over an SVG edge layer, not SVG text: `TableName` and `Link` render as they do everywhere else.

---

## File Structure

- Create `src/lib/row-neighborhood.ts` — types, `labelColumn`, `selectColumns`, `buildNeighborhood`.
- Create `src/lib/neighborhood-layout.ts` — `layoutNeighborhood`, `edgePath`, size constants.
- Create `src/lib/neighborhood-search.ts` — `validateNeighborhoodSearch`.
- Create `src/server/row-neighborhood.ts` — `rowFetchSql`, `getRowNeighborhood`.
- Modify `src/server/functions.ts` — export `fetchSchemaColumns`, `fetchSchemaPrimaryKeys`.
- Modify `src/server/api.ts` — `$getRowNeighborhood`.
- Create `src/components/neighborhood/NeighborhoodGraph.tsx`.
- Create `src/routes/d/$database/t/$schema/$table/neighborhood/$id.tsx`.
- Modify `src/routes/d/$database/t/$schema/$table/row/$id.tsx` — "Neighborhood" link.
- Create `src/lib/help/topics/row-neighborhood.ts`, `src/components/help/previews/RowNeighborhoodPreview.tsx`; register both.
- Modify `README.md`.
- Tests: `tests/lib/row-neighborhood.test.ts`, `tests/lib/neighborhood-layout.test.ts`, `tests/lib/neighborhood-search.test.ts`, `tests/server/row-neighborhood.test.ts`, `tests/components/neighborhood/NeighborhoodGraph.test.tsx`.

---

### Task 1: The builder

**Files:**
- Create: `src/lib/row-neighborhood.ts`
- Test: `tests/lib/row-neighborhood.test.ts`

**Interfaces:**
- Consumes: `countSkipReason` from `#/lib/row-trace`; `EdgeBasis`, `NodeKind`, `SchemaGraphEdge` from `#/lib/types`.
- Produces:
  - `type Depth = -2 | -1 | 0 | 1 | 2`, `type Hops = 1 | 2`, `type SkipReason = 'unindexed' | 'large' | 'timeout' | 'failed'`
  - `interface NeighborTable { kind: NodeKind; rowCount: number; keyColumn: string | null; labelColumn: string | null }`
  - `interface NeighborhoodSchema { edges: readonly SchemaGraphEdge[]; tables: Readonly<Record<string, NeighborTable>> }`
  - `type NeighborNode` (kinds `row` | `more` | `missing` | `skipped`; every node has `id, table, depth, column, value`; `row` adds `keyColumn, key, label`; `skipped` adds `reason`)
  - `interface NeighborEdge { from: string; to: string; column: string; basis: EdgeBasis }` — `from` is always the child
  - `interface RowNeighborhood { root: string; nodes: NeighborNode[]; edges: NeighborEdge[]; truncated: boolean }`
  - `interface RowFetch { table: string; column: string; values: string[]; limit: number; select: string[] }`
  - `type FetchedRow = Record<string, string | null>`, `type FetchOutcome = { rows: FetchedRow[] } | { error: 'timeout' | 'failed' }`, `type FetchRows = (request: RowFetch) => Promise<FetchOutcome>`
  - `labelColumn(columns: readonly string[]): string | null`
  - `buildNeighborhood(root: { table: string; column: string; value: string }, schema: NeighborhoodSchema, hops: Hops, fetchRows: FetchRows, options?: { nodeBudget?: number }): Promise<RowNeighborhood | null>`
  - constants `CHILDREN_PER_EDGE`, `NODE_BUDGET`, `CHILD_ROW_BUDGET`, `LABEL_COLUMNS`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/row-neighborhood.test.ts
import { describe, expect, it } from 'vitest'
import { buildNeighborhood, labelColumn } from '#/lib/row-neighborhood'
import type { FetchRows, FetchedRow, NeighborhoodSchema, NeighborNode, RowFetch } from '#/lib/row-neighborhood'
import type { SchemaGraphEdge } from '#/lib/types'

const edge = (
  fromTable: string,
  fromColumn: string,
  toTable: string,
  basis: SchemaGraphEdge['basis'] = 'declared',
  indexed = true,
): SchemaGraphEdge => ({ fromTable, fromColumn, toTable, toColumn: 'id', basis, nullable: true, indexed })

const table = (keyColumn: string | null = 'id', labelColumn: string | null = null, rowCount = 100, kind: 'table' | 'view' = 'table') => ({
  kind,
  rowCount,
  keyColumn,
  labelColumn,
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

function fakeFetch(data: Record<string, FetchedRow[]>, failing: Record<string, 'timeout' | 'failed'> = {}) {
  const calls: RowFetch[] = []
  const fetchRows: FetchRows = async (request) => {
    calls.push(request)
    const failure = failing[request.table]
    if (failure) return { error: failure }
    const rows: FetchedRow[] = []
    for (const value of request.values) {
      const matches = (data[request.table] ?? []).filter((row) => row[request.column] === value)
      for (const row of matches.slice(0, request.limit)) {
        rows.push(Object.fromEntries(request.select.map((c) => [c, row[c] ?? null])))
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
    expect(find(graph.nodes, 'big_log', 'skipped')).toEqual([expect.objectContaining({ reason: 'large' })])
    expect(calls.map((c) => c.table)).not.toContain('audit')
    expect(calls.map((c) => c.table)).not.toContain('big_log')
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

describe('labelColumn', () => {
  it('prefers name, then title, label, email, code, slug, status', () => {
    expect(labelColumn(['id', 'status', 'email'])).toBe('email')
    expect(labelColumn(['title', 'name'])).toBe('name')
    expect(labelColumn(['id', 'created_at'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/row-neighborhood.test.ts`
Expected: FAIL — cannot resolve `#/lib/row-neighborhood`.

- [ ] **Step 3: Implement**

```ts
// src/lib/row-neighborhood.ts
import { countSkipReason } from '#/lib/row-trace'
import type { EdgeBasis, NodeKind, SchemaGraphEdge } from '#/lib/types'

/**
 * One row's neighborhood: the rows it references, and the rows that reference
 * it, one or two hops out.
 *
 * The walk is here and the database is not. `fetchRows` is handed in, so every
 * rule — which child edges may be read, how many rows an edge shows, one node
 * per row however many paths reach it, the node budget — is decided and tested
 * without a connection. The server's only job is to turn a {@link RowFetch}
 * into a statement.
 *
 * Hop two continues in the direction it started: parents of parents, children
 * of children. A parent's other children are siblings — the Find page's
 * question, not this one — and adding them turns a picture into a hairball.
 */

/** Rows shown per child edge before the rest fold into a `more` node. */
export const CHILDREN_PER_EDGE = 5
/** Nodes per neighborhood. Past this the picture stops being readable. */
export const NODE_BUDGET = 80
/** The row count past which a child edge is not read — the same bound row
 *  detail and Find count under. */
export const CHILD_ROW_BUDGET = 100_000
/** The column that names a row, first one a table has. */
export const LABEL_COLUMNS = ['name', 'title', 'label', 'email', 'code', 'slug', 'status'] as const

export type Depth = -2 | -1 | 0 | 1 | 2
export type Hops = 1 | 2
export type SkipReason = 'unindexed' | 'large' | 'timeout' | 'failed'

export interface NeighborTable {
  kind: NodeKind
  rowCount: number
  /** Single-column key, or `null` when the table has none. */
  keyColumn: string | null
  labelColumn: string | null
}

export interface NeighborhoodSchema {
  edges: readonly SchemaGraphEdge[]
  tables: Readonly<Record<string, NeighborTable>>
}

interface NodeBase {
  id: string
  table: string
  depth: Depth
  /** How the node was reached: `table.column = value`. */
  column: string
  value: string
}

export interface RowNode extends NodeBase {
  kind: 'row'
  keyColumn: string | null
  key: string | null
  label: string | null
}

export type NeighborNode =
  | RowNode
  /** More children on this edge than {@link CHILDREN_PER_EDGE}. How many is not counted. */
  | (NodeBase & { kind: 'more' })
  /** A parent value that points at no row. */
  | (NodeBase & { kind: 'missing' })
  /** An edge that was not read, and why. */
  | (NodeBase & { kind: 'skipped'; reason: SkipReason })

/** Always child → parent, whichever side the walk came from. */
export interface NeighborEdge {
  from: string
  to: string
  column: string
  basis: EdgeBasis
}

export interface RowNeighborhood {
  root: string
  nodes: NeighborNode[]
  edges: NeighborEdge[]
  /** The node budget ran out; some neighbors are not drawn. */
  truncated: boolean
}

/** Rows of `table` whose `column` equals each of `values`, at most `limit` per value. */
export interface RowFetch {
  table: string
  column: string
  values: string[]
  limit: number
  /** Columns to return, every one as text. */
  select: string[]
}

export type FetchedRow = Record<string, string | null>
export type FetchOutcome = { rows: FetchedRow[] } | { error: 'timeout' | 'failed' }
export type FetchRows = (request: RowFetch) => Promise<FetchOutcome>

export function labelColumn(columns: readonly string[]): string | null {
  const present = new Set(columns)
  return LABEL_COLUMNS.find((column) => present.has(column)) ?? null
}

/** What to read of a table's rows: its key, its label, the column it is looked
 *  up by, and every column an edge leaves or enters it through. */
function selectColumns(table: string, lookup: string, schema: NeighborhoodSchema): string[] {
  const info = schema.tables[table]
  const columns = new Set<string>([lookup])
  if (info?.keyColumn) columns.add(info.keyColumn)
  if (info?.labelColumn) columns.add(info.labelColumn)
  for (const edge of schema.edges) {
    if (edge.fromTable === table) columns.add(edge.fromColumn)
    if (edge.toTable === table) columns.add(edge.toColumn)
  }
  return [...columns].sort()
}

interface Reached {
  node: RowNode
  row: FetchedRow
}

interface Want {
  from: Reached
  edge: SchemaGraphEdge
  value: string
}

class NeighborhoodBuilder {
  private readonly nodes = new Map<string, NeighborNode>()
  private readonly edges = new Map<string, NeighborEdge>()
  truncated = false

  constructor(
    private readonly schema: NeighborhoodSchema,
    private readonly fetchRows: FetchRows,
    private readonly nodeBudget: number,
  ) {}

  request(table: string, column: string, values: Iterable<string>, limit: number): RowFetch {
    return { table, column, values: [...values], limit, select: selectColumns(table, column, this.schema) }
  }

  addRow(table: string, row: FetchedRow, column: string, depth: Depth): { node: RowNode; fresh: boolean } | null {
    const info = this.schema.tables[table]
    const keyColumn = info?.keyColumn ?? null
    const key = keyColumn ? (row[keyColumn] ?? null) : null
    const value = row[column] ?? ''
    // Keyed rows are one node however they were reached; a keyless row is
    // known only by the value that led to it.
    const id = key !== null ? `row:${table}:${keyColumn}=${key}` : `row:${table}:${column}=${value}`
    const existing = this.nodes.get(id)
    if (existing) return { node: existing as RowNode, fresh: false }
    if (!this.hasRoom()) return null
    const node: RowNode = {
      kind: 'row',
      id,
      table,
      depth,
      column,
      value,
      keyColumn: key !== null ? keyColumn : null,
      key,
      label: info?.labelColumn ? (row[info.labelColumn] ?? null) : null,
    }
    this.nodes.set(id, node)
    return { node, fresh: true }
  }

  addMarker(
    marker: { kind: 'more' | 'missing' } | { kind: 'skipped'; reason: SkipReason },
    table: string,
    column: string,
    value: string,
    depth: Depth,
  ): NeighborNode | null {
    const id = `${marker.kind}:${table}.${column}=${value}`
    const existing = this.nodes.get(id)
    if (existing) return existing
    if (!this.hasRoom()) return null
    const node = { ...marker, id, table, column, value, depth } as NeighborNode
    this.nodes.set(id, node)
    return node
  }

  link(from: string, to: string, edge: SchemaGraphEdge) {
    const key = `${from}|${to}|${edge.fromColumn}`
    if (!this.edges.has(key)) this.edges.set(key, { from, to, column: edge.fromColumn, basis: edge.basis })
  }

  private hasRoom(): boolean {
    if (this.nodes.size < this.nodeBudget) return true
    this.truncated = true
    return false
  }

  /** The rows `frontier` references, one step further left. */
  async parentsOf(frontier: readonly Reached[], depth: Depth): Promise<Reached[]> {
    const groups = new Map<string, Want[]>()
    for (const from of frontier) {
      for (const edge of this.schema.edges) {
        if (edge.fromTable !== from.node.table) continue
        const value = from.row[edge.fromColumn]
        if (value === null || value === undefined) continue
        const key = `${edge.toTable}.${edge.toColumn}`
        groups.set(key, [...(groups.get(key) ?? []), { from, edge, value }])
      }
    }

    const next: Reached[] = []
    for (const wants of groups.values()) {
      const { toTable, toColumn } = wants[0].edge
      const outcome = await this.fetchRows(this.request(toTable, toColumn, new Set(wants.map((w) => w.value)), 1))
      const byValue = new Map<string, FetchedRow>()
      if ('rows' in outcome) for (const row of outcome.rows) byValue.set(row[toColumn] ?? '', row)

      for (const want of wants) {
        const row = byValue.get(want.value)
        if ('error' in outcome) {
          const marker = this.addMarker({ kind: 'skipped', reason: outcome.error }, toTable, toColumn, want.value, depth)
          if (marker) this.link(want.from.node.id, marker.id, want.edge)
        } else if (row) {
          const added = this.addRow(toTable, row, toColumn, depth)
          if (!added) continue
          this.link(want.from.node.id, added.node.id, want.edge)
          if (added.fresh) next.push({ node: added.node, row })
        } else {
          const marker = this.addMarker({ kind: 'missing' }, toTable, toColumn, want.value, depth)
          if (marker) this.link(want.from.node.id, marker.id, want.edge)
        }
      }
    }
    return next
  }

  /** The rows referencing `frontier`, one step further right. */
  async childrenOf(frontier: readonly Reached[], depth: Depth): Promise<Reached[]> {
    const groups = new Map<string, Want[]>()
    for (const from of frontier) {
      for (const edge of this.schema.edges) {
        if (edge.toTable !== from.node.table) continue
        const child = this.schema.tables[edge.fromTable]
        // A view's rows are another table's rows; drawing them twice says nothing.
        if (!child || child.kind === 'view') continue
        const value = from.row[edge.toColumn]
        if (value === null || value === undefined) continue
        const skip = countSkipReason(edge.indexed, child.rowCount, CHILD_ROW_BUDGET)
        if (skip) {
          const marker = this.addMarker({ kind: 'skipped', reason: skip }, edge.fromTable, edge.fromColumn, value, depth)
          if (marker) this.link(marker.id, from.node.id, edge)
          continue
        }
        const key = `${edge.fromTable}.${edge.fromColumn}`
        groups.set(key, [...(groups.get(key) ?? []), { from, edge, value }])
      }
    }

    const next: Reached[] = []
    for (const wants of groups.values()) {
      const { fromTable, fromColumn } = wants[0].edge
      const outcome = await this.fetchRows(
        this.request(fromTable, fromColumn, new Set(wants.map((w) => w.value)), CHILDREN_PER_EDGE + 1),
      )
      const byValue = new Map<string, FetchedRow[]>()
      if ('rows' in outcome) {
        for (const row of outcome.rows) {
          const value = row[fromColumn] ?? ''
          byValue.set(value, [...(byValue.get(value) ?? []), row])
        }
      }

      for (const want of wants) {
        if ('error' in outcome) {
          const marker = this.addMarker({ kind: 'skipped', reason: outcome.error }, fromTable, fromColumn, want.value, depth)
          if (marker) this.link(marker.id, want.from.node.id, want.edge)
          continue
        }
        const rows = byValue.get(want.value) ?? []
        for (const row of rows.slice(0, CHILDREN_PER_EDGE)) {
          const added = this.addRow(fromTable, row, fromColumn, depth)
          if (!added) continue
          this.link(added.node.id, want.from.node.id, want.edge)
          if (added.fresh) next.push({ node: added.node, row })
        }
        if (rows.length > CHILDREN_PER_EDGE) {
          const marker = this.addMarker({ kind: 'more' }, fromTable, fromColumn, want.value, depth)
          if (marker) this.link(marker.id, want.from.node.id, want.edge)
        }
      }
    }
    return next
  }

  result(root: string): RowNeighborhood {
    return { root, nodes: [...this.nodes.values()], edges: [...this.edges.values()], truncated: this.truncated }
  }
}

export async function buildNeighborhood(
  root: { table: string; column: string; value: string },
  schema: NeighborhoodSchema,
  hops: Hops,
  fetchRows: FetchRows,
  { nodeBudget = NODE_BUDGET }: { nodeBudget?: number } = {},
): Promise<RowNeighborhood | null> {
  const builder = new NeighborhoodBuilder(schema, fetchRows, nodeBudget)
  const outcome = await fetchRows(builder.request(root.table, root.column, [root.value], 1))
  if ('error' in outcome) throw new Error(`Could not read ${root.table}.${root.column} = ${root.value} (${outcome.error})`)
  const row = outcome.rows[0]
  if (!row) return null

  const start = builder.addRow(root.table, row, root.column, 0)!
  let parents: Reached[] = [{ node: start.node, row }]
  let children: Reached[] = [{ node: start.node, row }]
  for (let hop = 1; hop <= hops; hop += 1) {
    parents = await builder.parentsOf(parents, -hop as Depth)
    children = await builder.childrenOf(children, hop as Depth)
  }
  return builder.result(start.node.id)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/row-neighborhood.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/row-neighborhood.ts tests/lib/row-neighborhood.test.ts
git commit -m "feat(neighborhood): walk a row's parents and children through the merged graph"
```

---

### Task 2: Layout

**Files:**
- Create: `src/lib/neighborhood-layout.ts`
- Test: `tests/lib/neighborhood-layout.test.ts`

**Interfaces:**
- Consumes: `RowNeighborhood`, `NeighborNode` from Task 1.
- Produces: `NODE_WIDTH = 200`, `NODE_HEIGHT = 52`, `COLUMN_GAP = 72`, `ROW_GAP = 12`; `interface PlacedNode { id: string; x: number; y: number }`; `interface NeighborhoodLayout { width: number; height: number; nodes: PlacedNode[]; edges: { from: string; to: string; column: string; path: string }[] }`; `layoutNeighborhood(graph: RowNeighborhood): NeighborhoodLayout`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/neighborhood-layout.test.ts
import { describe, expect, it } from 'vitest'
import { COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH, ROW_GAP, layoutNeighborhood } from '#/lib/neighborhood-layout'
import type { NeighborNode, RowNeighborhood } from '#/lib/row-neighborhood'

const row = (table: string, key: string, depth: NeighborNode['depth']): NeighborNode => ({
  kind: 'row', id: `row:${table}:id=${key}`, table, depth, column: 'id', value: key, keyColumn: 'id', key, label: null,
})

const root = row('orders', '10', 0)
const graph: RowNeighborhood = {
  root: root.id,
  nodes: [root, row('invoices', '101', 1), row('customers', '1', -1), row('invoices', '100', 1), row('invoices', '99', 1)],
  edges: [{ from: 'row:invoices:id=100', to: root.id, column: 'order_id', basis: 'declared' }],
  truncated: false,
}

describe('layoutNeighborhood', () => {
  it('places each depth in its own column, left to right', () => {
    const layout = layoutNeighborhood(graph)
    const x = (id: string) => layout.nodes.find((n) => n.id === id)!.x
    expect(x('row:customers:id=1')).toBe(0)
    expect(x(root.id)).toBe(NODE_WIDTH + COLUMN_GAP)
    expect(x('row:invoices:id=100')).toBe(2 * (NODE_WIDTH + COLUMN_GAP))
    expect(layout.width).toBe(3 * NODE_WIDTH + 2 * COLUMN_GAP)
  })

  it('orders a column by table then key, numbers as numbers, whatever the input order', () => {
    const shuffled = { ...graph, nodes: [...graph.nodes].reverse() }
    for (const g of [graph, shuffled]) {
      const layout = layoutNeighborhood(g)
      const column = layout.nodes.filter((n) => n.id.startsWith('row:invoices')).sort((a, b) => a.y - b.y)
      expect(column.map((n) => n.id)).toEqual(['row:invoices:id=99', 'row:invoices:id=100', 'row:invoices:id=101'])
    }
  })

  it('centres shorter columns against the tallest', () => {
    const layout = layoutNeighborhood(graph)
    expect(layout.height).toBe(3 * NODE_HEIGHT + 2 * ROW_GAP)
    expect(layout.nodes.find((n) => n.id === root.id)!.y).toBe(NODE_HEIGHT + ROW_GAP)
  })

  it('runs an edge from the child’s left side into the parent’s right side', () => {
    const [edge] = layoutNeighborhood(graph).edges
    const childX = 2 * (NODE_WIDTH + COLUMN_GAP)
    const parentRight = NODE_WIDTH + COLUMN_GAP + NODE_WIDTH
    expect(edge.path.startsWith(`M${childX},`)).toBe(true)
    expect(edge.path.endsWith(`${parentRight},${NODE_HEIGHT + ROW_GAP + NODE_HEIGHT / 2}`)).toBe(true)
  })

  it('draws a self-reference as a loop off the right side', () => {
    const self: RowNeighborhood = { root: root.id, nodes: [root], edges: [{ from: root.id, to: root.id, column: 'parent_id', basis: 'declared' }], truncated: false }
    const [edge] = layoutNeighborhood(self).edges
    expect(edge.path.startsWith(`M${NODE_WIDTH},`)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/neighborhood-layout.test.ts`
Expected: FAIL — cannot resolve `#/lib/neighborhood-layout`.

- [ ] **Step 3: Implement**

```ts
// src/lib/neighborhood-layout.ts
import type { NeighborNode, RowNeighborhood } from '#/lib/row-neighborhood'

/**
 * Where each node of a neighborhood sits: one column per depth, parents left,
 * children right, each column sorted by table and then key and centred on the
 * tallest. Deterministic, so a reload draws the same picture and a test can say
 * where a node is.
 */

export const NODE_WIDTH = 200
export const NODE_HEIGHT = 52
export const COLUMN_GAP = 72
export const ROW_GAP = 12

export interface PlacedNode {
  id: string
  x: number
  y: number
}

export interface NeighborhoodLayout {
  width: number
  height: number
  nodes: PlacedNode[]
  edges: { from: string; to: string; column: string; path: string }[]
}

const collator = new Intl.Collator('en', { numeric: true })

function sortKey(node: NeighborNode): string {
  return node.kind === 'row' && node.key !== null ? node.key : node.value
}

function compare(a: NeighborNode, b: NeighborNode): number {
  return (
    collator.compare(a.table, b.table) ||
    collator.compare(sortKey(a), sortKey(b)) ||
    collator.compare(a.kind, b.kind) ||
    collator.compare(a.id, b.id)
  )
}

/** Child's left side into the parent's right side; a node in the same column
 *  (a self-reference) loops out of its right side and back. */
export function edgePath(from: PlacedNode, to: PlacedNode): string {
  const y1 = from.y + NODE_HEIGHT / 2
  const y2 = to.y + NODE_HEIGHT / 2
  if (from.x > to.x) {
    const x1 = from.x
    const x2 = to.x + NODE_WIDTH
    const mid = (x1 + x2) / 2
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`
  }
  const x1 = from.x + NODE_WIDTH
  const x2 = to.x + NODE_WIDTH
  const bulge = Math.max(x1, x2) + COLUMN_GAP / 2
  const lift = from.id === to.id ? NODE_HEIGHT / 2 : 0
  return `M${x1},${y1} C${bulge},${y1 - lift} ${bulge},${y2 + lift} ${x2},${y2}`
}

export function layoutNeighborhood(graph: RowNeighborhood): NeighborhoodLayout {
  const byDepth = new Map<number, NeighborNode[]>()
  for (const node of graph.nodes) byDepth.set(node.depth, [...(byDepth.get(node.depth) ?? []), node])
  const depths = [...byDepth.keys()].sort((a, b) => a - b)
  const minDepth = depths[0] ?? 0
  const maxDepth = depths[depths.length - 1] ?? 0
  const columnHeight = (count: number) => count * NODE_HEIGHT + Math.max(0, count - 1) * ROW_GAP
  const tallest = Math.max(0, ...[...byDepth.values()].map((column) => column.length))
  const height = columnHeight(tallest)

  const placed = new Map<string, PlacedNode>()
  for (const depth of depths) {
    const column = [...byDepth.get(depth)!].sort(compare)
    const top = (height - columnHeight(column.length)) / 2
    const x = (depth - minDepth) * (NODE_WIDTH + COLUMN_GAP)
    column.forEach((node, index) => {
      placed.set(node.id, { id: node.id, x, y: top + index * (NODE_HEIGHT + ROW_GAP) })
    })
  }

  const columns = maxDepth - minDepth + 1
  return {
    width: columns * NODE_WIDTH + (columns - 1) * COLUMN_GAP,
    height,
    nodes: graph.nodes.map((node) => placed.get(node.id)!),
    edges: graph.edges.flatMap((edge) => {
      const from = placed.get(edge.from)
      const to = placed.get(edge.to)
      return from && to ? [{ from: edge.from, to: edge.to, column: edge.column, path: edgePath(from, to) }] : []
    }),
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/neighborhood-layout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/neighborhood-layout.ts tests/lib/neighborhood-layout.test.ts
git commit -m "feat(neighborhood): deterministic layered layout"
```

---

### Task 3: Server read

**Files:**
- Create: `src/server/row-neighborhood.ts`
- Modify: `src/server/functions.ts` (`fetchSchemaColumns` at ~252 and `fetchSchemaPrimaryKeys` at ~309 become `export async function`)
- Modify: `src/server/api.ts` (import + `$getRowNeighborhood` after `$findValueReach`)
- Test: `tests/server/row-neighborhood.test.ts`

**Interfaces:**
- Consumes: Task 1 `buildNeighborhood`, `labelColumn`, `RowFetch`, `FetchedRow`, `Hops`, `NeighborTable`; `getSchemaGraph`, `fetchSchemaColumns(schema): Promise<Map<string, ColumnInfo[]>>`, `fetchSchemaPrimaryKeys(schema): Promise<Map<string, string>>` from `#/server/functions`; `queryWithTimeout`, `StatementTimeoutError` from `#/server/db`.
- Produces: `rowFetchSql(schema: string, request: RowFetch): string`; `getRowNeighborhood(schema: string, table: string, id: string, column: string | undefined, hops: Hops): Promise<RowNeighborhood | null>`; `NEIGHBOR_FETCH_TIMEOUT_MS = 8000`; `$getRowNeighborhood` with input `Scoped & { schema: string; table: string; id: string; column?: string; hops: 1 | 2 }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/row-neighborhood.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryWithTimeout = vi.fn()

class StatementTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Query exceeded statement_timeout of ${timeoutMs}ms`)
    this.name = 'StatementTimeoutError'
  }
}

vi.mock('#/server/db', () => ({
  query: vi.fn(),
  queryWithTimeout: (...args: unknown[]) => mockQueryWithTimeout(...args),
  StatementTimeoutError,
}))

vi.mock('#/server/functions', () => ({
  getSchemaGraph: vi.fn(async () => ({
    schema: 'public',
    nodes: [
      { name: 'orders', kind: 'table', rowCount: 10 },
      { name: 'customers', kind: 'table', rowCount: 10 },
      { name: 'invoices', kind: 'table', rowCount: 10 },
      { name: 'audit', kind: 'table', rowCount: 10 },
    ],
    edges: [
      { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', basis: 'declared', nullable: true, indexed: true },
      { fromTable: 'invoices', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id', basis: 'model', nullable: true, indexed: true },
      { fromTable: 'audit', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id', basis: 'convention', nullable: true, indexed: false },
    ],
    staleness: {},
  })),
  fetchSchemaColumns: vi.fn(async () =>
    new Map([
      ['orders', [{ name: 'id' }, { name: 'status' }, { name: 'customer_id' }]],
      ['customers', [{ name: 'id' }, { name: 'name' }]],
      ['invoices', [{ name: 'id' }, { name: 'order_id' }]],
      ['audit', [{ name: 'id' }, { name: 'order_id' }]],
    ]),
  ),
  fetchSchemaPrimaryKeys: vi.fn(async () => new Map([['orders', 'id'], ['customers', 'id'], ['invoices', 'id']])),
}))

const { getRowNeighborhood, rowFetchSql, NEIGHBOR_FETCH_TIMEOUT_MS } = await import('#/server/row-neighborhood')

beforeEach(() => {
  mockQueryWithTimeout.mockReset()
})

describe('rowFetchSql', () => {
  it('quotes identifiers and literals, one limited branch per value', () => {
    const sql = rowFetchSql('pub"lic', { table: 'we"ird', column: 'id', values: ["o'brien", '2'], limit: 6, select: ['id', 'name'] })
    expect(sql).toContain('"pub""lic"."we""ird"')
    expect(sql).toContain("'o''brien'")
    expect(sql).toContain('id::text AS id')
    expect(sql.match(/LIMIT 6/g)).toHaveLength(2)
    expect(sql).toContain('UNION ALL')
  })
})

describe('getRowNeighborhood', () => {
  it('reads every row through queryWithTimeout and never queries a gated edge', async () => {
    mockQueryWithTimeout.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.invoices')) return { rows: [{ id: '100', order_id: '10' }] }
      if (sql.includes('FROM public.customers')) return { rows: [{ id: '1', name: 'Ada' }] }
      if (sql.includes('FROM public.orders')) return { rows: [{ id: '10', status: 'paid', customer_id: '1' }] }
      return { rows: [] }
    })
    const graph = (await getRowNeighborhood('public', 'orders', '10', undefined, 1))!
    expect(graph.nodes.map((n) => `${n.kind}:${n.table}`).sort()).toEqual([
      'row:customers',
      'row:invoices',
      'row:orders',
      'skipped:audit',
    ])
    for (const [sql, ms] of mockQueryWithTimeout.mock.calls) {
      expect(ms).toBe(NEIGHBOR_FETCH_TIMEOUT_MS)
      expect(sql).not.toContain('audit')
    }
  })

  it('turns a timed-out child read into a skipped node', async () => {
    mockQueryWithTimeout.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.invoices')) throw new StatementTimeoutError(NEIGHBOR_FETCH_TIMEOUT_MS)
      if (sql.includes('FROM public.customers')) return { rows: [] }
      return { rows: [{ id: '10', status: 'paid', customer_id: '1' }] }
    })
    const graph = (await getRowNeighborhood('public', 'orders', '10', undefined, 1))!
    expect(graph.nodes.find((n) => n.table === 'invoices')).toMatchObject({ kind: 'skipped', reason: 'timeout' })
  })

  it('falls back to the key when the lookup column does not exist', async () => {
    mockQueryWithTimeout.mockResolvedValue({ rows: [] })
    expect(await getRowNeighborhood('public', 'orders', '10', 'no_such_column', 1)).toBeNull()
    expect(mockQueryWithTimeout.mock.calls[0][0]).toMatch(/WHERE id = '10'/)
  })

  it('rejects a table the schema does not have', async () => {
    await expect(getRowNeighborhood('public', 'ghosts', '1', undefined, 1)).rejects.toThrow(/ghosts/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/row-neighborhood.test.ts`
Expected: FAIL — cannot resolve `#/server/row-neighborhood`.

- [ ] **Step 3: Implement**

In `src/server/functions.ts`, change `async function fetchSchemaColumns(` to `export async function fetchSchemaColumns(` and `async function fetchSchemaPrimaryKeys(` to `export async function fetchSchemaPrimaryKeys(`.

```ts
// src/server/row-neighborhood.ts
import format from 'pg-format'
import { StatementTimeoutError, queryWithTimeout } from '#/server/db'
import { fetchSchemaColumns, fetchSchemaPrimaryKeys, getSchemaGraph } from '#/server/functions'
import { buildNeighborhood, labelColumn } from '#/lib/row-neighborhood'
import type { FetchedRow, Hops, NeighborTable, RowFetch, RowNeighborhood } from '#/lib/row-neighborhood'

/**
 * A row's neighborhood, read. The walk and every rule it follows live in
 * `#/lib/row-neighborhood`; this file supplies the merged graph it walks and
 * turns each of its requests into one statement.
 *
 * Each request is a `UNION ALL` of one small, limited lookup per value, so the
 * limit applies per value (five invoices per order, not five in total) and each
 * branch can use the index the gate already required. Every statement runs
 * read-only under its own timeout; one that runs out becomes a "not read" node,
 * not a failed page.
 */

export const NEIGHBOR_FETCH_TIMEOUT_MS = 8_000
const FALLBACK_KEY = 'id'

export function rowFetchSql(schema: string, request: RowFetch): string {
  const select = request.select.map((column) => format('%I::text AS %I', column, column)).join(', ')
  const limit = Math.max(1, Math.floor(request.limit))
  return request.values
    .map((value) =>
      format('(SELECT %s FROM %I.%I WHERE %I = %L LIMIT %s)', select, schema, request.table, request.column, value, limit),
    )
    .join('\nUNION ALL\n')
}

export async function getRowNeighborhood(
  schema: string,
  table: string,
  id: string,
  column: string | undefined,
  hops: Hops,
): Promise<RowNeighborhood | null> {
  const [graph, columnsByTable, keys] = await Promise.all([
    getSchemaGraph(schema),
    fetchSchemaColumns(schema),
    fetchSchemaPrimaryKeys(schema),
  ])

  const tables: Record<string, NeighborTable> = {}
  for (const node of graph.nodes) {
    const names = (columnsByTable.get(node.name) ?? []).map((c) => c.name)
    tables[node.name] = {
      kind: node.kind,
      rowCount: node.rowCount,
      keyColumn: keys.get(node.name) ?? (names.includes(FALLBACK_KEY) ? FALLBACK_KEY : null),
      labelColumn: labelColumn(names),
    }
  }

  const rootColumns = (columnsByTable.get(table) ?? []).map((c) => c.name)
  if (!tables[table] || rootColumns.length === 0) throw new Error(`No table ${schema}.${table}`)
  // Same rule as row detail: the asked-for column if it exists, else the key.
  const lookup = column && rootColumns.includes(column) ? column : tables[table].keyColumn
  if (!lookup) throw new Error(`${schema}.${table} has no key to look a row up by`)

  return buildNeighborhood({ table, column: lookup, value: id }, { edges: graph.edges, tables }, hops, async (request) => {
    try {
      const result = await queryWithTimeout(rowFetchSql(schema, request), NEIGHBOR_FETCH_TIMEOUT_MS)
      return { rows: result.rows as FetchedRow[] }
    } catch (err) {
      if (err instanceof StatementTimeoutError) return { error: 'timeout' }
      // A convention edge whose two columns do not share a type fails to
      // compare; that edge is unreadable, not the neighborhood.
      return { error: 'failed' }
    }
  })
}
```

In `src/server/api.ts`, add `import { getRowNeighborhood } from '#/server/row-neighborhood'` beside the find-value import, and after `$findValueReach`:

```ts
export const $getRowNeighborhood = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: Scoped & { schema: string; table: string; id: string; column?: string; hops: 1 | 2 }) => data,
  )
  .handler(
    scoped((data) => getRowNeighborhood(data.schema, data.table, data.id, data.column, data.hops === 2 ? 2 : 1)),
  )
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/server/row-neighborhood.test.ts tests/server/functions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/row-neighborhood.ts src/server/functions.ts src/server/api.ts tests/server/row-neighborhood.test.ts
git commit -m "feat(neighborhood): read a row's neighborhood under a timeout"
```

---

### Task 4: Graph component

**Files:**
- Create: `src/components/neighborhood/NeighborhoodGraph.tsx`
- Test: `tests/components/neighborhood/NeighborhoodGraph.test.tsx`

**Interfaces:**
- Consumes: Task 1 types; Task 2 `layoutNeighborhood`, `NODE_WIDTH`, `NODE_HEIGHT`; `TableName`; `encodeConditions` from `#/lib/filter-model`.
- Produces: `default function NeighborhoodGraph({ database, schema, graph }: { database: string; schema: string; graph: RowNeighborhood })`; exported `skipReasonText(reason: SkipReason, table: string, column: string): string`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/neighborhood/NeighborhoodGraph.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import NeighborhoodGraph from '#/components/neighborhood/NeighborhoodGraph'
import { connectionStatusKey } from '#/hooks/useConnectionStatus'
import { setSetting } from '#/hooks/useAppSettings'
import type { RowNeighborhood } from '#/lib/row-neighborhood'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, title }: { children: React.ReactNode; title?: string }) => <a href="#" title={title}>{children}</a>,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/d/shop_db/t/public/orders/neighborhood/10' } }),
}))

afterEach(cleanup)

function render(ui: React.ReactNode) {
  setSetting('tableNameDisplay', 'model')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(connectionStatusKey, { connected: true })
  client.setQueryData(['mapModels', 'shop_db', 'public'], { orders: 'PurchaseOrder', customers: 'Client' })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const graph: RowNeighborhood = {
  root: 'row:orders:id=10',
  nodes: [
    { kind: 'row', id: 'row:orders:id=10', table: 'orders', depth: 0, column: 'id', value: '10', keyColumn: 'id', key: '10', label: 'paid' },
    { kind: 'missing', id: 'missing:customers.id=99', table: 'customers', depth: -1, column: 'id', value: '99' },
    { kind: 'skipped', id: 'skipped:audit.order_id=10', table: 'audit', depth: 1, column: 'order_id', value: '10', reason: 'unindexed' },
    { kind: 'more', id: 'more:invoices.order_id=10', table: 'invoices', depth: 1, column: 'order_id', value: '10' },
  ],
  edges: [{ from: 'missing:customers.id=99', to: 'row:orders:id=10', column: 'customer_id', basis: 'convention' }],
  truncated: false,
}

describe('NeighborhoodGraph', () => {
  it('names tables the way the setting asks', () => {
    render(<NeighborhoodGraph database="shop_db" schema="public" graph={graph} />)
    expect(screen.getByText('PurchaseOrder')).toBeTruthy()
    expect(screen.getByText('Client')).toBeTruthy()
  })

  it('says why an edge was not read, and that a parent is missing', () => {
    render(<NeighborhoodGraph database="shop_db" schema="public" graph={graph} />)
    expect(screen.getByText(/not read — no index on audit\.order_id/)).toBeTruthy()
    expect(screen.getByText(/no row with id = 99/)).toBeTruthy()
    expect(screen.getByText(/more →/)).toBeTruthy()
  })

  it('draws an inferred edge dashed', () => {
    const { container } = render(<NeighborhoodGraph database="shop_db" schema="public" graph={graph} />)
    expect(container.querySelector('path[stroke-dasharray]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/components/neighborhood`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement**

```tsx
// src/components/neighborhood/NeighborhoodGraph.tsx
import { Link } from '@tanstack/react-router'
import TableName from '#/components/TableName'
import { encodeConditions } from '#/lib/filter-model'
import { NODE_HEIGHT, NODE_WIDTH, layoutNeighborhood } from '#/lib/neighborhood-layout'
import type { NeighborNode, RowNeighborhood, SkipReason } from '#/lib/row-neighborhood'

export function skipReasonText(reason: SkipReason, table: string, column: string): string {
  switch (reason) {
    case 'unindexed':
      return `not read — no index on ${table}.${column}`
    case 'large':
      return 'not read — table too large to look up without an index budget'
    case 'timeout':
      return 'not read — timed out'
    case 'failed':
      return 'not read — the two columns do not compare'
  }
}

/** The child table filtered to this edge's value — where a `more` or `skipped`
 *  node sends you. */
function FilteredTableLink({ database, schema, node, children }: { database: string; schema: string; node: NeighborNode; children: React.ReactNode }) {
  return (
    <Link
      to="/d/$database/t/$schema/$table"
      params={{ database, schema, table: node.table }}
      search={{ q: encodeConditions([{ id: `nb-${node.column}`, column: node.column, op: 'eq', values: [node.value] }]) }}
      className="text-[var(--lagoon-deep)] no-underline hover:underline"
    >
      {children}
    </Link>
  )
}

function NodeBody({ database, schema, node, isRoot }: { database: string; schema: string; node: NeighborNode; isRoot: boolean }) {
  const title = (
    <span className="block truncate font-mono text-[11px] font-semibold text-[var(--sea-ink)]">
      <TableName table={node.table} />
    </span>
  )
  if (node.kind === 'row') {
    const id = node.key ?? node.value
    const col = node.key !== null ? node.keyColumn : node.column
    const search = col && col !== 'id' ? { col } : {}
    return (
      <>
        <Link
          to="/d/$database/t/$schema/$table/neighborhood/$id"
          params={{ database, schema, table: node.table, id }}
          search={search}
          title="Center the neighborhood on this row"
          className="block no-underline"
        >
          {title}
          <span className="block truncate text-[11px] text-[var(--sea-ink-soft)]">
            <span className="font-mono">{id}</span>
            {node.label ? ` · ${node.label}` : ''}
          </span>
        </Link>
        {!isRoot && (
          <Link
            to="/d/$database/t/$schema/$table/row/$id"
            params={{ database, schema, table: node.table, id }}
            search={search}
            title="Open this row"
            className="absolute right-1.5 top-1 text-[10px] text-[var(--sea-ink-soft)] no-underline hover:text-[var(--lagoon-deep)]"
          >
            ↗
          </Link>
        )}
      </>
    )
  }
  if (node.kind === 'missing') {
    return (
      <>
        {title}
        <span className="block truncate text-[11px] text-[var(--destructive)]">
          no row with {node.column} = {node.value}
        </span>
      </>
    )
  }
  return (
    <>
      {title}
      <span className="block truncate text-[11px] text-[var(--sea-ink-soft)]">
        <FilteredTableLink database={database} schema={schema} node={node}>
          {node.kind === 'more' ? 'more →' : skipReasonText(node.reason, node.table, node.column)}
        </FilteredTableLink>
      </span>
    </>
  )
}

/**
 * The neighborhood as a picture: boxes for rows, curves for references. Nodes
 * are DOM so table names and links render as they do everywhere else; only the
 * curves are SVG. An inferred reference is dashed — found, and labelled as
 * inferred.
 */
export default function NeighborhoodGraph({ database, schema, graph }: { database: string; schema: string; graph: RowNeighborhood }) {
  const layout = layoutNeighborhood(graph)
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const basisOf = new Map(graph.edges.map((edge) => [`${edge.from}|${edge.to}|${edge.column}`, edge.basis]))

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width: layout.width + 40, height: layout.height }}>
        <svg className="absolute inset-0" width={layout.width + 40} height={layout.height} aria-hidden="true">
          {layout.edges.map((edge) => {
            const basis = basisOf.get(`${edge.from}|${edge.to}|${edge.column}`)
            return (
              <path
                key={`${edge.from}|${edge.to}|${edge.column}`}
                d={edge.path}
                fill="none"
                stroke="var(--line)"
                strokeWidth={1.5}
                strokeDasharray={basis === 'declared' || basis === 'catalog' ? undefined : '4 3'}
              >
                <title>{`${edge.column} (${basis})`}</title>
              </path>
            )
          })}
        </svg>
        {layout.nodes.map((placed) => {
          const node = byId.get(placed.id)!
          const isRoot = node.id === graph.root
          return (
            <div
              key={node.id}
              className={`absolute rounded-lg border px-2 py-1.5 ${
                isRoot
                  ? 'border-[var(--lagoon)] bg-[var(--surface-strong)]'
                  : node.kind === 'row'
                    ? 'border-[var(--line)] bg-[var(--surface)]'
                    : 'border-dashed border-[var(--line)] bg-transparent'
              }`}
              style={{ left: placed.x, top: placed.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
            >
              <NodeBody database={database} schema={schema} node={node} isRoot={isRoot} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

Note: the `Link` to `/neighborhood/$id` only type-checks after Task 5 creates the route and the build regenerates `routeTree.gen.ts`. Run Task 4's component test now (Vitest mocks the router); the filtered tsc check waits for Task 5.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/components/neighborhood`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/neighborhood/NeighborhoodGraph.tsx tests/components/neighborhood/NeighborhoodGraph.test.tsx
git commit -m "feat(neighborhood): draw the neighborhood"
```

---

### Task 5: Route, search validation, row-detail link

**Files:**
- Create: `src/lib/neighborhood-search.ts`
- Create: `src/routes/d/$database/t/$schema/$table/neighborhood/$id.tsx`
- Modify: `src/routes/d/$database/t/$schema/$table/row/$id.tsx` (header, next to the "Where else" `Link`, ~line 129)
- Modify: `src/routeTree.gen.ts` (regenerated by `npm run build`)
- Test: `tests/lib/neighborhood-search.test.ts`

**Interfaces:**
- Consumes: `$getRowNeighborhood` (Task 3), `NeighborhoodGraph` (Task 4), `useConnectionGuard`, `useDatabaseParam`, `TableName`.
- Produces: `interface NeighborhoodSearch { col?: string; hops?: 2 }`, `validateNeighborhoodSearch(search: Record<string, unknown>): NeighborhoodSearch`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/neighborhood-search.test.ts
import { describe, expect, it } from 'vitest'
import { validateNeighborhoodSearch } from '#/lib/neighborhood-search'

describe('validateNeighborhoodSearch', () => {
  it('keeps two hops, as a number or a string', () => {
    expect(validateNeighborhoodSearch({ hops: 2 })).toEqual({ hops: 2 })
    expect(validateNeighborhoodSearch({ hops: '2' })).toEqual({ hops: 2 })
  })

  it('treats anything else as the one-hop default, left out of the URL', () => {
    for (const hops of [1, '1', 3, 'banana', null, undefined]) {
      expect(validateNeighborhoodSearch({ hops })).toEqual({})
    }
  })

  it('keeps a non-empty lookup column', () => {
    expect(validateNeighborhoodSearch({ col: 'uuid' })).toEqual({ col: 'uuid' })
    expect(validateNeighborhoodSearch({ col: '' })).toEqual({})
    expect(validateNeighborhoodSearch({ col: 4 })).toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/neighborhood-search.test.ts`
Expected: FAIL — cannot resolve `#/lib/neighborhood-search`.

- [ ] **Step 3: Implement**

```ts
// src/lib/neighborhood-search.ts
/** The neighborhood page's URL. One hop is the default and is left out, so the
 *  plain link and the one-hop page are the same URL. */
export interface NeighborhoodSearch {
  col?: string
  hops?: 2
}

export function validateNeighborhoodSearch(search: Record<string, unknown>): NeighborhoodSearch {
  const out: NeighborhoodSearch = {}
  if (typeof search.col === 'string' && search.col.length > 0) out.col = search.col
  if (search.hops === 2 || search.hops === '2') out.hops = 2
  return out
}
```

```tsx
// src/routes/d/$database/t/$schema/$table/neighborhood/$id.tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import NeighborhoodGraph from '#/components/neighborhood/NeighborhoodGraph'
import TableName from '#/components/TableName'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { validateNeighborhoodSearch } from '#/lib/neighborhood-search'
import { $getRowNeighborhood } from '#/server/api'

export const Route = createFileRoute('/d/$database/t/$schema/$table/neighborhood/$id')({
  component: NeighborhoodPage,
  validateSearch: validateNeighborhoodSearch,
})

function NeighborhoodPage() {
  const database = useDatabaseParam()
  const { schema, table, id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const hops = search.hops ?? 1
  const { isChecking, isConnected } = useConnectionGuard()

  const neighborhood = useQuery({
    queryKey: ['rowNeighborhood', database, schema, table, id, search.col ?? '', hops],
    queryFn: () => $getRowNeighborhood({ data: { database, schema, table, id, column: search.col, hops } }),
    enabled: isConnected,
    staleTime: 30_000,
  })

  if (isChecking) {
    return <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">Checking connection...</div>
  }

  const rowSearch = search.col ? { col: search.col } : {}

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="mx-auto max-w-7xl space-y-3">
        <header className="flex flex-wrap items-center gap-3">
          <div>
            <p className="island-kicker">Neighborhood</p>
            <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
              <TableName table={table} /> <span className="font-mono text-[var(--sea-ink-soft)]">{id}</span>
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {([1, 2] as const).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={hops === n}
                onClick={() => navigate({ search: (old) => ({ ...old, hops: n === 2 ? 2 : undefined }), replace: true })}
                className={`rounded-full border px-2 py-0.5 transition ${
                  hops === n
                    ? 'border-[var(--lagoon)] text-[var(--lagoon-deep)]'
                    : 'border-[var(--line)] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)]/60'
                }`}
              >
                {n} hop{n === 2 ? 's' : ''}
              </button>
            ))}
            <Link
              to="/d/$database/t/$schema/$table/row/$id"
              params={{ database, schema, table, id }}
              search={rowSearch}
              className="whitespace-nowrap rounded-full border border-[var(--chip-line)] px-2 py-0.5 text-[var(--palm)] transition hover:bg-[var(--link-bg-hover)]"
            >
              Row
            </Link>
          </div>
        </header>

        {neighborhood.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Could not read the neighborhood: {String((neighborhood.error as Error).message ?? neighborhood.error)}
          </div>
        )}

        {neighborhood.isLoading && <div className="island-shell h-64 animate-pulse rounded-xl" />}

        {neighborhood.data === null && (
          <p className="text-sm text-[var(--sea-ink-soft)]">
            No row with {search.col ?? 'its key'} = {id}.
          </p>
        )}

        {neighborhood.data && (
          <section className="island-shell space-y-2 rounded-xl px-3 py-3">
            <p className="text-[11px] text-[var(--sea-ink-soft)]">
              Referenced rows on the left, referencing rows on the right. Dashed lines are references inferred from the
              model map or a column name, not a constraint.
              {neighborhood.data.truncated && ' Stopped at 80 nodes — center on a neighbor to see further.'}
            </p>
            <NeighborhoodGraph database={database} schema={schema} graph={neighborhood.data} />
          </section>
        )}
      </div>
    </main>
  )
}
```

Row detail header, directly before the "Where else" `<Link>`:

```tsx
            <Link
              to="/d/$database/t/$schema/$table/neighborhood/$id"
              params={{ database, schema, table, id }}
              search={col ? { col } : {}}
              title="This row's parents and children, drawn"
              className="whitespace-nowrap rounded-full border border-[var(--chip-line)] px-2 py-0.5 text-xs text-[var(--palm)] transition hover:bg-[var(--link-bg-hover)]"
            >
              Neighborhood
            </Link>
```

- [ ] **Step 4: Run tests, build, typecheck**

Run: `npx vitest run tests/lib/neighborhood-search.test.ts && npm run build && npx tsc --noEmit -p . | grep -v "^src/router.tsx" | grep error`
Expected: tests PASS (3); build succeeds and regenerates `src/routeTree.gen.ts`; the grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/neighborhood-search.ts tests/lib/neighborhood-search.test.ts "src/routes/d/\$database/t/\$schema/\$table/neighborhood/\$id.tsx" "src/routes/d/\$database/t/\$schema/\$table/row/\$id.tsx" src/routeTree.gen.ts
git commit -m "feat(neighborhood): page, linked from row detail"
```

---

### Task 6: Help topic and README

**Files:**
- Create: `src/lib/help/topics/row-neighborhood.ts`, `src/components/help/previews/RowNeighborhoodPreview.tsx`
- Modify: `src/lib/help/index.ts` (import and list `rowNeighborhoodTopic` after `rowPageTopic`), `src/components/help/previews/index.ts` (`'row-neighborhood': RowNeighborhoodPreview`), `README.md` (bullet after *Find a value*)
- Test: `tests/lib/help/registry.test.ts` (existing)

**Interfaces:**
- Consumes: `HelpTopic` from `#/lib/help/types`; `Marked` from `#/components/help/highlight`.

- [ ] **Step 1: Write the topic**

Before writing, open `src/lib/help/topics/row-page.ts` to copy its `section` value exactly, and run `grep -n "format('(SELECT %s FROM %I.%I WHERE %I = %L LIMIT %s)'" src/server/row-neighborhood.ts` for the source line.

```ts
// src/lib/help/topics/row-neighborhood.ts
import type { HelpTopic } from '#/lib/help/types'

export const rowNeighborhoodTopic: HelpTopic = {
  id: 'row-neighborhood',
  section: '<copy from row-page.ts>',
  title: 'Row neighborhood',
  question: 'What is this row attached to, drawn?',
  answer:
    'Starting from one row, the page follows every reference the merged graph knows about: to the rows it points at, and from the rows that point at it, one or two steps out. Each step is one small lookup per value, limited per value, and a child table is only read when an index leads with the referencing column and the table is under 100k rows. Everything else is drawn as a node that says why it was not read.',
  route: '/t/$schema/$table/neighborhood/$id',
  previewCaption: 'One order with its customer, its invoices, and an edge that was not read. Hover a clause to see what it draws.',
  source: {
    file: 'src/server/row-neighborhood.ts',
    line: 0,
    anchor: "format('(SELECT %s FROM %I.%I WHERE %I = %L LIMIT %s)'",
  },
  prerequisite: null,
  steps: [
    {
      id: 'select',
      clause: '(SELECT id::text AS id, name::text AS name',
      title: 'Only what a node shows',
      detail: 'The key, a label column if the table has one (`name`, `title`, `email`, …), and the columns references leave or enter through — as text, so any type draws the same way.',
    },
    {
      id: 'where',
      clause: '   FROM public.invoices WHERE order_id = \'10\'',
      title: 'One value at a time',
      detail: 'Each value gets its own lookup, so the index the gate required can serve it directly.',
    },
    {
      id: 'limit',
      clause: '   LIMIT 6)',
      title: 'Five, and whether there are more',
      detail: 'Six are asked for and five drawn: the sixth only says a "more" node belongs there. How many more is not counted — the node links to the filtered table.',
    },
    {
      id: 'union',
      clause: 'UNION ALL\n(SELECT … WHERE order_id = \'11\' LIMIT 6)',
      title: 'Many values, one statement',
      detail: 'Every value on the same column goes in one statement, run read-only under an 8-second timeout. A statement that runs out becomes "not read — timed out" nodes; the rest of the picture stays.',
    },
  ],
  terms: [
    { term: 'hop', meaning: 'One reference followed. Two hops go on in the same direction: parents of parents, children of children.' },
    { term: 'inferred reference', meaning: 'A link from the model map or a column-name rule rather than a constraint — drawn dashed.' },
  ],
  cost: 'One statement per referenced or referencing column per hop, each an index lookup per value. Loading the merged graph is the same read the lens and Find make.',
}
```

Set `line` to the grep's line number.

- [ ] **Step 2: Write the preview**

```tsx
// src/components/help/previews/RowNeighborhoodPreview.tsx
import { Marked } from '#/components/help/highlight'

/** Slim stand-in for the neighborhood page. */
export default function RowNeighborhoodPreview() {
  const box = 'rounded-md border border-[var(--line)] px-2 py-1'
  return (
    <div className="flex items-center gap-4 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className={box}>
        <div className="font-mono font-semibold">customers</div>
        <div className="text-[var(--sea-ink-soft)]">
          1 · <Marked step="select">Ada</Marked>
        </div>
      </div>
      <span className="text-[var(--sea-ink-soft)]">←</span>
      <div className={`${box} border-[var(--lagoon)]`}>
        <div className="font-mono font-semibold">orders</div>
        <div className="text-[var(--sea-ink-soft)]">10 · paid</div>
      </div>
      <span className="text-[var(--sea-ink-soft)]">←</span>
      <div className="space-y-1">
        <div className={box}>
          <div className="font-mono font-semibold">
            <Marked step="where">invoices</Marked>
          </div>
          <div className="text-[var(--sea-ink-soft)]">100</div>
        </div>
        <div className={`${box} border-dashed`}>
          <div className="font-mono font-semibold">invoices</div>
          <div className="text-[var(--sea-ink-soft)]">
            <Marked step="limit">more →</Marked>
          </div>
        </div>
        <div className={`${box} border-dashed`}>
          <div className="font-mono font-semibold">audit</div>
          <div className="text-[var(--sea-ink-soft)]">
            <Marked step="union">not read — timed out</Marked>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Register both** — in `src/lib/help/index.ts` import `rowNeighborhoodTopic` and list it after `rowPageTopic`; in `src/components/help/previews/index.ts` import and add `'row-neighborhood': RowNeighborhoodPreview`.

- [ ] **Step 4: README** — after the *Find a value* bullet:

```markdown
- **Row neighborhood** (`/d/$database/t/$schema/$table/neighborhood/$id`) — one
  row drawn with what it is attached to: the rows it references on the left,
  the rows referencing it on the right, one or two hops out, every reference the
  merged graph knows (inferred ones dashed). Five children per reference, then a
  *more* node; a child table is read only where an index leads with the column
  and the table is small enough, and every other edge is a node saying why it
  was not read. Click a node to center on it.
```

- [ ] **Step 5: Run the registry test and commit**

Run: `npx vitest run tests/lib/help/registry.test.ts`
Expected: PASS, including `row-neighborhood still points at the statement it documents`.

```bash
git add src/lib/help/topics/row-neighborhood.ts src/components/help/previews/RowNeighborhoodPreview.tsx src/lib/help/index.ts src/components/help/previews/index.ts README.md
git commit -m "docs: row neighborhood in help and the feature list"
```

---

### Task 7: Full verification

- [ ] **Step 1:** `npx vitest run`. Expected: whole suite passes.
- [ ] **Step 2:** `npx tsc --noEmit -p . | grep -v "^src/router.tsx" | grep error`. Expected: no output.
- [ ] **Step 3:** `npm run build`. Expected: success.
