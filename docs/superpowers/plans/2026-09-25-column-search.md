# Column Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find a column by name or type from the palette, or list every matching column in a schema on its own page with its type, reference, index, stats and comment.

**Architecture:**
- **Pure module:** `src/lib/column-search.ts` turns three cached reads into one flat `ColumnEntry[]` and does all matching, filtering and URL work. The three reads are `$introspect`, `$getSchemaGraph`, and a new `$getColumnFacets`.
- **Server:** one new server file adds the single catalog read for facets.
- **Hook:** `useColumnIndex` joins the three queries.
- **Consumers:** the palette and a new route `/d/$database/columns/$schema` consume the hook. The palette uses only the introspection part.

**Tech Stack:** TanStack Start (server functions, file routes), React Query, TypeScript, Tailwind, Vitest (`npm test`), `pg` behind `#/server/db`.

**Spec:** `docs/superpowers/specs/2026-09-23-column-search-design.md`

## Global Constraints

- **Read-only, catalog-only.** No statement may read table data. Everything comes from `pg_attribute`, `pg_class`, `pg_index`, `pg_stats`, `pg_stat_user_tables` and `col_description`.
- **Public repo.** No internal table or column names in code, tests, fixtures, or commits. Use generic names (`orders`, `customers`, `project_id`).
- **Unknown is never zero.** No stats row → `null`, rendered as "—" with "never analyzed". Never `0%`.
- **Reference basis is always labelled** with `BasisTag`. Never mix bases.
- **A result is a link.** All survey filters live in the URL search params. Changing a filter uses `replace: true`.
- **Match the house style:**
  - one clear doc comment per exported function explaining *why*;
  - `#/` import alias;
  - CSS vars `--sea-ink`, `--sea-ink-soft`, `--line`, `--lagoon`, `--lagoon-deep`;
  - `island-kicker` for page kickers.
- **No compat fallbacks:** nothing reads an old layout.

## Review Focus

1. **The same column name in many tables** (`created_at` in every table). The palette root must not flood. Survey rows must be stable-sorted by table. *Test in Task 1.*
2. **A column that is both a declared FK and a model/convention edge.** It must show one reference, the strongest basis (declared > model > convention > catalog), never two rows. *Test in Task 2.*
3. **A view or a never-analyzed table.** Facets come back with `nullFrac: null`, and the row renders "—", not "0%". *Test in Task 3 (server) and Task 2 (filter treats null stats as unknown, not as "no nulls").*
4. **A malformed or hand-edited URL** (`?indexed=banana&type=` or `ref=nope`). Decoding drops unknown values instead of throwing or filtering everything out. *Test in Task 2.*
5. **Active-table columns shown twice on the palette root.** The root already lists the active table's columns under *Filter by column*. Schema-wide column hits must skip that table. *Test in Task 1 via `excludeTable`.*

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/column-search.ts` (create) | Types `ColumnEntry`, `ColumnFacet`, `ColumnFacets`, `ColumnSearch`. `buildColumnEntries`, `confidentColumnMatches`, `searchColumns`, `validateColumnSearch`, `isUnindexedReference`. Pure. |
| `src/server/column-facets.ts` (create) | `getColumnFacets(schema)`: two catalog reads → `ColumnFacets`. |
| `src/server/api.ts` (modify) | Export `$getColumnFacets`. |
| `src/hooks/useColumnIndex.ts` (create) | Joins introspect + graph + facets queries into entries, with loading and error flags. |
| `src/routes/d/$database/columns/$schema.tsx` (create) | Survey page. |
| `src/components/columns/ColumnFilters.tsx` (create) | Query box + type chips + ref / indexed / nullable selects. |
| `src/components/columns/ColumnTable.tsx` (create) | The result table. |
| `src/lib/menu-routes.ts` (modify) | Add `/columns` to `DATABASE_ROUTES`. |
| `src/components/Header.tsx` (modify) | Menu entry. |
| `src/lib/palette/views.ts` (modify) | New view `{ kind: 'columns' }`. |
| `src/lib/palette/actions.ts` (modify) | Root action `columns` (push the page), route `'columns'`. |
| `src/components/palette/Palette.tsx` (modify) | Root column hits, `Columns` page, `⇥` = notNull filter, *All N matches →* row. |
| `src/lib/help/topics/column-search.ts`, `src/components/help/previews/ColumnSearchPreview.tsx`, `src/lib/help/index.ts`, `src/components/help/previews/index.ts` (create/modify) | Help topic. |
| Tests | `tests/lib/column-search.test.ts`, `tests/server/column-facets.test.ts`, `tests/lib/palette-actions.test.ts`, `tests/lib/palette-views.test.ts` (if it exists; otherwise add cases to `palette-actions`), `tests/lib/menu-routes.test.ts` (if it exists). |

---

### Task 1: Column entries and palette-grade matching

**Files:**
- Create: `src/lib/column-search.ts`
- Test: `tests/lib/column-search.test.ts`

**Interfaces:**
- Consumes:
  - `TableInfo`, `SchemaGraph`, `SchemaGraphEdge`, `EdgeBasis` from `#/lib/types`;
  - `confidentTableMatches`, `MAX_MATCHES` from `#/lib/palette/table-matches`.
- Produces:
  ```ts
  export interface ColumnReference { toTable: string; toColumn: string; basis: EdgeBasis }
  export interface ColumnFacet {
    index: 'lead' | 'member' | null
    nullFrac: number | null
    nDistinctRaw: number | null
    comment: string | null
  }
  export interface ColumnFacets {
    columns: Record<string, ColumnFacet>          // key: `${table}.${column}`
    analyzedAt: Record<string, string | null>     // key: table
  }
  export interface ColumnEntry {
    table: string
    column: string
    dataType: string
    isNullable: boolean
    rowCount: number | null
    group: string | null
    model: string | null
    reference: ColumnReference | null
    facet: ColumnFacet | null                     // null = facets not loaded / failed
  }
  export function facetKey(table: string, column: string): string
  export function buildColumnEntries(
    tables: readonly TableInfo[],
    graph: SchemaGraph | undefined,
    facets: ColumnFacets | undefined,
  ): ColumnEntry[]
  export function confidentColumnMatches(
    entries: readonly ColumnEntry[],
    query: string,
    opts?: { limit?: number; excludeTable?: string },
  ): ColumnEntry[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/column-search.test.ts
import { describe, expect, it } from 'vitest'
import {
  buildColumnEntries,
  confidentColumnMatches,
  facetKey,
} from '#/lib/column-search'
import type { SchemaGraph, TableInfo } from '#/lib/types'

function table(name: string, columns: Array<[string, string, boolean?]>, rowCount = 10): TableInfo {
  return {
    name,
    schema: 'public',
    kind: 'table',
    rowCount,
    lastModified: null,
    pkColumn: 'id',
    columns: columns.map(([col, dataType, isNullable]) => ({
      name: col,
      dataType,
      isNullable: isNullable ?? false,
    })),
  }
}

const tables: TableInfo[] = [
  table('orders', [['id', 'uuid'], ['customer_id', 'uuid'], ['created_at', 'timestamp with time zone']], 500),
  table('customers', [['id', 'uuid'], ['created_at', 'timestamp with time zone'], ['payload', 'jsonb', true]], 50),
  table('invoices', [['id', 'uuid'], ['order_id', 'uuid', true], ['created_at', 'timestamp with time zone']], 5000),
]

const graph: SchemaGraph = {
  schema: 'public',
  nodes: [
    { name: 'orders', schema: 'public', model: 'Order', group: 'Sales', groupIsDerived: false, kind: 'table', rowCount: 500 },
    { name: 'customers', schema: 'public', model: 'Customer', group: 'Sales', groupIsDerived: false, kind: 'table', rowCount: 50 },
  ] as SchemaGraph['nodes'],
  edges: [
    { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', basis: 'convention', nullable: false, indexed: true },
    { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', basis: 'declared', nullable: false, indexed: true },
    { fromTable: 'invoices', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id', basis: 'model', nullable: true, indexed: false },
  ],
  staleness: {} as SchemaGraph['staleness'],
}

describe('buildColumnEntries', () => {
  it('makes one entry per column, sorted by table then column order', () => {
    const entries = buildColumnEntries(tables, undefined, undefined)
    expect(entries).toHaveLength(9)
    expect(entries.map((e) => e.table)).toEqual([
      'customers', 'customers', 'customers',
      'invoices', 'invoices', 'invoices',
      'orders', 'orders', 'orders',
    ])
    expect(entries[2]).toMatchObject({ column: 'payload', dataType: 'jsonb', isNullable: true, facet: null, reference: null })
  })

  it('keeps the strongest basis when one column has several edges', () => {
    const entries = buildColumnEntries(tables, graph, undefined)
    const fk = entries.find((e) => e.table === 'orders' && e.column === 'customer_id')
    expect(fk?.reference).toEqual({ toTable: 'customers', toColumn: 'id', basis: 'declared' })
    expect(entries.filter((e) => e.column === 'customer_id')).toHaveLength(1)
  })

  it('takes group and model from the graph node, null when absent', () => {
    const entries = buildColumnEntries(tables, graph, undefined)
    expect(entries.find((e) => e.table === 'orders')).toMatchObject({ group: 'Sales', model: 'Order' })
    expect(entries.find((e) => e.table === 'invoices')).toMatchObject({ group: null, model: null })
  })

  it('attaches facets by table.column', () => {
    const facets = {
      columns: { [facetKey('customers', 'payload')]: { index: null, nullFrac: 0.4, nDistinctRaw: -1, comment: 'raw' } },
      analyzedAt: { customers: '2026-09-01T00:00:00.000Z' },
    }
    const entries = buildColumnEntries(tables, undefined, facets)
    expect(entries.find((e) => e.column === 'payload')?.facet).toEqual({ index: null, nullFrac: 0.4, nDistinctRaw: -1, comment: 'raw' })
    // A column the facets did not mention is unknown, not "no stats".
    expect(entries.find((e) => e.table === 'orders' && e.column === 'id')?.facet).toBeNull()
  })
})

describe('confidentColumnMatches', () => {
  const entries = buildColumnEntries(tables, graph, undefined)

  it('needs at least two characters', () => {
    expect(confidentColumnMatches(entries, 'c')).toEqual([])
  })

  it('caps a name every table shares at the limit', () => {
    const hits = confidentColumnMatches(entries, 'created_at', { limit: 2 })
    expect(hits).toHaveLength(2)
    // Ties on the name break on row count, biggest first — the same rule tables use.
    expect(hits.map((e) => e.table)).toEqual(['invoices', 'orders'])
  })

  it('matches a name typed in pieces', () => {
    const hits = confidentColumnMatches(entries, 'custid')
    expect(hits.map((e) => `${e.table}.${e.column}`)).toEqual(['orders.customer_id'])
  })

  it('skips the excluded table, whose columns the root already lists', () => {
    const hits = confidentColumnMatches(entries, 'created_at', { excludeTable: 'invoices' })
    expect(hits.map((e) => e.table)).not.toContain('invoices')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/column-search.test.ts`
Expected: FAIL, `Failed to resolve import "#/lib/column-search"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/column-search.ts
import { MAX_MATCHES, confidentTableMatches } from '#/lib/palette/table-matches'
import type { EdgeBasis, SchemaGraph, SchemaGraphEdge, TableInfo } from '#/lib/types'

/**
 * Columns as a thing to search for, rather than something found by opening a
 * table first.
 *
 * The question people bring is "which table has `project_id`", or "every
 * `jsonb` column here". The answer is already on the client: introspection holds
 * every column, and the merged graph holds what each one references. The one
 * extra read, the facets, adds what the catalog knows about indexes, statistics
 * and comments. This module joins the three and does the searching. It fetches
 * nothing.
 */

export interface ColumnReference {
  toTable: string
  toColumn: string
  basis: EdgeBasis
}

/** What the catalog knows about one column, beyond its name and type. */
export interface ColumnFacet {
  /** Leads some index, appears later in one, or in none. */
  index: 'lead' | 'member' | null
  /** Share of rows that are null, from the last ANALYZE. `null` means no stats, never "none". */
  nullFrac: number | null
  /** `pg_stats.n_distinct` as stored. Resolve with `estimateDistinct`. */
  nDistinctRaw: number | null
  comment: string | null
}

export interface ColumnFacets {
  /** Keyed by {@link facetKey}. */
  columns: Record<string, ColumnFacet>
  /** Per table, the later of the manual and auto ANALYZE, ISO. */
  analyzedAt: Record<string, string | null>
}

export interface ColumnEntry {
  table: string
  column: string
  dataType: string
  isNullable: boolean
  rowCount: number | null
  group: string | null
  model: string | null
  reference: ColumnReference | null
  /** `null` when the facets have not arrived, failed, or did not mention this column. */
  facet: ColumnFacet | null
}

export function facetKey(table: string, column: string): string {
  return `${table}.${column}`
}

/**
 * Strongest first. A column that is a declared FK and also matches a naming rule
 * is a declared FK. Showing the weaker basis beside it would say the schema is
 * less sure than it is.
 */
const BASIS_STRENGTH: Record<EdgeBasis, number> = {
  declared: 0,
  model: 1,
  convention: 2,
  catalog: 3,
}

function strongestEdges(edges: readonly SchemaGraphEdge[]): Map<string, SchemaGraphEdge> {
  const best = new Map<string, SchemaGraphEdge>()
  for (const edge of edges) {
    const key = facetKey(edge.fromTable, edge.fromColumn)
    const held = best.get(key)
    if (!held || BASIS_STRENGTH[edge.basis] < BASIS_STRENGTH[held.basis]) best.set(key, edge)
  }
  return best
}

/**
 * One entry per column, tables alphabetical and columns in table order. That
 * order is the tie-break every later sort falls back on, so two renders of the
 * same schema list the same rows the same way.
 */
export function buildColumnEntries(
  tables: readonly TableInfo[],
  graph: SchemaGraph | undefined,
  facets: ColumnFacets | undefined,
): ColumnEntry[] {
  const edges = strongestEdges(graph?.edges ?? [])
  const nodes = new Map((graph?.nodes ?? []).map((node) => [node.name, node]))
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name))

  const entries: ColumnEntry[] = []
  for (const table of sorted) {
    const node = nodes.get(table.name)
    for (const column of table.columns) {
      const key = facetKey(table.name, column.name)
      const edge = edges.get(key)
      entries.push({
        table: table.name,
        column: column.name,
        dataType: column.dataType,
        isNullable: column.isNullable,
        rowCount: table.rowCount ?? null,
        group: node?.group ?? null,
        model: node?.model ?? null,
        reference: edge
          ? { toTable: edge.toTable, toColumn: edge.toColumn, basis: edge.basis }
          : null,
        facet: facets?.columns[key] ?? null,
      })
    }
  }
  return entries
}

/**
 * Column hits for the palette root: the same confidence gate as table names,
 * applied to the column name, so a column is offered only when the typing
 * clearly meant it.
 *
 * `excludeTable` is the table on screen, whose columns the root already offers
 * as filters. Listing them twice would make the root read as two answers to one
 * question.
 */
export function confidentColumnMatches(
  entries: readonly ColumnEntry[],
  query: string,
  opts: { limit?: number; excludeTable?: string } = {},
): ColumnEntry[] {
  const candidates = entries
    .filter((entry) => entry.table !== opts.excludeTable)
    .map((entry) => ({ name: entry.column, rowCount: entry.rowCount, entry }))
  return confidentTableMatches(candidates, query, opts.limit ?? MAX_MATCHES).map(
    (hit) => hit.entry,
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/column-search.test.ts`
Expected: PASS, 8 tests.

> If `custid` doesn't match: `looseRank` needs at least 60% of the query in runs of 2 or more. `cust` + `id` = 6/6, so it should match. If it fails, check the test data before touching the matcher. The matcher is shared with tables and is not to be changed in this task.

- [ ] **Step 5: Commit**

```bash
git add src/lib/column-search.ts tests/lib/column-search.test.ts
git commit -m "feat(columns): join introspection, graph and facets into column entries"
```

---

### Task 2: Survey filtering and URL state

**Files:**
- Modify: `src/lib/column-search.ts`
- Test: `tests/lib/column-search.test.ts`

**Interfaces:**
- Consumes: `ColumnEntry`, `matchRank` from `#/lib/palette/table-matches`, `EdgeBasis`.
- Produces:
  ```ts
  export type RefFilter = 'any' | 'none' | EdgeBasis
  export type IndexFilter = 'lead' | 'any' | 'none'
  export interface ColumnSearch {
    q?: string
    type?: string[]
    ref?: RefFilter
    indexed?: IndexFilter
    nullable?: true
  }
  export function validateColumnSearch(search: Record<string, unknown>): ColumnSearch
  export function searchColumns(entries: readonly ColumnEntry[], search: ColumnSearch): ColumnEntry[]
  export function typesPresent(entries: readonly ColumnEntry[]): string[]
  export function isUnindexedReference(entry: ColumnEntry): boolean
  ```

- [ ] **Step 1: Write the failing tests** (append to `tests/lib/column-search.test.ts`)

```ts
import {
  isUnindexedReference,
  searchColumns,
  typesPresent,
  validateColumnSearch,
} from '#/lib/column-search'

describe('validateColumnSearch', () => {
  it('keeps what it understands', () => {
    expect(
      validateColumnSearch({ q: 'created', type: ['jsonb', 'uuid'], ref: 'declared', indexed: 'lead', nullable: true }),
    ).toEqual({ q: 'created', type: ['jsonb', 'uuid'], ref: 'declared', indexed: 'lead', nullable: true })
  })

  it('drops what a hand-edited URL got wrong instead of throwing', () => {
    expect(
      validateColumnSearch({ q: '', type: 'jsonb', ref: 'nope', indexed: 'banana', nullable: 'yes' }),
    ).toEqual({ type: ['jsonb'] })
    expect(validateColumnSearch({ type: [1, '', 'uuid'] })).toEqual({ type: ['uuid'] })
    expect(validateColumnSearch({ nullable: 'true' })).toEqual({ nullable: true })
  })
})

describe('searchColumns', () => {
  const facets = {
    columns: {
      [facetKey('orders', 'customer_id')]: { index: 'lead' as const, nullFrac: 0, nDistinctRaw: 40, comment: null },
      [facetKey('invoices', 'order_id')]: { index: null, nullFrac: 0.1, nDistinctRaw: -0.5, comment: null },
      [facetKey('customers', 'payload')]: { index: null, nullFrac: null, nDistinctRaw: null, comment: null },
    },
    analyzedAt: {},
  }
  const entries = buildColumnEntries(tables, graph, facets)
  const ids = (list: ReturnType<typeof searchColumns>) => list.map((e) => `${e.table}.${e.column}`)

  it('returns everything for an empty search', () => {
    expect(searchColumns(entries, {})).toHaveLength(9)
  })

  it('matches the name without the palette gate, best tier first, then by table', () => {
    expect(ids(searchColumns(entries, { q: 'id' }))).toEqual([
      'customers.id', 'invoices.id', 'orders.id',   // whole name
      'invoices.order_id', 'orders.customer_id',    // word start, tables alphabetical
    ])
  })

  it('filters by type set', () => {
    expect(ids(searchColumns(entries, { type: ['jsonb'] }))).toEqual(['customers.payload'])
  })

  it('filters by reference presence and basis', () => {
    expect(ids(searchColumns(entries, { ref: 'any' }))).toEqual(['invoices.order_id', 'orders.customer_id'])
    expect(ids(searchColumns(entries, { ref: 'model' }))).toEqual(['invoices.order_id'])
    expect(searchColumns(entries, { ref: 'none' })).toHaveLength(7)
  })

  it('filters by index, and treats missing facets as unknown rather than unindexed', () => {
    expect(ids(searchColumns(entries, { indexed: 'lead' }))).toEqual(['orders.customer_id'])
    // Only columns the facets actually said are in no index.
    expect(ids(searchColumns(entries, { indexed: 'none' }))).toEqual(['customers.payload', 'invoices.order_id'])
  })

  it('filters to nullable columns', () => {
    expect(ids(searchColumns(entries, { nullable: true }))).toEqual(['customers.payload', 'invoices.order_id'])
  })

  it('lists the types that are present, once each, sorted', () => {
    expect(typesPresent(entries)).toEqual(['jsonb', 'timestamp with time zone', 'uuid'])
  })

  it('flags a reference column no index leads', () => {
    expect(isUnindexedReference(entries.find((e) => e.column === 'order_id')!)).toBe(true)
    expect(isUnindexedReference(entries.find((e) => e.column === 'customer_id')!)).toBe(false)
    // No facets: unknown, not flagged.
    expect(isUnindexedReference(buildColumnEntries(tables, graph, undefined).find((e) => e.column === 'order_id')!)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/column-search.test.ts`
Expected: FAIL, `validateColumnSearch is not a function` (and the others).

- [ ] **Step 3: Implement** (append to `src/lib/column-search.ts`, and add `matchRank` to the existing import from `#/lib/palette/table-matches`)

```ts
export type RefFilter = 'any' | 'none' | EdgeBasis
export type IndexFilter = 'lead' | 'any' | 'none'

/**
 * The survey page's URL state. Every filter lives here so a finding ("these are
 * the unindexed reference columns") is a link someone else can open.
 */
export interface ColumnSearch {
  q?: string
  type?: string[]
  ref?: RefFilter
  indexed?: IndexFilter
  nullable?: true
}

const REF_FILTERS = new Set<string>(['any', 'none', 'declared', 'model', 'convention', 'catalog'])
const INDEX_FILTERS = new Set<string>(['lead', 'any', 'none'])

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read the search params, dropping whatever doesn't parse. A hand-edited URL
 * should land on a wider list, never on an error page or an empty one.
 */
export function validateColumnSearch(search: Record<string, unknown>): ColumnSearch {
  const result: ColumnSearch = {}
  const q = nonEmptyText(search.q)
  if (q) result.q = q

  const rawTypes = Array.isArray(search.type) ? search.type : [search.type]
  const types = rawTypes.filter((t): t is string => typeof t === 'string' && t.length > 0)
  if (types.length > 0) result.type = types

  if (typeof search.ref === 'string' && REF_FILTERS.has(search.ref)) result.ref = search.ref as RefFilter
  if (typeof search.indexed === 'string' && INDEX_FILTERS.has(search.indexed)) {
    result.indexed = search.indexed as IndexFilter
  }
  if (search.nullable === true || search.nullable === 'true') result.nullable = true
  return result
}

function matchesRef(entry: ColumnEntry, ref: RefFilter): boolean {
  if (ref === 'any') return entry.reference !== null
  if (ref === 'none') return entry.reference === null
  return entry.reference?.basis === ref
}

/**
 * Only a facet that was read can say "in no index". Missing facets mean the
 * read failed or hasn't landed, and those rows are left out of `none` rather
 * than claimed as unindexed.
 */
function matchesIndex(entry: ColumnEntry, indexed: IndexFilter): boolean {
  if (!entry.facet) return false
  if (indexed === 'lead') return entry.facet.index === 'lead'
  if (indexed === 'any') return entry.facet.index !== null
  return entry.facet.index === null
}

/**
 * The survey list. No confidence gate: this page exists to show every match.
 * But it keeps the tiers, so whole-name hits sit above a word inside a longer
 * name. Inside a tier, entries keep the table-then-column order
 * {@link buildColumnEntries} gave them.
 */
export function searchColumns(entries: readonly ColumnEntry[], search: ColumnSearch): ColumnEntry[] {
  const types = search.type ? new Set(search.type) : null
  const q = search.q?.trim() ?? ''

  const ranked: { entry: ColumnEntry; rank: number; order: number }[] = []
  entries.forEach((entry, order) => {
    if (types && !types.has(entry.dataType)) return
    if (search.ref && !matchesRef(entry, search.ref)) return
    if (search.indexed && !matchesIndex(entry, search.indexed)) return
    if (search.nullable && !entry.isNullable) return
    const rank = q.length === 0 ? 0 : matchRank(entry.column, q)
    if (rank === null) return
    ranked.push({ entry, rank, order })
  })

  return ranked
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((hit) => hit.entry)
}

/** The type chips: only types this schema actually uses. */
export function typesPresent(entries: readonly ColumnEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.dataType))].sort((a, b) => a.localeCompare(b))
}

/**
 * A reference column that no index leads. Following that relation from the
 * referenced side reads the whole table. Unknown facets are not flagged: this
 * is a claim about the schema, and it's only made when the catalog said so.
 */
export function isUnindexedReference(entry: ColumnEntry): boolean {
  return entry.reference !== null && entry.facet !== null && entry.facet.index !== 'lead'
}
```

> `isUnindexedReference` uses `!== 'lead'`. A `member` index (the column is second in a composite index) can't serve a lookup on that column alone, so it still counts as unindexed for following the reference. The test above expects `order_id` (index `null`) flagged and `customer_id` (index `lead`) not.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/column-search.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/column-search.ts tests/lib/column-search.test.ts
git commit -m "feat(columns): filter, rank and URL-encode the column survey"
```

---

### Task 3: Server facets read

**Files:**
- Create: `src/server/column-facets.ts`
- Modify: `src/server/api.ts` (import next to `getSchemaAnatomy`, export after `$getSchemaAnatomy`)
- Test: `tests/server/column-facets.test.ts`

**Interfaces:**
- Consumes: `query` from `#/server/db`, `ColumnFacets`, `facetKey` from `#/lib/column-search`.
- Produces: `getColumnFacets(schema?: string): Promise<ColumnFacets>`, `$getColumnFacets({ database, schema })`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/column-facets.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('#/server/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

const { getColumnFacets } = await import('#/server/column-facets')

function answer(routes: Array<[string, unknown[]]>) {
  mockQuery.mockImplementation(async (sql: string) => {
    for (const [fragment, rows] of routes) if (sql.includes(fragment)) return { rows }
    return { rows: [] }
  })
}

beforeEach(() => mockQuery.mockReset())

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

    expect(facets.columns['orders.customer_id']).toEqual({ index: 'lead', nullFrac: 0, nDistinctRaw: 40, comment: null })
    expect(facets.columns['orders.status']).toEqual({ index: 'member', nullFrac: 0.25, nDistinctRaw: 3, comment: 'lifecycle' })
    // Never analyzed: unknown, not zero.
    expect(facets.columns['orders.notes']).toEqual({ index: null, nullFrac: null, nDistinctRaw: null, comment: null })
    expect(facets.analyzedAt).toEqual({ orders: '2026-09-01T10:00:00.000Z' })
  })

  it('passes the schema as a parameter, never in the SQL text', async () => {
    answer([])
    await getColumnFacets('weird"schema')
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/column-facets.test.ts`
Expected: FAIL, cannot resolve `#/server/column-facets`.

- [ ] **Step 3: Implement**

```ts
// src/server/column-facets.ts
import { query } from '#/server/db'
import { facetKey } from '#/lib/column-search'
import type { ColumnFacet, ColumnFacets } from '#/lib/column-search'

/**
 * What the catalog knows about every column in a schema, in two reads: index
 * position, planner statistics and comments per column, then when each table
 * was last analyzed.
 *
 * Nothing here touches table data. `pg_stats` is the summary ANALYZE already
 * wrote, so the survey page costs the same on a billion rows as on none. A
 * column with no statistics row comes back with `null`s. The page says "never
 * analyzed" instead of printing a zero the planner never measured.
 */
export async function getColumnFacets(schema: string = 'public'): Promise<ColumnFacets> {
  const [columnsResult, analyzedResult] = await Promise.all([
    query(
      `
      SELECT
        c.relname::text                          AS table,
        a.attname::text                          AS column,
        EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum
        )                                        AS leads_index,
        EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.oid AND a.attnum = ANY (i.indkey::int2[])
        )                                        AS in_index,
        s.null_frac,
        s.n_distinct,
        col_description(a.attrelid, a.attnum)    AS comment
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stats s
        ON s.schemaname = n.nspname
        AND s.tablename = c.relname
        AND s.attname = a.attname
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND a.attnum > 0
        AND NOT a.attisdropped
    `,
      [schema],
    ),
    query(
      `
      SELECT relname::text AS table,
             GREATEST(last_analyze, last_autoanalyze) AS last_analyze
      FROM pg_stat_user_tables
      WHERE schemaname = $1
    `,
      [schema],
    ),
  ])

  const columns: Record<string, ColumnFacet> = {}
  for (const row of columnsResult.rows as Array<Record<string, unknown>>) {
    columns[facetKey(String(row.table), String(row.column))] = {
      index: row.leads_index ? 'lead' : row.in_index ? 'member' : null,
      nullFrac: row.null_frac === null || row.null_frac === undefined ? null : Number(row.null_frac),
      nDistinctRaw:
        row.n_distinct === null || row.n_distinct === undefined ? null : Number(row.n_distinct),
      comment: typeof row.comment === 'string' ? row.comment : null,
    }
  }

  const analyzedAt: Record<string, string | null> = {}
  for (const row of analyzedResult.rows as Array<{ table: string; last_analyze: Date | string | null }>) {
    analyzedAt[row.table] = row.last_analyze ? new Date(row.last_analyze).toISOString() : null
  }

  return { columns, analyzedAt }
}
```

In `src/server/api.ts`, add `import { getColumnFacets } from '#/server/column-facets'` beside the other server imports. Add this after `$getSchemaAnatomy`:

```ts
/**
 * The column survey's one extra read: index position, planner statistics and
 * comments for every column in the schema. Name, type and references are
 * already on the client from introspection and the graph.
 */
export const $getColumnFacets = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema?: string }) => data)
  .handler(scoped((data) => getColumnFacets(data.schema)))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/column-facets.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Try the SQL once against a real database**

Start the dev server if it isn't running (`npm run dev`), connect to a local database, and run the first statement from `getColumnFacets` in the SQL console with `$1` replaced by `'public'`. Check that it returns one row per column and takes well under a second. The console runs read-only, so this is safe.

- [ ] **Step 6: Commit**

```bash
git add src/server/column-facets.ts src/server/api.ts tests/server/column-facets.test.ts
git commit -m "feat(columns): read index position, stats and comments per column"
```

---

### Task 4: `useColumnIndex` hook

**Files:**
- Create: `src/hooks/useColumnIndex.ts`

**Interfaces:**
- Consumes:
  - `$introspect`, `$getSchemaGraph`, `$getColumnFacets` from `#/server/api`;
  - `buildColumnEntries` and its types;
  - `useConnectionState` from `#/hooks/useConnectionStatus`.
- Produces:
  ```ts
  export interface ColumnIndex {
    entries: ColumnEntry[] | null          // null until introspection lands
    graphLoading: boolean                   // References column shows a skeleton while true
    facetsError: string | null              // shown once above the table
    facetsLoading: boolean
    analyzedAt: Record<string, string | null>
  }
  export function useColumnIndex(database: string | undefined, schema: string | undefined): ColumnIndex
  ```

The query keys match the existing caches exactly: `['introspect', database, schema]` (sidebar, palette, console) and `['schemaGraph', database, schema]` (lens). That way opening the page after either costs no extra reads.

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useColumnIndex.ts
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnectionState } from '#/hooks/useConnectionStatus'
import { buildColumnEntries } from '#/lib/column-search'
import type { ColumnEntry } from '#/lib/column-search'
import { $getColumnFacets, $getSchemaGraph, $introspect } from '#/server/api'

export interface ColumnIndex {
  /** Null until introspection lands. Half a column list reads as a complete one. */
  entries: ColumnEntry[] | null
  /** While true, references are unknown, not absent. */
  graphLoading: boolean
  facetsLoading: boolean
  /** Why the facets aren't there. Names, types and references still render. */
  facetsError: string | null
  analyzedAt: Record<string, string | null>
}

/**
 * Every column in a schema, with what each references and what the catalog
 * knows about it.
 *
 * Three fetches, and two of them are usually cache hits: introspection is keyed
 * the way the sidebar keys it, and the graph the way the lens does. Each piece
 * joins as it arrives rather than holding the page until the slowest one lands.
 */
export function useColumnIndex(
  database: string | undefined,
  schema: string | undefined,
): ColumnIndex {
  const enabled = useConnectionState() === 'connected' && Boolean(database) && Boolean(schema)

  const introspection = useQuery({
    queryKey: ['introspect', database, schema],
    queryFn: () => $introspect({ data: { database: database!, schema } }),
    enabled,
    staleTime: Infinity,
  })
  const graph = useQuery({
    queryKey: ['schemaGraph', database, schema],
    queryFn: () => $getSchemaGraph({ data: { database: database!, schema } }),
    enabled,
    staleTime: Infinity,
  })
  const facets = useQuery({
    queryKey: ['columnFacets', database, schema],
    queryFn: () => $getColumnFacets({ data: { database: database!, schema } }),
    enabled,
    // Statistics move when ANALYZE runs, not while someone reads the page.
    staleTime: 5 * 60_000,
  })

  const entries = useMemo(
    () =>
      introspection.data
        ? buildColumnEntries(introspection.data.tables, graph.data, facets.data)
        : null,
    [introspection.data, graph.data, facets.data],
  )

  return {
    entries,
    graphLoading: graph.isLoading,
    facetsLoading: facets.isLoading,
    facetsError: facets.isError ? (facets.error as Error).message : null,
    analyzedAt: facets.data?.analyzedAt ?? {},
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no new errors in `src/hooks/useColumnIndex.ts`. If the project has existing errors, compare against `git stash`-free baseline output by grepping for the new file name only.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useColumnIndex.ts
git commit -m "feat(columns): hook joining introspection, graph and facets"
```

---

### Task 5: Survey page, filters, and menu entry

**Files:**
- Create: `src/routes/d/$database/columns/$schema.tsx`
- Create: `src/components/columns/ColumnFilters.tsx`
- Create: `src/components/columns/ColumnTable.tsx`
- Modify: `src/lib/menu-routes.ts` (`DATABASE_ROUTES`)
- Modify: `src/components/Header.tsx` (menu item after *Find a value*)
- Test: `tests/lib/menu-routes.test.ts` (add a case; create the file if it doesn't exist)

**Interfaces:**
- Consumes:
  - `useColumnIndex`;
  - `searchColumns`, `typesPresent`, `validateColumnSearch`, `isUnindexedReference`, and the `ColumnSearch` / `ColumnEntry` types;
  - `estimateDistinct`, `formatPercent` from `#/lib/inspect/stats`;
  - `formatRelativeTime` from `#/lib/inspect/format`;
  - `BasisTag` from `#/components/lens/BasisTag`, `TableName` from `#/components/TableName`;
  - `encodeConditions` from `#/lib/filter-model`.
- Produces: route `/d/$database/columns/$schema` with `validateSearch: validateColumnSearch`.

Before writing, open `src/components/lens/BasisTag.tsx` and `src/components/TableName.tsx` to confirm their prop names. Adjust the JSX below if they differ, and don't change those components.

- [ ] **Step 1: Write the failing menu test**

```ts
// tests/lib/menu-routes.test.ts  (add to existing describe, or create)
import { describe, expect, it } from 'vitest'
import { menuHoldsRoute } from '#/lib/menu-routes'

describe('menuHoldsRoute', () => {
  it('holds the column survey', () => {
    expect(menuHoldsRoute('/d/shop_db/columns/public')).toBe(true)
    expect(menuHoldsRoute('/d/shop_db/columnsx/public')).toBe(false)
  })
})
```

Run: `npx vitest run tests/lib/menu-routes.test.ts`
Expected: FAIL on the first expectation.

- [ ] **Step 2: Add the route to the menu list**

In `src/lib/menu-routes.ts`:

```ts
const DATABASE_ROUTES = ['/queries', '/pressure', '/indexes', '/find', '/columns'] as const
```

Run: `npx vitest run tests/lib/menu-routes.test.ts`
Expected: PASS.

- [ ] **Step 3: Write `ColumnFilters`**

```tsx
// src/components/columns/ColumnFilters.tsx
import type { ColumnSearch, IndexFilter, RefFilter } from '#/lib/column-search'

/**
 * The survey's controls. Every one writes to the URL through `onChange`, so the
 * page holds no filter state of its own.
 */
export default function ColumnFilters({
  search,
  types,
  onChange,
}: {
  search: ColumnSearch
  /** Types present in the schema, for the chips. */
  types: string[]
  onChange: (next: ColumnSearch) => void
}) {
  const selected = new Set(search.type ?? [])
  const toggleType = (type: string) => {
    const next = new Set(selected)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    onChange({ ...search, type: next.size > 0 ? [...next] : undefined })
  }

  return (
    <div className="space-y-2">
      <input
        type="search"
        autoFocus
        value={search.q ?? ''}
        onChange={(e) => onChange({ ...search, q: e.target.value || undefined })}
        placeholder="Column name…"
        className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
      />

      <div className="flex flex-wrap gap-1">
        {types.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={selected.has(type)}
            onClick={() => toggleType(type)}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
              selected.has(type)
                ? 'border-[var(--lagoon)] text-[var(--lagoon-deep)]'
                : 'border-[var(--line)] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)]/60'
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--sea-ink-soft)]">
        <label className="flex items-center gap-1">
          References
          <select
            value={search.ref ?? ''}
            onChange={(e) => onChange({ ...search, ref: (e.target.value || undefined) as RefFilter | undefined })}
            className="rounded border border-[var(--line)] bg-transparent px-1 py-0.5"
          >
            <option value="">—</option>
            <option value="any">any</option>
            <option value="none">none</option>
            <option value="declared">declared FK</option>
            <option value="model">model</option>
            <option value="convention">convention</option>
            <option value="catalog">catalog</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          Indexed
          <select
            value={search.indexed ?? ''}
            onChange={(e) => onChange({ ...search, indexed: (e.target.value || undefined) as IndexFilter | undefined })}
            className="rounded border border-[var(--line)] bg-transparent px-1 py-0.5"
          >
            <option value="">—</option>
            <option value="lead">leads an index</option>
            <option value="any">in any index</option>
            <option value="none">in no index</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={search.nullable === true}
            onChange={(e) => onChange({ ...search, nullable: e.target.checked ? true : undefined })}
          />
          nullable only
        </label>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write `ColumnTable`**

```tsx
// src/components/columns/ColumnTable.tsx
import { Link } from '@tanstack/react-router'
import BasisTag from '#/components/lens/BasisTag'
import TableName from '#/components/TableName'
import { isUnindexedReference } from '#/lib/column-search'
import type { ColumnEntry } from '#/lib/column-search'
import { encodeConditions } from '#/lib/filter-model'
import { estimateDistinct, formatPercent } from '#/lib/inspect/stats'

/** Rendered rows past this ask for a narrower search instead of a longer page. */
export const MAX_ROWS = 1000

/**
 * One row per column. Every table name links to the table, and the column name
 * links to that table filtered to rows where the column is set. That's the
 * question that usually follows "which table has this".
 */
export default function ColumnTable({
  database,
  schema,
  entries,
  graphLoading,
}: {
  database: string
  schema: string
  entries: ColumnEntry[]
  graphLoading: boolean
}) {
  const shown = entries.slice(0, MAX_ROWS)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12px]">
        <thead className="text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
          <tr>
            <th className="py-1 pr-3">Column</th>
            <th className="py-1 pr-3">Table</th>
            <th className="py-1 pr-3">Type</th>
            <th className="py-1 pr-3">Null?</th>
            <th className="py-1 pr-3">References</th>
            <th className="py-1 pr-3">Indexed</th>
            <th className="py-1 pr-3 text-right">Null %</th>
            <th className="py-1 pr-3 text-right">Distinct</th>
            <th className="py-1">Comment</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((entry) => (
            <ColumnRow key={`${entry.table}.${entry.column}`} database={database} schema={schema} entry={entry} graphLoading={graphLoading} />
          ))}
        </tbody>
      </table>
      {entries.length > MAX_ROWS && (
        <p className="mt-2 text-[11px] text-[var(--sea-ink-soft)]">
          Showing {MAX_ROWS.toLocaleString('en-US')} of {entries.length.toLocaleString('en-US')} — narrow the search to see the rest.
        </p>
      )}
    </div>
  )
}

function ColumnRow({
  database,
  schema,
  entry,
  graphLoading,
}: {
  database: string
  schema: string
  entry: ColumnEntry
  graphLoading: boolean
}) {
  const facet = entry.facet
  const distinct =
    facet?.nDistinctRaw === null || facet?.nDistinctRaw === undefined
      ? null
      : estimateDistinct(facet.nDistinctRaw, entry.rowCount ?? -1)
  const unindexed = isUnindexedReference(entry)

  return (
    <tr className="border-t border-[var(--line)] align-top">
      <td className="py-1 pr-3 font-mono">
        <Link
          to="/d/$database/t/$schema/$table"
          params={{ database, schema, table: entry.table }}
          search={{
            q: encodeConditions([
              { id: `columns-${entry.column}`, column: entry.column, op: 'notNull', values: [] },
            ]),
          }}
          className="text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
        >
          {entry.column}
        </Link>
      </td>
      <td className="py-1 pr-3">
        <Link
          to="/d/$database/t/$schema/$table"
          params={{ database, schema, table: entry.table }}
          search={{}}
          className="hover:text-[var(--lagoon-deep)]"
        >
          <TableName name={entry.table} />
        </Link>
        {entry.group && <span className="ml-1 text-[10px] text-[var(--sea-ink-soft)]">{entry.group}</span>}
      </td>
      <td className="py-1 pr-3 font-mono text-[11px] text-[var(--sea-ink-soft)]">{entry.dataType}</td>
      <td className="py-1 pr-3">{entry.isNullable ? 'yes' : ''}</td>
      <td className="py-1 pr-3">
        {graphLoading ? (
          <span className="inline-block h-3 w-20 animate-pulse rounded bg-[var(--line)]" />
        ) : entry.reference ? (
          <span className="inline-flex items-center gap-1">
            <span className="font-mono text-[11px]">
              {entry.reference.toTable}.{entry.reference.toColumn}
            </span>
            <BasisTag basis={entry.reference.basis} />
          </span>
        ) : null}
      </td>
      <td className="py-1 pr-3">
        {facet === null ? (
          <span className="text-[var(--sea-ink-soft)]">—</span>
        ) : facet.index === 'lead' ? (
          'leads'
        ) : facet.index === 'member' ? (
          <span title="Appears after the first column of an index — cannot serve a lookup on this column alone">in</span>
        ) : unindexed ? (
          <span
            className="text-[var(--destructive)]"
            title="References another table but no index leads with it — following the relation from the other side reads this whole table"
          >
            none ⚠
          </span>
        ) : (
          <span className="text-[var(--sea-ink-soft)]">none</span>
        )}
      </td>
      <td className="py-1 pr-3 text-right tabular-nums">
        {facet?.nullFrac === null || facet?.nullFrac === undefined ? (
          <span className="text-[var(--sea-ink-soft)]" title="Never analyzed — no statistics for this column">—</span>
        ) : (
          formatPercent(facet.nullFrac)
        )}
      </td>
      <td className="py-1 pr-3 text-right tabular-nums">
        {distinct === null || distinct.count === null ? (
          <span className="text-[var(--sea-ink-soft)]">—</span>
        ) : distinct.kind === 'unique' ? (
          'unique'
        ) : (
          `~${distinct.count.toLocaleString('en-US')}`
        )}
      </td>
      <td className="py-1 text-[11px] text-[var(--sea-ink-soft)]">{facet?.comment ?? ''}</td>
    </tr>
  )
}
```

- [ ] **Step 5: Write the route**

```tsx
// src/routes/d/$database/columns/$schema.tsx
import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import ColumnFilters from '#/components/columns/ColumnFilters'
import ColumnTable from '#/components/columns/ColumnTable'
import { useColumnIndex } from '#/hooks/useColumnIndex'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { searchColumns, typesPresent, validateColumnSearch } from '#/lib/column-search'
import type { ColumnSearch } from '#/lib/column-search'
import { formatRelativeTime } from '#/lib/inspect/format'

export const Route = createFileRoute('/d/$database/columns/$schema')({
  component: ColumnsPage,
  validateSearch: validateColumnSearch,
})

/**
 * Columns, searched across the whole schema.
 *
 * The page for "which tables have `project_id`" and "every `jsonb` column here".
 * Name, type and references come from reads the app already cached. Index
 * position, null share and comments come from one catalog read. Nothing reads a
 * table, and every filter is in the URL.
 */
function ColumnsPage() {
  const database = useDatabaseParam()
  const { schema } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { isChecking, isConnected } = useConnectionGuard()
  const index = useColumnIndex(database, schema)

  const types = useMemo(() => (index.entries ? typesPresent(index.entries) : []), [index.entries])
  const results = useMemo(
    () => (index.entries ? searchColumns(index.entries, search) : []),
    [index.entries, search],
  )
  // The oldest analyze among the tables shown is the one that bounds how fresh
  // any number on screen can be.
  const oldestAnalyze = useMemo(() => {
    const times = [...new Set(results.map((e) => e.table))].map((t) => index.analyzedAt[t] ?? null)
    if (times.length === 0) return undefined
    if (times.some((t) => t === null)) return null
    return times.sort()[0]
  }, [results, index.analyzedAt])

  if (isChecking) {
    return <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">Checking connection...</div>
  }
  if (!isConnected) return null

  const update = (next: ColumnSearch) => navigate({ search: next, replace: true })

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="mx-auto max-w-6xl space-y-3">
        <header className="space-y-1">
          <p className="island-kicker">Columns · {schema}</p>
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">Which table has this column?</h1>
        </header>

        <ColumnFilters search={search} types={types} onChange={update} />

        {index.facetsError && (
          <p className="text-[11px] text-[var(--destructive)]">
            Index, statistics and comments are unavailable: {index.facetsError}
          </p>
        )}

        {oldestAnalyze !== undefined && !index.facetsLoading && !index.facetsError && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            {oldestAnalyze === null
              ? 'Some of these tables have never been analyzed — their null share and distinct counts show as —.'
              : `Statistics from the last ANALYZE; the oldest shown is ${formatRelativeTime(oldestAnalyze, Date.now())}.`}
          </p>
        )}

        {index.entries === null ? (
          <p className="text-sm text-[var(--sea-ink-soft)]">Reading the schema…</p>
        ) : (
          <>
            <p className="text-[11px] text-[var(--sea-ink-soft)]">
              {results.length.toLocaleString('en-US')} of {index.entries.length.toLocaleString('en-US')} columns
            </p>
            <ColumnTable database={database} schema={schema} entries={results} graphLoading={index.graphLoading} />
          </>
        )}
      </div>
    </main>
  )
}
```

Check `formatRelativeTime`'s output reads naturally after "the oldest shown is" (e.g. "3 days ago"). If it returns a bare "3d", rephrase the sentence to "…; the oldest shown is from 3d ago" so it reads right. Don't change the helper.

- [ ] **Step 6: Add the menu item** in `src/components/Header.tsx`, directly after the *Find a value* `Link` block:

```tsx
          {database && schema && (
            <Link
              to="/d/$database/columns/$schema"
              params={{ database, schema }}
              // Filters live in the search params; a bare link starts with none.
              search={{}}
              role="menuitem"
              className={MENU_ITEM_CLASS}
              activeProps={{ className: MENU_ITEM_ACTIVE_CLASS }}
            >
              Columns
              <span className={MENU_HINT_CLASS}>
                Which table has a column — by name, type, reference or index
              </span>
            </Link>
          )}
```

- [ ] **Step 7: Regenerate the route tree and typecheck**

Run: `npm run build` (TanStack's Vite plugin regenerates `routeTree.gen.ts`), then `npx tsc --noEmit -p .`
Expected: the build succeeds, and there are no type errors in the new files.

- [ ] **Step 8: Check it in the browser**

`npm run dev`, connect, and open `/d/<db>/columns/public`. Check:
- typing `id` narrows the list, and the URL `q` updates without adding history entries;
- a type chip filters the list;
- a jsonb column's `Null %` renders;
- a column with `—` has the "never analyzed" tooltip;
- clicking a column name opens the table with a `notNull` filter in its filter panel.

- [ ] **Step 9: Commit**

```bash
git add src/routes/d/\$database/columns src/components/columns src/lib/menu-routes.ts src/components/Header.tsx tests/lib/menu-routes.test.ts src/routeTree.gen.ts
git commit -m "feat(columns): survey page for columns across a schema"
```

(Only add `src/routeTree.gen.ts` if it's tracked. Check with `git ls-files src/routeTree.gen.ts`.)

---

### Task 6: Palette — column hits, Columns page, `⇥` filter, *All matches*

**Files:**
- Modify: `src/lib/palette/views.ts`
- Modify: `src/lib/palette/actions.ts`
- Modify: `src/components/palette/Palette.tsx`
- Test: `tests/lib/palette-actions.test.ts`, plus the palette views test if one exists (`ls tests/lib | grep palette`)

**Interfaces:**
- Consumes:
  - `buildColumnEntries`, `confidentColumnMatches`, `searchColumns` from `#/lib/column-search`;
  - `encodeConditions` from `#/lib/filter-model`.
- Produces:
  - `PaletteView` gains `{ kind: 'columns' }`;
  - `PaletteRoute` gains `'columns'`;
  - root action id `columns`.

- [ ] **Step 1: Write the failing tests** (append to `tests/lib/palette-actions.test.ts`)

```ts
import { viewCrumb, viewPlaceholder, viewSubmits } from '#/lib/palette/views'

describe('columns', () => {
  it('offers a Columns page when a schema is known', () => {
    const action = rootActions(scoped).find((a) => a.id === 'columns')
    expect(action?.target).toEqual({ kind: 'push', view: { kind: 'columns' } })
  })

  it('does not offer it without a schema', () => {
    expect(rootActions({ database: 'shop_db' }).map((a) => a.id)).not.toContain('columns')
  })

  it('names the page and its box', () => {
    expect(viewCrumb({ kind: 'columns' })).toEqual({ label: 'Columns' })
    expect(viewPlaceholder({ kind: 'columns' })).toBe('Column name…')
    expect(viewSubmits({ kind: 'columns' })).toBe(false)
  })
})
```

Run: `npx vitest run tests/lib/palette-actions.test.ts`
Expected: FAIL. `columns` isn't found, and a TypeScript/vitest error on the unknown view kind.

- [ ] **Step 2: Add the view** in `src/lib/palette/views.ts`:
  - Add `| { kind: 'columns' }` to `PaletteView`, with the doc line `/** Every column in the schema, by name — which table has it. */`.
  - In `viewCrumb`, add `case 'columns': return { label: 'Columns' }`.
  - In `viewPlaceholder`, add `case 'columns': return 'Column name…'`.

- [ ] **Step 3: Add the action and route** in `src/lib/palette/actions.ts`:
  - Add `| 'columns'` to `PaletteRoute`.
  - Inside the `if (scoped && context.schema)` block, before `lens`, push:

```ts
    actions.push({
      id: 'columns',
      title: 'Find a column',
      hint: 'Which table has a column — by name, across the schema',
      group: 'Navigate',
      target: { kind: 'push', view: { kind: 'columns' } },
      keywords: ['column', 'field', 'attribute', 'which table'],
    })
```

Run: `npx vitest run tests/lib/palette-actions.test.ts`
Expected: PASS. If an existing test asserts the exact id list for a scoped context, add `'columns'` in its position. It's the same list, one entry longer.

- [ ] **Step 4: Wire the palette component** in `src/components/palette/Palette.tsx`:

  1. **Imports:** `buildColumnEntries`, `confidentColumnMatches`, `searchColumns`, the `ColumnEntry` type, and `encodeConditions`.
  2. **`tablesQuery.enabled`:** add `view.kind === 'columns'` to the list of views that need introspection.
  3. **`routeDestination`:** add a case:

```ts
        case 'columns':
          return database && schema
            ? destination({
                to: '/d/$database/columns/$schema',
                params: { database, schema },
                search: {},
              })
            : null
```

  4. **Entries and the row builder.** Add these after `columnsOf`. The palette needs no graph and no facets, just names:

```ts
  /** Every column in the schema, for column hits. Introspection only — the
   *  palette offers where a column is, not what the catalog says about it. */
  const columnEntries = useMemo(
    () => (tablesQuery.data ? buildColumnEntries(tablesQuery.data.tables, undefined, undefined) : []),
    [tablesQuery.data],
  )

  /**
   * One column somewhere in the schema, as a row: `↵` opens its table, `⇥` opens
   * it filtered to rows where the column is set — "show me the rows that use it"
   * is the usual next question once you've found which table has it.
   */
  const columnRow = useCallback(
    (entry: ColumnEntry, group: string): PaletteRowModel => {
      const open =
        database && schema
          ? destination({
              to: '/d/$database/t/$schema/$table',
              params: { database, schema, table: entry.table },
              search: {},
            })
          : null
      const set =
        database && schema
          ? destination({
              to: '/d/$database/t/$schema/$table',
              params: { database, schema, table: entry.table },
              search: {
                q: encodeConditions([
                  { id: `palette-${entry.column}`, column: entry.column, op: 'notNull', values: [] },
                ]),
              },
            })
          : null
      return {
        id: `column:${entry.table}.${entry.column}`,
        title: `${nameOf(entry.table)}.${entry.column}`,
        table: entry.table,
        column: entry.column,
        meta: entry.dataType,
        group,
        href: open?.href,
        run: () => {
          close()
          open?.go()
        },
        runAlt: () => {
          close()
          set?.go()
        },
        altLabel: 'where set',
      }
    },
    [close, database, destination, nameOf, schema],
  )

  /** The last row of any column list: the same query on the survey page. */
  const allColumnsRow = useCallback(
    (count: number, q: string): PaletteRowModel | null => {
      if (!database || !schema || count === 0) return null
      const to = destination({
        to: '/d/$database/columns/$schema',
        params: { database, schema },
        search: q.trim() ? { q: q.trim() } : {},
      })
      return {
        id: 'columns:all',
        title: `All ${count.toLocaleString('en-US')} matching columns →`,
        hint: 'With type, references, index and statistics',
        group: 'Columns',
        href: to.href,
        run: () => {
          close()
          to.go()
        },
      }
    },
    [close, database, destination, schema],
  )
```

  5. **Root (`case 'actions'`).** After the `columns` const (active-table filter rows), add:

```ts
        // Columns anywhere in the schema — the same gate a table name passes —
        // minus the table on screen, whose columns are already offered above as
        // filters.
        const elsewhere = confidentColumnMatches(columnEntries, query, {
          excludeTable: activeTable,
        }).map((entry) => columnRow(entry, 'Columns'))
        const allHits = elsewhere.length > 0 ? searchColumns(columnEntries, { q: query }).length : 0
        const more = allHits > elsewhere.length ? allColumnsRow(allHits, query) : null
```

  Change the return to:

```ts
        return [...pasted, ...tables, ...columns, ...elsewhere, ...(more ? [more] : []), ...rest]
```

  6. **Columns page.** Add a case before `case 'find'`:

```ts
      case 'columns': {
        const matched =
          query.trim().length === 0 ? columnEntries : searchColumns(columnEntries, { q: query })
        const rows = matched.slice(0, 60).map((entry) => columnRow(entry, 'Columns'))
        const all = matched.length > 60 ? allColumnsRow(matched.length, query) : null
        return all ? [...rows, all] : rows
      }
```

  7. **Dependencies:** add `columnEntries`, `columnRow` and `allColumnsRow` to the `rows` `useMemo` dependency array.

- [ ] **Step 5: Typecheck and run the palette tests**

Run: `npx tsc --noEmit -p . && npx vitest run tests/lib/palette-actions.test.ts tests/lib/palette-table-matches.test.ts`
Expected: no new type errors, tests PASS. If `tsc` flags an exhaustive `switch` on `PaletteView` somewhere else (`grep -rn "view.kind" src`), add the `columns` case there using the same wording.

- [ ] **Step 6: Check it in the browser.** `⌘K` on a table page:
  - Type a column that exists in other tables. Hits appear under *Columns*, and none come from the current table (those are under *Filter by column*).
  - `⇥` on a hit opens that table with a `notNull` filter.
  - *All N matching columns →* opens the survey with `q` set.
  - *Find a column* pushes the page, which lists everything when the box is empty.

- [ ] **Step 7: Commit**

```bash
git add src/lib/palette/views.ts src/lib/palette/actions.ts src/components/palette/Palette.tsx tests/lib/palette-actions.test.ts
git commit -m "feat(palette): find a column across the schema"
```

---

### Task 7: Help topic

**Files:**
- Create: `src/lib/help/topics/column-search.ts`
- Create: `src/components/help/previews/ColumnSearchPreview.tsx`
- Modify: `src/lib/help/index.ts` (register after `schemaGraphTopic`, in *Schema shape*)
- Modify: `src/components/help/previews/index.ts` (`'column-search': ColumnSearchPreview`)
- Test: `tests/lib/help/registry.test.ts` already covers it (unique id, anchor present in source, steps build the SQL, mock step ids exist)

**Interfaces:**
- Consumes: `HelpTopic` from `#/lib/help/types`, and the `step="…"` marker convention used by the other previews.

Open `src/components/help/previews/ColumnProfilePreview.tsx` first and copy how it marks elements with `step="…"` and what wrapper component it uses.

- [ ] **Step 1: Write the topic**

```ts
// src/lib/help/topics/column-search.ts
import type { HelpTopic } from '#/lib/help/types'

export const columnSearchTopic: HelpTopic = {
  id: 'column-search',
  section: 'Schema shape',
  title: 'Column search',
  question: 'Which table has this column, and what do we know about it?',
  answer:
    'The column list and what each column references are already in the browser — the sidebar and the lens read them. The one extra question is what the catalog knows about each column: whether an index starts with it, how often it is null, roughly how many distinct values it holds, and any comment. All of that is stored summary, not data, so the page costs the same on a billion rows as on none.',
  route: '/columns/$schema',
  previewCaption: 'Columns matching a name across the schema. Hover a clause to see the column it fills.',
  source: {
    file: 'src/server/column-facets.ts',
    line: 20,
    anchor: 'WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum',
  },
  prerequisite:
    'Null share and distinct counts are only as fresh as the last `ANALYZE`. A table that was never analyzed has no statistics, and the page shows — rather than 0%.',
  steps: [
    {
      id: 'identity',
      clause: 'SELECT\n  c.relname AS table,\n  a.attname AS column,',
      title: 'Which column',
      detail:
        '`pg_attribute` has one row per column of every table; `pg_class` names the table it belongs to.',
    },
    {
      id: 'index',
      clause:
        '  EXISTS (SELECT 1 FROM pg_index i\n          WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum) AS leads_index,',
      title: 'Does an index start with it',
      detail:
        '`indkey` is the list of columns an index is built on, in order. Only the first one can answer "find rows where this column equals X" on its own — a column further along the list needs the ones before it too.',
    },
    {
      id: 'stats',
      clause: '  s.null_frac,\n  s.n_distinct,',
      title: 'What ANALYZE saw',
      detail:
        '`null_frac` is the share of sampled rows that were null. `n_distinct` is a count when positive, and a share of the row count when negative — `-1` means every row differs.',
    },
    {
      id: 'comment',
      clause: '  col_description(a.attrelid, a.attnum) AS comment',
      title: 'Anyone’s note',
      detail: 'The text of `COMMENT ON COLUMN`, if someone wrote one.',
    },
    {
      id: 'from',
      clause:
        'FROM pg_attribute a\nJOIN pg_class c ON c.oid = a.attrelid\nLEFT JOIN pg_stats s ON s.tablename = c.relname AND s.attname = a.attname',
      title: 'Catalog, not table',
      detail:
        'Every source here is a system catalog. `LEFT JOIN` keeps columns that have no statistics — those are the never-analyzed ones.',
    },
  ],
  terms: [
    { term: 'ANALYZE', meaning: 'The command that samples a table and stores a summary for the planner.' },
    { term: 'leading column', meaning: 'The first column an index is built on — the one it can look up by alone.' },
  ],
  cost: 'Reads system catalogs only: one row per column in the schema. Milliseconds, independent of table size.',
}
```

> The `anchor` must appear verbatim in `src/server/column-facets.ts`. It does: the Task 3 SQL has `WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum`. Set `line` to the actual line number after Task 3 (`grep -n "indkey\[0\]" src/server/column-facets.ts`).

- [ ] **Step 2: Write the preview.** Copy the structure of `ColumnProfilePreview.tsx` and mark elements with `step="identity" | "index" | "stats" | "comment"`: a small static three-row table with columns *Column*, *Table*, *Indexed*, *Null %*, *Comment*, and generic data (`orders.customer_id`, `invoices.customer_id`, `customers.id`). Use only step ids that exist in the topic. The registry test enforces this.

- [ ] **Step 3: Register both.** In `src/lib/help/index.ts`, import `columnSearchTopic` and place it after `schemaGraphTopic`. In `src/components/help/previews/index.ts`, import it and add `'column-search': ColumnSearchPreview`.

- [ ] **Step 4: Run the registry test**

Run: `npx vitest run tests/lib/help/registry.test.ts`
Expected: PASS, including `column-search still points at the statement it documents` and `marks the mocks with step ids that exist`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/help/topics/column-search.ts src/components/help/previews/ColumnSearchPreview.tsx src/lib/help/index.ts src/components/help/previews/index.ts
git commit -m "docs(help): explain the column search read"
```

---

### Task 8: Full verification

- [ ] **Step 1:** `npm test`. Expected: the whole suite passes. Report any failures with their output, don't paper over them.
- [ ] **Step 2:** `npx tsc --noEmit -p .`. Expected: no errors in files this plan touched.
- [ ] **Step 3:** `npm run build`. Expected: success.
- [ ] **Step 4:** README: add one *Features* bullet for **Column search** after *Find a value*, in the same voice. Say what it answers, that it's catalog-only, and that the palette reaches it.
- [ ] **Step 5:** Commit the README: `git commit -am "docs: column search in the feature list"`.
