# Index Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-schema page at `/d/$database/indexes/$schema` that says, for every index, what it costs, what access pattern the counters show it serving, what its shape unlocks, and whether its usage is rising or dead.

**Architecture:** One new server read (`src/server/index-usage.ts`) of catalog and statistics views; every judgement derived in pure, unit-tested functions under `src/lib/indexes/`; a master–detail page that renders those derivations. Cumulative counters are snapshotted into `local/` by `src/server/index-samples.ts` so "scans per day" means now, not since the last stats reset. Verdict rules are reused from the existing `src/lib/pressure/index-audit.ts` — they are not restated.

**Tech Stack:** TanStack Start (React 19 + server functions), TanStack Router, TanStack Query, TypeScript, Tailwind v4, `pg`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-index-inspector-design.md`

## Global Constraints

- **No `EXPLAIN`, no `PREPARE`, no query planning** anywhere in this feature.
- **No query→index attribution.** No SQL parsing, no new parser dependency.
- **No `DROP INDEX` text is ever rendered or copied.** The UI states what dropping would take with it, in prose. `CREATE INDEX` for a missing foreign-key index is allowed (additive) and comes from the existing `createFkIndexSql`.
- **No new npm dependencies.**
- **Read-only.** Every statement is a `SELECT` against catalog or statistics views. No table data is read.
- Target server is **PostgreSQL 15.15** (`server_version_num` 150015). Do **not** read `last_idx_scan` (16+): the snapshots answer "when was it last read" on every version, and a version-conditional column would ship untested. `EXPLAIN (GENERIC_PLAN)` does not exist here and is out of scope anyway.
- **`null` is never turned into `0`.** A missing statistics row means *not counted*; calling it zero scans invents a finding.
- Relations are read with `relkind IN ('r','p')` — the existing pressure read used `'r'` only, which hid every index on a partitioned parent.
- Paths use the `#/` alias (`#/lib/...`, `#/server/...`). Tests live under `tests/` mirroring `src/`, not beside the source.
- Run `npx vitest run <path>` for one file; `npm test` for the suite. Live checks: `npm run test:live`.
- Commit after every task with a Conventional Commits subject. Do not add a `Co-Authored-By` trailer.

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `src/lib/indexes/shape.ts` | Ratios from the counters, and the access-pattern classification |
| `src/lib/indexes/capability.ts` | What an index's shape unlocks, independent of usage |
| `src/lib/indexes/write-tax.ts` | What the index costs on the write path, and its byte share |
| `src/lib/indexes/trend.ts` | Scans/day from snapshots, with discontinuities |
| `src/lib/indexes/ranking.ts` | List rows: build, filter, sort (includes missing-FK ghost rows) |
| `src/server/index-samples.ts` | Read/append the snapshot file under `local/` |
| `src/server/index-usage.ts` | The catalog + statistics read for one schema |
| `src/routes/d/$database/indexes/$schema.tsx` | The page |
| `src/components/indexes/IndexList.tsx` | Left rail: filter, sort, rows |
| `src/components/indexes/IndexDetail.tsx` | Right pane: the five blocks |
| `src/components/indexes/Sparkline.tsx` | Inline SVG series, no dependency |
| `src/lib/help/topics/index-usage.ts` | Help topic |
| `src/components/help/previews/IndexUsagePreview.tsx` | Its mock |
| `tests/lib/indexes/*.test.ts`, `tests/server/index-usage.test.ts`, `tests/server/index-samples.test.ts`, `tests/live/index-usage.test.ts` | Tests |

**Modify**

| File | Change |
|---|---|
| `src/lib/types.ts` | The index-inspector payload types |
| `src/server/api.ts` | `$getIndexUsage` server function |
| `src/components/Header.tsx` | Menu entry |
| `src/lib/menu-routes.ts` | `/indexes` in `DATABASE_ROUTES` |
| `src/lib/lens-links.ts` | `indexes` in the route-segment regex |
| `src/lib/help/index.ts` | Register the topic |
| `src/components/help/previews/index.ts` | Register the preview |
| `src/components/pressure/IndexSection.tsx` | Shrink to a summary tile linking to the new page |

---

### Task 1: Payload types and the access-pattern derivation

**Files:**
- Modify: `src/lib/types.ts` (append a new section at the end)
- Create: `src/lib/indexes/shape.ts`
- Test: `tests/lib/indexes/shape.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IndexKeyColumn`, `IndexColumnStats`, `IndexUsageEntry`, `IndexTableEntry`, `IndexUsageSample`, `SchemaIndexUsage` (types); `tuplesPerScan(index)`, `heapFetchRatio(index)`, `cacheHitRatio(index)`, `classifyAccess(index, table)`, type `AccessPattern`, interface `AccessShape`, constants `POINT_LOOKUP_MAX_TUPLES`, `NARROW_RANGE_MAX_TUPLES`, `FULL_READ_TABLE_SHARE`.

- [ ] **Step 1: Add the types**

Append to `src/lib/types.ts`:

```ts
// ── Index inspector ────────────────────────────────────────────────────────

/** One key column of an index, with the order it was declared in. */
export interface IndexKeyColumn {
  /** Column name, or `(expr)` for an expression position. */
  name: string
  descending: boolean
  nullsFirst: boolean
}

/** `pg_stats` for one column, as far as the last ANALYZE knows. */
export interface IndexColumnStats {
  column: string
  /** `n_distinct`: `>= 0` an absolute count, `< 0` a negative fraction of rows. */
  nDistinct: number | null
  correlation: number | null
  nullFraction: number | null
  averageWidth: number | null
}

/**
 * One index, as the catalog and the statistics views describe it.
 *
 * Counters are `number | null`, never defaulted: a missing `pg_stat_user_indexes`
 * row means the index was not counted, and reporting that as zero scans would
 * turn a gap in the statistics into a finding about the index.
 */
export interface IndexUsageEntry {
  table: string
  name: string
  method: string
  /** `pg_get_indexdef` — the definition, for reading and copying. */
  definition: string
  keyColumns: IndexKeyColumn[]
  /** INCLUDE columns: carried in the leaf, not part of the key. */
  includeColumns: string[]
  /** `pg_get_expr(indpred)` — the rows this index covers, when partial. */
  predicate: string | null
  isUnique: boolean
  isPrimary: boolean
  isPartial: boolean
  hasExpression: boolean
  constraintBacked: boolean
  /** `indisvalid` false: a failed CREATE INDEX CONCURRENTLY. Costs writes, answers nothing. */
  isValid: boolean
  isReady: boolean
  bytes: number
  scans: number | null
  tuplesRead: number | null
  tuplesFetched: number | null
  blocksHit: number | null
  blocksRead: number | null
  /** `pg_stats` for the key columns, in key order. Columns ANALYZE has not seen are absent. */
  columnStats: IndexColumnStats[]
}

/** The table an index sits on: what it holds, and how hard it is written. */
export interface IndexTableEntry {
  table: string
  /** `reltuples`; `-1` when the table has never been analyzed. */
  estimatedRows: number
  liveTuples: number | null
  inserted: number | null
  updated: number | null
  /** HOT updates skip index maintenance — the difference between an honest write tax and a scary one. */
  hotUpdated: number | null
  deleted: number | null
  seqScans: number | null
  indexScans: number | null
  tableBytes: number
  indexBytes: number
  totalBytes: number
}

/** One snapshot of the cumulative counters, so a rate can be worked out later. */
export interface IndexUsageSample {
  /** ISO timestamp the snapshot was taken. */
  takenAt: string
  /** `pg_stat_database.stats_reset` at the time — a change invalidates every delta across it. */
  statsReset: string | null
  perIndex: Record<string, { scans: number; tuplesRead: number; tuplesFetched: number }>
}

export interface SchemaIndexUsage {
  schema: string
  serverVersionNum: number
  statsReset: string | null
  indexes: IndexUsageEntry[]
  tables: IndexTableEntry[]
  /** For the ghost rows: a foreign key with no index to lead it. Same type the audit uses. */
  foreignKeys: ForeignKeyColumns[]
  /** Oldest first. Empty on a first-ever read. */
  history: IndexUsageSample[]
  /** Why history is missing or short, when there is a reason worth showing. */
  historyNote: string | null
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/indexes/shape.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  cacheHitRatio,
  classifyAccess,
  heapFetchRatio,
  tuplesPerScan,
} from '#/lib/indexes/shape'
import type { IndexTableEntry, IndexUsageEntry } from '#/lib/types'

function index(overrides: Partial<IndexUsageEntry> = {}): IndexUsageEntry {
  return {
    table: 'orders',
    name: 'orders_customer_idx',
    method: 'btree',
    definition: 'CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id)',
    keyColumns: [{ name: 'customer_id', descending: false, nullsFirst: false }],
    includeColumns: [],
    predicate: null,
    isUnique: false,
    isPrimary: false,
    isPartial: false,
    hasExpression: false,
    constraintBacked: false,
    isValid: true,
    isReady: true,
    bytes: 1_000,
    scans: 100,
    tuplesRead: 100,
    tuplesFetched: 100,
    blocksHit: 90,
    blocksRead: 10,
    columnStats: [],
    ...overrides,
  }
}

function table(overrides: Partial<IndexTableEntry> = {}): IndexTableEntry {
  return {
    table: 'orders',
    estimatedRows: 1_000_000,
    liveTuples: 1_000_000,
    inserted: 0,
    updated: 0,
    hotUpdated: 0,
    deleted: 0,
    seqScans: 0,
    indexScans: 0,
    tableBytes: 10_000,
    indexBytes: 5_000,
    totalBytes: 15_000,
    ...overrides,
  }
}

describe('the ratios', () => {
  it('divides only when both sides were counted', () => {
    expect(tuplesPerScan(index({ scans: 10, tuplesRead: 40 }))).toBe(4)
    expect(tuplesPerScan(index({ scans: null }))).toBeNull()
    expect(tuplesPerScan(index({ tuplesRead: null }))).toBeNull()
    expect(tuplesPerScan(index({ scans: 0, tuplesRead: 0 }))).toBeNull()
  })

  it('reads a heap fetch ratio near zero as the index answering on its own', () => {
    expect(heapFetchRatio(index({ tuplesRead: 1_000, tuplesFetched: 0 }))).toBe(0)
    expect(heapFetchRatio(index({ tuplesRead: 1_000, tuplesFetched: 1_000 }))).toBe(1)
    expect(heapFetchRatio(index({ tuplesRead: 0, tuplesFetched: 0 }))).toBeNull()
  })

  it('reports cache hit only when some block was touched', () => {
    expect(cacheHitRatio(index({ blocksHit: 75, blocksRead: 25 }))).toBe(0.75)
    expect(cacheHitRatio(index({ blocksHit: 0, blocksRead: 0 }))).toBeNull()
    expect(cacheHitRatio(index({ blocksHit: null }))).toBeNull()
  })
})

describe('classifyAccess', () => {
  it('separates an uncounted index from one counted at zero', () => {
    expect(classifyAccess(index({ scans: null }), table()).pattern).toBe('unknown')
    expect(classifyAccess(index({ scans: 0 }), table()).pattern).toBe('never-scanned')
  })

  it('calls one entry per scan a point lookup', () => {
    const shape = classifyAccess(index({ scans: 1_000, tuplesRead: 1_000 }), table())
    expect(shape.pattern).toBe('point-lookup')
    expect(shape.tuplesPerScan).toBe(1)
  })

  it('separates a bounded range from a wide sweep', () => {
    expect(classifyAccess(index({ scans: 100, tuplesRead: 5_000 }), table()).pattern).toBe(
      'narrow-range',
    )
    expect(classifyAccess(index({ scans: 10, tuplesRead: 50_000 }), table()).pattern).toBe(
      'wide-sweep',
    )
  })

  it('calls a scan over half the table a full index read', () => {
    const shape = classifyAccess(
      index({ scans: 10, tuplesRead: 8_000_000 }),
      table({ estimatedRows: 1_000_000 }),
    )
    expect(shape.pattern).toBe('full-index-read')
    expect(shape.tableShare).toBe(0.8)
  })

  it('refuses to classify scans with no tuples counted against them', () => {
    // Seen live: idx_scan 6000 with idx_tup_read 0. The two counters disagree, so
    // "point lookup" would be a guess dressed as a reading.
    expect(classifyAccess(index({ scans: 6_000, tuplesRead: 0 }), table()).pattern).toBe('unknown')
  })

  it('classifies without a table when reltuples is unknown', () => {
    expect(classifyAccess(index({ scans: 10, tuplesRead: 20 }), null).pattern).toBe('narrow-range')
    expect(classifyAccess(index({ scans: 10, tuplesRead: 20 }), table({ estimatedRows: -1 })).tableShare).toBeNull()
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/lib/indexes/shape.test.ts`
Expected: FAIL — cannot resolve `#/lib/indexes/shape`.

- [ ] **Step 4: Implement**

Create `src/lib/indexes/shape.ts`:

```ts
import type { IndexTableEntry, IndexUsageEntry } from '#/lib/types'

/**
 * What the counters say an index is used *for*.
 *
 * `pg_stat_user_indexes` counts three things: how many scans started, how many
 * index entries they read, and how many heap rows those entries were followed
 * to. Their ratios are the shape of the access — one entry per scan is a lookup,
 * a million is a sweep — and the shape is what decides whether an index is
 * serving the plan you think it is.
 *
 * Every rule lives here rather than in SQL so it can be read and argued with.
 */

export type AccessPattern =
  | 'unknown'
  | 'never-scanned'
  | 'point-lookup'
  | 'narrow-range'
  | 'wide-sweep'
  | 'full-index-read'

/** A scan walking about one entry is a lookup. Just above 1, because the figure
 *  is a cumulative average and a handful of multi-row hits should not rename it. */
export const POINT_LOOKUP_MAX_TUPLES = 1.5

/** Up to this many entries per scan still reads as a bounded range. */
export const NARROW_RANGE_MAX_TUPLES = 100

/** A scan touching this share of the table's rows is not a range, it is a read
 *  of the whole index — the case where a sequential scan may well be cheaper. */
export const FULL_READ_TABLE_SHARE = 0.5

export interface AccessShape {
  pattern: AccessPattern
  scans: number | null
  /** Index entries a typical scan walks. */
  tuplesPerScan: number | null
  /** Near 0: the visibility map is answering. Near 1: every entry costs a heap visit. */
  heapFetchRatio: number | null
  cacheHitRatio: number | null
  /** Entries per scan as a share of the table's estimated rows, when it is known. */
  tableShare: number | null
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null
  if (denominator <= 0) return null
  return numerator / denominator
}

export function tuplesPerScan(index: IndexUsageEntry): number | null {
  return ratio(index.tuplesRead, index.scans)
}

export function heapFetchRatio(index: IndexUsageEntry): number | null {
  return ratio(index.tuplesFetched, index.tuplesRead)
}

export function cacheHitRatio(index: IndexUsageEntry): number | null {
  if (index.blocksHit === null || index.blocksRead === null) return null
  const total = index.blocksHit + index.blocksRead
  if (total <= 0) return null
  return index.blocksHit / total
}

/** `reltuples` is `-1` on a table that has never been analyzed, and 0 is not a
 *  denominator — both mean "no row count to compare against". */
function knownRows(table: IndexTableEntry | null): number | null {
  if (!table) return null
  return table.estimatedRows > 0 ? table.estimatedRows : null
}

export function classifyAccess(
  index: IndexUsageEntry,
  table: IndexTableEntry | null,
): AccessShape {
  const perScan = tuplesPerScan(index)
  const rows = knownRows(table)
  const shape: Omit<AccessShape, 'pattern'> = {
    scans: index.scans,
    tuplesPerScan: perScan,
    heapFetchRatio: heapFetchRatio(index),
    cacheHitRatio: cacheHitRatio(index),
    tableShare: perScan !== null && rows !== null ? perScan / rows : null,
  }

  if (index.scans === null) return { ...shape, pattern: 'unknown' }
  if (index.scans === 0) return { ...shape, pattern: 'never-scanned' }
  // Scans counted but no entries read against them: the two counters disagree
  // (seen live). Naming a pattern from that would dress a guess as a reading.
  if (perScan === null || perScan <= 0) return { ...shape, pattern: 'unknown' }

  if (shape.tableShare !== null && shape.tableShare >= FULL_READ_TABLE_SHARE) {
    return { ...shape, pattern: 'full-index-read' }
  }
  if (perScan <= POINT_LOOKUP_MAX_TUPLES) return { ...shape, pattern: 'point-lookup' }
  if (perScan <= NARROW_RANGE_MAX_TUPLES) return { ...shape, pattern: 'narrow-range' }
  return { ...shape, pattern: 'wide-sweep' }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/lib/indexes/shape.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/indexes/shape.ts tests/lib/indexes/shape.test.ts
git commit -m "feat(indexes): read an access pattern out of the scan counters"
```

---

### Task 2: What an index's shape unlocks

**Files:**
- Create: `src/lib/indexes/capability.ts`
- Test: `tests/lib/indexes/capability.test.ts`

**Interfaces:**
- Consumes: `IndexUsageEntry`, `IndexTableEntry`, `IndexColumnStats` from Task 1.
- Produces: `rowsPerValue(nDistinct, estimatedRows)`, `describeCapability(index, table)`, interfaces `EqualityLookup`, `IndexCapability`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/indexes/capability.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { describeCapability, rowsPerValue } from '#/lib/indexes/capability'
import type { IndexTableEntry, IndexUsageEntry } from '#/lib/types'

function index(overrides: Partial<IndexUsageEntry> = {}): IndexUsageEntry {
  return {
    table: 'orders',
    name: 'orders_customer_created_idx',
    method: 'btree',
    definition: 'CREATE INDEX orders_customer_created_idx ON public.orders USING btree (customer_id, created_at DESC)',
    keyColumns: [
      { name: 'customer_id', descending: false, nullsFirst: false },
      { name: 'created_at', descending: true, nullsFirst: true },
    ],
    includeColumns: [],
    predicate: null,
    isUnique: false,
    isPrimary: false,
    isPartial: false,
    hasExpression: false,
    constraintBacked: false,
    isValid: true,
    isReady: true,
    bytes: 1_000,
    scans: 1,
    tuplesRead: 1,
    tuplesFetched: 1,
    blocksHit: 1,
    blocksRead: 0,
    columnStats: [
      { column: 'customer_id', nDistinct: 50_000, correlation: 0.01, nullFraction: 0, averageWidth: 8 },
      { column: 'created_at', nDistinct: -1, correlation: 0.93, nullFraction: 0, averageWidth: 8 },
    ],
    ...overrides,
  }
}

const orders: IndexTableEntry = {
  table: 'orders',
  estimatedRows: 1_000_000,
  liveTuples: 1_000_000,
  inserted: 0,
  updated: 0,
  hotUpdated: 0,
  deleted: 0,
  seqScans: 0,
  indexScans: 0,
  tableBytes: 10_000,
  indexBytes: 5_000,
  totalBytes: 15_000,
}

describe('rowsPerValue', () => {
  it('divides the row count by an absolute distinct count', () => {
    expect(rowsPerValue(50_000, 1_000_000)).toBe(20)
  })

  it('reads a negative n_distinct as a fraction of the rows', () => {
    // -1 means "distinct in every row": one row per value, whatever the size.
    expect(rowsPerValue(-1, 1_000_000)).toBe(1)
    expect(rowsPerValue(-0.5, 1_000_000)).toBe(2)
  })

  it('has no answer without statistics', () => {
    expect(rowsPerValue(null, 1_000_000)).toBeNull()
    expect(rowsPerValue(0, 1_000_000)).toBeNull()
    expect(rowsPerValue(50_000, null)).toBeNull()
  })
})

describe('describeCapability — btree', () => {
  it('offers every key column for equality, with rows per value', () => {
    const capability = describeCapability(index(), orders)
    expect(capability.equalityColumns.map((entry) => entry.column)).toEqual([
      'customer_id',
      'created_at',
    ])
    expect(capability.equalityColumns[0].estimatedRowsPerValue).toBe(20)
  })

  it('names the sort orders it satisfies, forward and exactly reversed', () => {
    expect(describeCapability(index(), orders).sortOrders).toEqual([
      'customer_id, created_at DESC NULLS FIRST',
      'customer_id DESC NULLS LAST, created_at',
    ])
  })

  it('covers key and INCLUDE columns, and calls that index-only eligible', () => {
    const capability = describeCapability(index({ includeColumns: ['total'] }), orders)
    expect(capability.coveredColumns).toEqual(['customer_id', 'created_at', 'total'])
    expect(capability.indexOnlyEligible).toBe(true)
  })

  it('reports what a partial index is restricted to', () => {
    const capability = describeCapability(
      index({ isPartial: true, predicate: '(child_slice_id IS NULL)' }),
      orders,
    )
    expect(capability.restrictedTo).toBe('(child_slice_id IS NULL)')
  })

  it('will not claim a sort order through an expression position', () => {
    const capability = describeCapability(
      index({
        hasExpression: true,
        keyColumns: [{ name: '(expr)', descending: false, nullsFirst: false }],
      }),
      orders,
    )
    expect(capability.sortOrders).toEqual([])
    expect(capability.coveredColumns).toEqual([])
    expect(capability.notes.join(' ')).toContain('expression')
  })
})

describe('describeCapability — other methods', () => {
  it('gives a hash index equality on its first column and nothing else', () => {
    const capability = describeCapability(index({ method: 'hash' }), orders)
    expect(capability.equalityColumns.map((entry) => entry.column)).toEqual(['customer_id'])
    expect(capability.sortOrders).toEqual([])
    expect(capability.rangeCapableColumns).toEqual([])
    expect(capability.indexOnlyEligible).toBe(false)
  })

  it('claims no equality, sort or index-only scan for a gin index', () => {
    const capability = describeCapability(index({ method: 'gin' }), orders)
    expect(capability.equalityColumns).toEqual([])
    expect(capability.sortOrders).toEqual([])
    expect(capability.indexOnlyEligible).toBe(false)
    expect(capability.notes.join(' ')).toContain('gin')
  })

  it('says an invalid index answers nothing at all', () => {
    const capability = describeCapability(index({ isValid: false }), orders)
    expect(capability.indexOnlyEligible).toBe(false)
    expect(capability.notes.join(' ')).toContain('not valid')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/lib/indexes/capability.test.ts`
Expected: FAIL — cannot resolve `#/lib/indexes/capability`.

- [ ] **Step 3: Implement**

Create `src/lib/indexes/capability.ts`:

```ts
import type { IndexKeyColumn, IndexTableEntry, IndexUsageEntry } from '#/lib/types'

/**
 * What an index can answer, from its shape alone.
 *
 * Usage says what the index *has* served; this says what it *could* — which is
 * the half of the decision the counters cannot supply. Everything here is read
 * off the key columns, the access method and the last ANALYZE, and every claim
 * is deliberately small: an unclaimed capability costs a reader nothing, an
 * invented one costs them a bad decision.
 */

/** Methods whose leading columns take an equality qualifier in key order. */
const PREFIX_EQUALITY_METHODS = new Set(['btree'])
/** Methods that can return rows in index order. */
const SORTING_METHODS = new Set(['btree'])
/** Methods that can bound a range on a key column. */
const RANGE_METHODS = new Set(['btree', 'gist', 'spgist', 'brin'])
/** Methods an index-only scan can be planned on. Kept to the one that always can. */
const INDEX_ONLY_METHODS = new Set(['btree'])
/** Written as `(expr)` by the catalog read: a position with no column name. */
const EXPRESSION_POSITION = '(expr)'

export interface EqualityLookup {
  column: string
  /** Rows a single value is expected to match, from `n_distinct`. */
  estimatedRowsPerValue: number | null
  nullFraction: number | null
}

export interface IndexCapability {
  /** Leading columns that take an equality qualifier, in key order. */
  equalityColumns: EqualityLookup[]
  /** Columns that can carry a range (`>`, `<`, `BETWEEN`) once the columns before them are pinned. */
  rangeCapableColumns: string[]
  /** Orders the index returns rows in, forward and exactly reversed. */
  sortOrders: string[]
  /** Columns readable from the index alone — key plus INCLUDE. */
  coveredColumns: string[]
  /** Whether an index-only scan is possible at all (the visibility map still decides per query). */
  indexOnlyEligible: boolean
  /** The rows a partial index holds; null when it holds all of them. */
  restrictedTo: string | null
  /** Why a claim is missing, in the reader's words. */
  notes: string[]
}

/**
 * Rows one value is expected to match.
 *
 * `pg_stats.n_distinct` is either an absolute count of distinct values or, when
 * negative, minus the *fraction* of rows that are distinct — the form ANALYZE
 * uses when the count scales with the table. `-1` therefore means unique, at any
 * size, and needs no row count at all.
 */
export function rowsPerValue(
  nDistinct: number | null,
  estimatedRows: number | null,
): number | null {
  if (nDistinct === null || nDistinct === 0) return null
  if (nDistinct < 0) return 1 / -nDistinct
  if (estimatedRows === null || estimatedRows <= 0) return null
  return estimatedRows / nDistinct
}

function orderSuffix(column: IndexKeyColumn, reversed: boolean): string {
  const descending = reversed ? !column.descending : column.descending
  const nullsFirst = reversed ? !column.nullsFirst : column.nullsFirst
  const parts: string[] = []
  if (descending) parts.push('DESC')
  // Postgres prints only the non-default: NULLS FIRST goes with DESC, LAST with ASC.
  if (nullsFirst !== descending) parts.push(nullsFirst ? 'NULLS FIRST' : 'NULLS LAST')
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

function sortOrder(columns: IndexKeyColumn[], reversed: boolean): string {
  return columns.map((column) => `${column.name}${orderSuffix(column, reversed)}`).join(', ')
}

export function describeCapability(
  index: IndexUsageEntry,
  table: IndexTableEntry | null,
): IndexCapability {
  const notes: string[] = []
  const estimatedRows = table && table.estimatedRows > 0 ? table.estimatedRows : null
  const named = index.keyColumns.filter((column) => column.name !== EXPRESSION_POSITION)
  const hasExpressionPosition = named.length !== index.keyColumns.length

  if (hasExpressionPosition) {
    notes.push(
      'A key position is an expression, not a column. What it sorts and covers depends on the expression, so nothing is claimed for it here — read the definition.',
    )
  }
  if (!index.isValid) {
    notes.push(
      'This index is not valid: a CREATE INDEX CONCURRENTLY that failed leaves one behind. The planner will not use it, and every write still maintains it.',
    )
  }
  if (!PREFIX_EQUALITY_METHODS.has(index.method) && index.method !== 'hash') {
    notes.push(
      `A ${index.method} index answers the operators its method supports, not equality on a key prefix — no sort order and no index-only scan are claimed for it.`,
    )
  }

  const usable = hasExpressionPosition ? [] : index.keyColumns

  let equalityColumns: EqualityLookup[] = []
  if (index.method === 'hash') {
    equalityColumns = usable.slice(0, 1).map((column) => ({
      column: column.name,
      estimatedRowsPerValue: rowsPerValue(
        index.columnStats.find((stats) => stats.column === column.name)?.nDistinct ?? null,
        estimatedRows,
      ),
      nullFraction:
        index.columnStats.find((stats) => stats.column === column.name)?.nullFraction ?? null,
    }))
    notes.push('A hash index serves equality on one column. It cannot sort, range or cover.')
  } else if (PREFIX_EQUALITY_METHODS.has(index.method)) {
    equalityColumns = usable.map((column) => {
      const stats = index.columnStats.find((entry) => entry.column === column.name)
      return {
        column: column.name,
        estimatedRowsPerValue: rowsPerValue(stats?.nDistinct ?? null, estimatedRows),
        nullFraction: stats?.nullFraction ?? null,
      }
    })
  }

  const rangeCapableColumns = RANGE_METHODS.has(index.method)
    ? usable.map((column) => column.name)
    : []

  const sortOrders =
    SORTING_METHODS.has(index.method) && usable.length > 0
      ? [sortOrder(usable, false), sortOrder(usable, true)]
      : []

  const coveredColumns = hasExpressionPosition
    ? []
    : [...index.keyColumns.map((column) => column.name), ...index.includeColumns]

  const indexOnlyEligible =
    INDEX_ONLY_METHODS.has(index.method) && index.isValid && coveredColumns.length > 0

  if (indexOnlyEligible) {
    notes.push(
      'An index-only scan needs the visibility map to say the page is all-visible, so a table with vacuum debt falls back to heap visits.',
    )
  }
  if (index.isPartial) {
    notes.push(
      'Partial: the planner uses it only for queries whose own WHERE implies this predicate.',
    )
  }

  return {
    equalityColumns,
    rangeCapableColumns,
    sortOrders,
    coveredColumns,
    indexOnlyEligible,
    restrictedTo: index.isPartial ? index.predicate : null,
    notes,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lib/indexes/capability.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexes/capability.ts tests/lib/indexes/capability.test.ts
git commit -m "feat(indexes): describe what an index shape unlocks"
```

---

### Task 3: The write tax

**Files:**
- Create: `src/lib/indexes/write-tax.ts`
- Test: `tests/lib/indexes/write-tax.test.ts`

**Interfaces:**
- Consumes: `IndexUsageEntry`, `IndexTableEntry`.
- Produces: `indexedWrites(table)`, `writeTax(index, table, indexesOnTable)`, `interface WriteTax`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/indexes/write-tax.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { indexedWrites, writeTax } from '#/lib/indexes/write-tax'
import type { IndexTableEntry, IndexUsageEntry } from '#/lib/types'

const index: IndexUsageEntry = {
  table: 'orders',
  name: 'orders_customer_idx',
  method: 'btree',
  definition: 'CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id)',
  keyColumns: [{ name: 'customer_id', descending: false, nullsFirst: false }],
  includeColumns: [],
  predicate: null,
  isUnique: false,
  isPrimary: false,
  isPartial: false,
  hasExpression: false,
  constraintBacked: false,
  isValid: true,
  isReady: true,
  bytes: 400,
  scans: 1,
  tuplesRead: 1,
  tuplesFetched: 1,
  blocksHit: 1,
  blocksRead: 0,
  columnStats: [],
}

function table(overrides: Partial<IndexTableEntry> = {}): IndexTableEntry {
  return {
    table: 'orders',
    estimatedRows: 1_000,
    liveTuples: 1_000,
    inserted: 100,
    updated: 50,
    hotUpdated: 20,
    deleted: 10,
    seqScans: 4,
    indexScans: 16,
    tableBytes: 1_600,
    indexBytes: 400,
    totalBytes: 2_000,
    ...overrides,
  }
}

describe('indexedWrites', () => {
  it('counts inserts, non-HOT updates and deletes — the writes every index pays for', () => {
    // 100 inserts + (50 updates - 20 HOT) + 10 deletes
    expect(indexedWrites(table())).toBe(140)
  })

  it('has no answer without a table, or with an uncounted column', () => {
    expect(indexedWrites(null)).toBeNull()
    expect(indexedWrites(table({ inserted: null }))).toBeNull()
  })
})

describe('writeTax', () => {
  it('reports the same write count as the figure it is built from', () => {
    expect(writeTax(index, table(), 3).indexedWrites).toBe(140)
  })

  it('never lets a HOT count larger than the update count go negative', () => {
    expect(writeTax(index, table({ updated: 10, hotUpdated: 40 }), 3).indexedWrites).toBe(110)
  })

  it('states this index as a share of everything the table occupies', () => {
    expect(writeTax(index, table(), 3).byteShare).toBe(0.2)
  })

  it('reports the seq-vs-index balance of the table', () => {
    expect(writeTax(index, table(), 3).seqScanShare).toBe(0.2)
    expect(writeTax(index, table({ seqScans: 0, indexScans: 0 }), 3).seqScanShare).toBeNull()
  })

  it('has no numbers when the table was not counted', () => {
    const tax = writeTax(index, null, 3)
    expect(tax.indexedWrites).toBeNull()
    expect(tax.byteShare).toBeNull()
    expect(tax.indexCount).toBe(3)
  })

  it('keeps an uncounted write column null instead of reading it as no writes', () => {
    expect(writeTax(index, table({ inserted: null }), 3).indexedWrites).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/lib/indexes/write-tax.test.ts`
Expected: FAIL — cannot resolve `#/lib/indexes/write-tax`.

- [ ] **Step 3: Implement**

Create `src/lib/indexes/write-tax.ts`:

```ts
import type { IndexTableEntry, IndexUsageEntry } from '#/lib/types'

/**
 * What an index costs when nobody is reading it.
 *
 * Every insert, every delete and every update that cannot stay on its own page
 * has to be written into every index on the table. HOT updates are the exception
 * — they reuse the page and skip index maintenance entirely — so subtracting
 * them is the difference between an honest number and a frightening one.
 */

export interface WriteTax {
  /** Writes that touch every index on this table. */
  indexedWrites: number | null
  hotUpdates: number | null
  /** How many indexes share that cost, this one included. */
  indexCount: number
  /** This index as a share of everything the table occupies, indexes and TOAST included. */
  byteShare: number | null
  tableTotalBytes: number | null
  /** Sequential scans as a share of all scans of the table — high means the indexes are not being reached for. */
  seqScanShare: number | null
}

/**
 * Writes on this table that every one of its indexes has to be updated for.
 *
 * Exported on its own because the list rail needs this figure for a table that
 * has no index yet — a foreign-key gap — where there is no index to price.
 */
export function indexedWrites(table: IndexTableEntry | null): number | null {
  if (!table) return null
  const { inserted, updated, hotUpdated, deleted } = table
  if (inserted === null || updated === null || deleted === null) return null
  // A HOT count above the update count means the two counters were reset apart;
  // clamping keeps the answer a write count rather than a negative number.
  return inserted + Math.max(0, updated - (hotUpdated ?? 0)) + deleted
}

export function writeTax(
  index: IndexUsageEntry,
  table: IndexTableEntry | null,
  indexesOnTable: number,
): WriteTax {
  if (!table) {
    return {
      indexedWrites: null,
      hotUpdates: null,
      indexCount: indexesOnTable,
      byteShare: null,
      tableTotalBytes: null,
      seqScanShare: null,
    }
  }

  const scanTotal =
    table.seqScans === null || table.indexScans === null
      ? null
      : table.seqScans + table.indexScans

  return {
    indexedWrites: indexedWrites(table),
    hotUpdates: table.hotUpdated,
    indexCount: indexesOnTable,
    byteShare: table.totalBytes > 0 ? index.bytes / table.totalBytes : null,
    tableTotalBytes: table.totalBytes,
    seqScanShare:
      scanTotal !== null && scanTotal > 0 && table.seqScans !== null
        ? table.seqScans / scanTotal
        : null,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lib/indexes/write-tax.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexes/write-tax.ts tests/lib/indexes/write-tax.test.ts
git commit -m "feat(indexes): price an index on the write path"
```

---

### Task 4: Usage over time from the snapshots

**Files:**
- Create: `src/lib/indexes/trend.ts`
- Test: `tests/lib/indexes/trend.test.ts`

**Interfaces:**
- Consumes: `IndexUsageSample`.
- Produces: `indexTrend(history, indexName)`, interfaces `TrendPoint`, `IndexTrend`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/indexes/trend.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { indexTrend } from '#/lib/indexes/trend'
import type { IndexUsageSample } from '#/lib/types'

function sample(
  takenAt: string,
  scans: number,
  statsReset: string | null = '2026-08-01T00:00:00.000Z',
): IndexUsageSample {
  return {
    takenAt,
    statsReset,
    perIndex: { orders_customer_idx: { scans, tuplesRead: scans * 2, tuplesFetched: scans } },
  }
}

describe('indexTrend', () => {
  it('says so plainly when there is not yet a pair to compare', () => {
    expect(indexTrend([], 'orders_customer_idx').empty).toBe(true)
    expect(indexTrend([sample('2026-08-20T00:00:00.000Z', 10)], 'orders_customer_idx').empty).toBe(
      true,
    )
  })

  it('turns two snapshots a day apart into scans per day', () => {
    const trend = indexTrend(
      [sample('2026-08-20T00:00:00.000Z', 100), sample('2026-08-21T00:00:00.000Z', 340)],
      'orders_customer_idx',
    )
    expect(trend.empty).toBe(false)
    expect(trend.scansPerDay).toBe(240)
    expect(trend.windowDays).toBe(1)
    expect(trend.points).toEqual([{ at: '2026-08-21T00:00:00.000Z', scansPerDay: 240 }])
  })

  it('scales a half-day window up to a daily rate', () => {
    const trend = indexTrend(
      [sample('2026-08-20T00:00:00.000Z', 0), sample('2026-08-20T12:00:00.000Z', 50)],
      'orders_customer_idx',
    )
    expect(trend.scansPerDay).toBe(100)
  })

  it('drops the pair a stats reset falls between, and counts it', () => {
    const trend = indexTrend(
      [
        sample('2026-08-20T00:00:00.000Z', 900),
        sample('2026-08-21T00:00:00.000Z', 5, '2026-08-21T00:00:00.000Z'),
        sample('2026-08-22T00:00:00.000Z', 105, '2026-08-21T00:00:00.000Z'),
      ],
      'orders_customer_idx',
    )
    expect(trend.discontinuities).toBe(1)
    expect(trend.points).toEqual([{ at: '2026-08-22T00:00:00.000Z', scansPerDay: 100 }])
    expect(trend.scansPerDay).toBe(100)
  })

  it('treats a counter that went backwards as a discontinuity, never a negative rate', () => {
    const trend = indexTrend(
      [sample('2026-08-20T00:00:00.000Z', 900), sample('2026-08-21T00:00:00.000Z', 5)],
      'orders_customer_idx',
    )
    expect(trend.points).toEqual([])
    expect(trend.discontinuities).toBe(1)
    expect(trend.scansPerDay).toBeNull()
  })

  it('ignores an index the snapshot does not carry', () => {
    const trend = indexTrend(
      [sample('2026-08-20T00:00:00.000Z', 10), sample('2026-08-21T00:00:00.000Z', 20)],
      'some_other_idx',
    )
    expect(trend.empty).toBe(true)
  })

  it('averages the rate over the whole sampled window, not over the pairs', () => {
    const trend = indexTrend(
      [
        sample('2026-08-20T00:00:00.000Z', 0),
        sample('2026-08-21T00:00:00.000Z', 100),
        sample('2026-08-23T00:00:00.000Z', 100),
      ],
      'orders_customer_idx',
    )
    // 100 scans across three days of sampling, not the mean of 100/day and 0/day.
    expect(trend.windowDays).toBe(3)
    expect(trend.scansPerDay).toBeCloseTo(33.333, 3)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/lib/indexes/trend.test.ts`
Expected: FAIL — cannot resolve `#/lib/indexes/trend`.

- [ ] **Step 3: Implement**

Create `src/lib/indexes/trend.ts`:

```ts
import type { IndexUsageSample } from '#/lib/types'

/**
 * Usage now, rather than usage since the counters were reset.
 *
 * `idx_scan` only ever climbs, so on its own it says how much an index was read
 * over a window nobody chose — possibly years. Differencing two snapshots gives
 * a rate for a window we know the length of, which is the number a decision
 * actually needs.
 *
 * A `pg_stat_reset()` or a counter that went backwards breaks the arithmetic. It
 * is reported as a discontinuity and the pair is dropped: a negative rate would
 * be worse than a gap.
 */

const MS_PER_DAY = 86_400_000

export interface TrendPoint {
  /** The later snapshot of the pair. */
  at: string
  scansPerDay: number
}

export interface IndexTrend {
  points: TrendPoint[]
  /** Scans per day across the whole sampled window. */
  scansPerDay: number | null
  windowDays: number | null
  /** Pairs dropped because the counters restarted between them. */
  discontinuities: number
  /** No usable pair yet — a first read, or every pair broken. */
  empty: boolean
}

export function indexTrend(history: IndexUsageSample[], indexName: string): IndexTrend {
  const points: TrendPoint[] = []
  let discontinuities = 0
  let totalScans = 0
  let totalDays = 0

  for (let i = 1; i < history.length; i += 1) {
    const before = history[i - 1]
    const after = history[i]
    const from = before.perIndex[indexName]
    const to = after.perIndex[indexName]
    if (!from || !to) continue

    const days = (Date.parse(after.takenAt) - Date.parse(before.takenAt)) / MS_PER_DAY
    if (!Number.isFinite(days) || days <= 0) continue

    if (before.statsReset !== after.statsReset || to.scans < from.scans) {
      discontinuities += 1
      continue
    }

    const scans = to.scans - from.scans
    totalScans += scans
    totalDays += days
    points.push({ at: after.takenAt, scansPerDay: scans / days })
  }

  return {
    points,
    scansPerDay: totalDays > 0 ? totalScans / totalDays : null,
    windowDays: totalDays > 0 ? totalDays : null,
    discontinuities,
    empty: points.length === 0,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lib/indexes/trend.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexes/trend.ts tests/lib/indexes/trend.test.ts
git commit -m "feat(indexes): turn counter snapshots into a scans-per-day trend"
```

---

### Task 5: List rows — build, filter, sort

**Files:**
- Create: `src/lib/indexes/ranking.ts`
- Test: `tests/lib/indexes/ranking.test.ts`

**Interfaces:**
- Consumes: `SchemaIndexUsage`, `classifyAccess` (Task 1), `indexTrend` (Task 4), `writeTax` (Task 3), and from the existing `#/lib/pressure/index-audit`: `redundantIndexes`, `unindexedForeignKeys`, `enforcesConstraint`.
- Produces: `buildIndexRows(usage)`, `filterRows(rows, criteria)`, `sortRows(rows, sort)`, types `IndexListRow`, `IndexFlag`, `IndexSort`, `RowCriteria`.

**Note on reuse:** `redundantIndexes` and `unindexedForeignKeys` take `IndexEntry[]` (the pressure type). Convert with the adapter below rather than reimplementing the rules — the rules stay in one file.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/indexes/ranking.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildIndexRows, filterRows, sortRows } from '#/lib/indexes/ranking'
import type { IndexUsageEntry, SchemaIndexUsage } from '#/lib/types'

function entry(overrides: Partial<IndexUsageEntry> = {}): IndexUsageEntry {
  return {
    table: 'orders',
    name: 'orders_customer_idx',
    method: 'btree',
    definition: 'CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id)',
    keyColumns: [{ name: 'customer_id', descending: false, nullsFirst: false }],
    includeColumns: [],
    predicate: null,
    isUnique: false,
    isPrimary: false,
    isPartial: false,
    hasExpression: false,
    constraintBacked: false,
    isValid: true,
    isReady: true,
    bytes: 1_000,
    scans: 10,
    tuplesRead: 10,
    tuplesFetched: 10,
    blocksHit: 1,
    blocksRead: 0,
    columnStats: [],
    ...overrides,
  }
}

function usage(overrides: Partial<SchemaIndexUsage> = {}): SchemaIndexUsage {
  return {
    schema: 'public',
    serverVersionNum: 150015,
    statsReset: '2026-08-01T00:00:00.000Z',
    indexes: [entry()],
    tables: [
      {
        table: 'orders',
        estimatedRows: 1_000,
        liveTuples: 1_000,
        inserted: 10,
        updated: 0,
        hotUpdated: 0,
        deleted: 0,
        seqScans: 1,
        indexScans: 1,
        tableBytes: 4_000,
        indexBytes: 1_000,
        totalBytes: 5_000,
      },
    ],
    foreignKeys: [],
    history: [],
    historyNote: null,
    ...overrides,
  }
}

describe('buildIndexRows', () => {
  it('makes one row per index, carrying its columns and size', () => {
    const rows = buildIndexRows(usage())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'index',
      table: 'orders',
      label: 'orders_customer_idx',
      columns: ['customer_id'],
      bytes: 1_000,
    })
  })

  it('flags an invalid index, a never-scanned one and a non-btree one', () => {
    const rows = buildIndexRows(
      usage({
        indexes: [
          entry({ name: 'a_idx', isValid: false }),
          entry({ name: 'b_idx', scans: 0 }),
          entry({ name: 'c_idx', method: 'gin' }),
          entry({ name: 'd_idx', isPartial: true }),
          entry({ name: 'e_idx', isUnique: true }),
        ],
      }),
    )
    const flags = Object.fromEntries(rows.map((row) => [row.label, row.flags]))
    expect(flags.a_idx).toContain('invalid')
    expect(flags.b_idx).toContain('never-scanned')
    expect(flags.c_idx).toContain('non-btree')
    expect(flags.d_idx).toContain('partial')
    expect(flags.e_idx).toContain('unique')
  })

  it('flags the shorter of two indexes whose columns are a prefix of the longer', () => {
    const rows = buildIndexRows(
      usage({
        indexes: [
          entry({ name: 'short_idx', keyColumns: [{ name: 'customer_id', descending: false, nullsFirst: false }] }),
          entry({
            name: 'long_idx',
            keyColumns: [
              { name: 'customer_id', descending: false, nullsFirst: false },
              { name: 'created_at', descending: false, nullsFirst: false },
            ],
          }),
        ],
      }),
    )
    expect(rows.find((row) => row.label === 'short_idx')?.flags).toContain('redundant')
    expect(rows.find((row) => row.label === 'long_idx')?.flags ?? []).not.toContain('redundant')
  })

  it('adds a ghost row for a foreign key no index leads', () => {
    const rows = buildIndexRows(
      usage({
        indexes: [],
        foreignKeys: [{ table: 'payments', constraint: 'payments_order_fk', columns: ['order_id'] }],
      }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'missing-fk',
      table: 'payments',
      columns: ['order_id'],
      bytes: null,
      scansPerDay: null,
    })
    expect(rows[0].flags).toContain('missing-fk')
  })

  it('leaves out a foreign key an index already leads', () => {
    const rows = buildIndexRows(
      usage({
        indexes: [entry({ table: 'payments', name: 'payments_order_idx', keyColumns: [{ name: 'order_id', descending: false, nullsFirst: false }] })],
        foreignKeys: [{ table: 'payments', constraint: 'payments_order_fk', columns: ['order_id'] }],
      }),
    )
    expect(rows.filter((row) => row.kind === 'missing-fk')).toHaveLength(0)
  })

  it('carries a scans-per-day rate through from the history', () => {
    const rows = buildIndexRows(
      usage({
        history: [
          { takenAt: '2026-08-20T00:00:00.000Z', statsReset: '2026-08-01T00:00:00.000Z', perIndex: { orders_customer_idx: { scans: 0, tuplesRead: 0, tuplesFetched: 0 } } },
          { takenAt: '2026-08-21T00:00:00.000Z', statsReset: '2026-08-01T00:00:00.000Z', perIndex: { orders_customer_idx: { scans: 24, tuplesRead: 24, tuplesFetched: 24 } } },
        ],
      }),
    )
    expect(rows[0].scansPerDay).toBe(24)
  })
})

describe('filterRows', () => {
  const rows = buildIndexRows(
    usage({
      indexes: [
        entry({ name: 'orders_customer_idx', table: 'orders' }),
        entry({ name: 'users_email_key', table: 'users', isUnique: true, keyColumns: [{ name: 'email', descending: false, nullsFirst: false }] }),
      ],
    }),
  )

  it('matches on index name, table name and column name', () => {
    expect(filterRows(rows, { text: 'email', flags: [] }).map((row) => row.label)).toEqual([
      'users_email_key',
    ])
    expect(filterRows(rows, { text: 'orders', flags: [] })).toHaveLength(1)
    expect(filterRows(rows, { text: 'CUSTOMER', flags: [] })).toHaveLength(1)
  })

  it('keeps a row only when it carries every requested flag', () => {
    expect(filterRows(rows, { text: '', flags: ['unique'] }).map((row) => row.label)).toEqual([
      'users_email_key',
    ])
    expect(filterRows(rows, { text: '', flags: ['unique', 'invalid'] })).toHaveLength(0)
  })
})

describe('sortRows', () => {
  const rows = buildIndexRows(
    usage({
      indexes: [
        entry({ name: 'small_idx', bytes: 10 }),
        entry({ name: 'big_idx', bytes: 1_000 }),
        entry({ name: 'medium_idx', bytes: 100 }),
      ],
    }),
  )

  it('puts the largest first when sorting by size', () => {
    expect(sortRows(rows, 'size').map((row) => row.label)).toEqual([
      'big_idx',
      'medium_idx',
      'small_idx',
    ])
  })

  it('sorts by name as a stable tiebreak', () => {
    expect(sortRows(rows, 'name').map((row) => row.label)).toEqual([
      'big_idx',
      'medium_idx',
      'small_idx',
    ])
  })

  it('ranks a row with no rate last rather than first', () => {
    const withGhost = buildIndexRows(
      usage({
        indexes: [entry({ name: 'read_idx' })],
        foreignKeys: [{ table: 'payments', constraint: 'fk', columns: ['order_id'] }],
        history: [
          { takenAt: '2026-08-20T00:00:00.000Z', statsReset: null, perIndex: { read_idx: { scans: 0, tuplesRead: 0, tuplesFetched: 0 } } },
          { takenAt: '2026-08-21T00:00:00.000Z', statsReset: null, perIndex: { read_idx: { scans: 5, tuplesRead: 5, tuplesFetched: 5 } } },
        ],
      }),
    )
    expect(sortRows(withGhost, 'scans-per-day')[0].label).toBe('read_idx')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/lib/indexes/ranking.test.ts`
Expected: FAIL — cannot resolve `#/lib/indexes/ranking`.

- [ ] **Step 3: Implement**

Create `src/lib/indexes/ranking.ts`:

```ts
import { classifyAccess, type AccessPattern } from '#/lib/indexes/shape'
import { indexTrend } from '#/lib/indexes/trend'
import { indexedWrites, writeTax } from '#/lib/indexes/write-tax'
import { redundantIndexes, unindexedForeignKeys } from '#/lib/pressure/index-audit'
import type {
  ForeignKeyColumns,
  IndexEntry,
  IndexTableEntry,
  IndexUsageEntry,
  SchemaIndexUsage,
} from '#/lib/types'

/**
 * The left rail's rows: every index in the schema, plus the foreign keys that
 * have none, in one list — a gap and a sprawl are the same kind of decision, and
 * splitting them across two panes hides one of them.
 *
 * The verdicts are not decided here. `lib/pressure/index-audit.ts` already owns
 * "redundant" and "uncovered foreign key", and this file adapts to its type
 * rather than restating its rules.
 */

export type IndexFlag =
  | 'invalid'
  | 'never-scanned'
  | 'redundant'
  | 'unique'
  | 'partial'
  | 'non-btree'
  | 'missing-fk'

export type IndexSort = 'scans-per-day' | 'size' | 'tuples-per-scan' | 'write-tax' | 'name'

export interface IndexListRow {
  kind: 'index' | 'missing-fk'
  /** Stable, unique, and what the page puts in `?index=`. */
  key: string
  table: string
  /** The index name, or the constraint name for a gap. */
  label: string
  columns: string[]
  bytes: number | null
  scansPerDay: number | null
  tuplesPerScan: number | null
  /** Writes on this table that every one of its indexes pays for. */
  indexedWrites: number | null
  pattern: AccessPattern | null
  flags: IndexFlag[]
}

export interface RowCriteria {
  text: string
  flags: IndexFlag[]
}

/** The audit's type, from ours. Its rules only read these fields. */
function toAuditEntry(index: IndexUsageEntry): IndexEntry {
  return {
    table: index.table,
    name: index.name,
    method: index.method,
    keyColumns: index.keyColumns.map((column) => column.name),
    isUnique: index.isUnique,
    isPrimary: index.isPrimary,
    isPartial: index.isPartial,
    hasExpression: index.hasExpression,
    constraintBacked: index.constraintBacked,
    scans: index.scans,
    bytes: index.bytes,
  }
}

function flagsFor(index: IndexUsageEntry, redundant: Set<string>): IndexFlag[] {
  const flags: IndexFlag[] = []
  if (!index.isValid) flags.push('invalid')
  if (index.scans === 0) flags.push('never-scanned')
  if (redundant.has(index.name)) flags.push('redundant')
  if (index.isUnique) flags.push('unique')
  if (index.isPartial) flags.push('partial')
  if (index.method !== 'btree') flags.push('non-btree')
  return flags
}

export function buildIndexRows(usage: SchemaIndexUsage): IndexListRow[] {
  const auditEntries = usage.indexes.map(toAuditEntry)
  const redundant = new Set(redundantIndexes(auditEntries).map((finding) => finding.index.name))
  const tables = new Map<string, IndexTableEntry>(
    usage.tables.map((table) => [table.table, table]),
  )
  const indexesPerTable = new Map<string, number>()
  for (const index of usage.indexes) {
    indexesPerTable.set(index.table, (indexesPerTable.get(index.table) ?? 0) + 1)
  }

  const indexRows: IndexListRow[] = usage.indexes.map((index) => {
    const table = tables.get(index.table) ?? null
    const shape = classifyAccess(index, table)
    const tax = writeTax(index, table, indexesPerTable.get(index.table) ?? 1)
    return {
      kind: 'index',
      key: `${index.table}.${index.name}`,
      table: index.table,
      label: index.name,
      columns: index.keyColumns.map((column) => column.name),
      bytes: index.bytes,
      scansPerDay: indexTrend(usage.history, index.name).scansPerDay,
      tuplesPerScan: shape.tuplesPerScan,
      indexedWrites: tax.indexedWrites,
      pattern: shape.pattern,
      flags: flagsFor(index, redundant),
    }
  })

  const gaps: ForeignKeyColumns[] = unindexedForeignKeys(usage.foreignKeys, auditEntries)
  const gapRows: IndexListRow[] = gaps.map((fk) => ({
    kind: 'missing-fk',
    key: `${fk.table}.${fk.constraint}`,
    table: fk.table,
    label: fk.constraint,
    columns: fk.columns,
    bytes: null,
    scansPerDay: null,
    tuplesPerScan: null,
    // There is no index here to price, but the table's write volume is still the
    // number that decides whether adding one is cheap.
    indexedWrites: indexedWrites(tables.get(fk.table) ?? null),
    pattern: null,
    flags: ['missing-fk'],
  }))

  return [...indexRows, ...gapRows]
}

export function filterRows(rows: IndexListRow[], criteria: RowCriteria): IndexListRow[] {
  const needle = criteria.text.trim().toLowerCase()
  return rows.filter((row) => {
    if (criteria.flags.some((flag) => !row.flags.includes(flag))) return false
    if (needle === '') return true
    const haystack = [row.label, row.table, ...row.columns].join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}

/** A row with no number to sort by goes last, whichever direction is chosen: a
 *  missing measurement is not a small one. */
function byDescending(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

export function sortRows(rows: IndexListRow[], sort: IndexSort): IndexListRow[] {
  const sorted = [...rows]
  sorted.sort((a, b) => {
    const primary =
      sort === 'size'
        ? byDescending(a.bytes, b.bytes)
        : sort === 'scans-per-day'
          ? byDescending(a.scansPerDay, b.scansPerDay)
          : sort === 'tuples-per-scan'
            ? byDescending(a.tuplesPerScan, b.tuplesPerScan)
            : sort === 'write-tax'
              ? byDescending(a.indexedWrites, b.indexedWrites)
              : 0
    return primary !== 0 ? primary : a.label.localeCompare(b.label)
  })
  return sorted
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lib/indexes/ tests/lib/pressure/`
Expected: PASS, and the existing pressure tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexes tests/lib/indexes
git commit -m "feat(indexes): build, filter and sort the index list rows"
```

---

### Task 6: The snapshot store

**Files:**
- Create: `src/server/index-samples.ts`
- Test: `tests/server/index-samples.test.ts`

**Interfaces:**
- Consumes: `currentScope()` from `#/server/local-metadata`, `metadataPath()` from `#/lib/local-metadata-path`, `IndexUsageSample` from Task 1.
- Produces: `readIndexSamples(schema)`, `appendIndexSample(schema, sample)` → `{ history: IndexUsageSample[]; note: string | null }`, constants `SAMPLE_MIN_INTERVAL_MS`, `SAMPLE_HISTORY_LIMIT`, `SAMPLES_FILE_NAME`.

**Convention:** follow `src/server/presets.ts` for writing under `local/` — `mkdir(dirname, { recursive: true })` then `writeFile`, path built from `process.cwd()`. Follow `tests/server/local-metadata.test.ts` for the test: a real temp directory plus `vi.spyOn(process, 'cwd')`, and `vi.mock('#/server/db')` for the scope. No fs mocking.

- [ ] **Step 1: Write the failing test**

Create `tests/server/index-samples.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexUsageSample } from '#/lib/types'

vi.mock('#/server/db', () => ({
  getLastConfig: () => scope.config,
  getPresetName: () => scope.presetName,
  resolveDatabase: () => scope.config?.database,
}))

const scope: {
  config: { host: string; port: number; database: string; user: string } | null
  presetName: string | null
} = { config: null, presetName: null }

const { appendIndexSample, readIndexSamples, SAMPLE_HISTORY_LIMIT } = await import(
  '#/server/index-samples'
)

function sample(takenAt: string, scans: number): IndexUsageSample {
  return {
    takenAt,
    statsReset: '2026-08-01T00:00:00.000Z',
    perIndex: { orders_customer_idx: { scans, tuplesRead: scans, tuplesFetched: scans } },
  }
}

describe('the index sample store', () => {
  let root: string
  let cwd: ReturnType<typeof vi.spyOn>
  const file = () =>
    join(root, 'local', 'reporting-prod', 'reporting-db', 'public', 'index-samples.json')

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'db-explorer-samples-'))
    cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    scope.config = { host: 'db.internal', port: 5432, database: 'reporting_db', user: 'r' }
    scope.presetName = 'Reporting (prod)'
  })

  afterEach(() => {
    cwd.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  it('returns nothing at all on a first read, rather than failing', async () => {
    expect(await readIndexSamples('public')).toEqual([])
  })

  it('writes the first sample, keyed by connection, database and schema', async () => {
    const result = await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 10))
    expect(result.note).toBeNull()
    expect(result.history).toHaveLength(1)
    expect(JSON.parse(readFileSync(file(), 'utf-8'))).toHaveLength(1)
  })

  it('declines a second sample inside the minimum interval, keeping the history it has', async () => {
    await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 10))
    const result = await appendIndexSample('public', sample('2026-08-22T10:05:00.000Z', 12))
    expect(result.history).toHaveLength(1)
    expect(result.history[0].perIndex.orders_customer_idx.scans).toBe(10)
  })

  it('appends once the interval has passed', async () => {
    await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 10))
    const result = await appendIndexSample('public', sample('2026-08-22T10:20:00.000Z', 12))
    expect(result.history.map((entry) => entry.perIndex.orders_customer_idx.scans)).toEqual([10, 12])
  })

  it('keeps the newest samples only, up to the limit', async () => {
    const many = Array.from({ length: SAMPLE_HISTORY_LIMIT + 5 }, (_, i) =>
      sample(new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), i),
    )
    mkdirSync(join(file(), '..'), { recursive: true })
    writeFileSync(file(), JSON.stringify(many))

    const result = await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 999))
    expect(result.history).toHaveLength(SAMPLE_HISTORY_LIMIT)
    expect(result.history.at(-1)?.perIndex.orders_customer_idx.scans).toBe(999)
    expect(result.history[0].perIndex.orders_customer_idx.scans).toBe(6)
  })

  it('starts over from a corrupt file instead of throwing', async () => {
    mkdirSync(join(file(), '..'), { recursive: true })
    writeFileSync(file(), '{ not json')

    const result = await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 10))
    expect(result.history).toHaveLength(1)
    expect(result.note).toMatch(/unreadable/i)
  })

  it('reports an unwritable location as a note, not an error', async () => {
    scope.config = null // nothing connected: there is no path to write to
    const result = await appendIndexSample('public', sample('2026-08-22T10:00:00.000Z', 10))
    expect(result.history).toEqual([])
    expect(result.note).toMatch(/not stored/i)
  })

  it('sorts what it read oldest first, whatever order the file was in', async () => {
    mkdirSync(join(file(), '..'), { recursive: true })
    writeFileSync(
      file(),
      JSON.stringify([sample('2026-08-22T10:00:00.000Z', 20), sample('2026-08-20T10:00:00.000Z', 5)]),
    )
    const history = await readIndexSamples('public')
    expect(history.map((entry) => entry.takenAt)).toEqual([
      '2026-08-20T10:00:00.000Z',
      '2026-08-22T10:00:00.000Z',
    ])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/server/index-samples.test.ts`
Expected: FAIL — cannot resolve `#/server/index-samples`.

- [ ] **Step 3: Implement**

Create `src/server/index-samples.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { metadataPath } from '#/lib/local-metadata-path'
import { currentScope } from '#/server/local-metadata'
import type { IndexUsageSample } from '#/lib/types'

/**
 * Snapshots of the index scan counters, so a rate can be worked out.
 *
 * `idx_scan` only climbs, and the window it covers is whenever the statistics
 * were last reset — which may be years, or an hour ago. Storing the counters
 * with a timestamp is what turns them into "read 40 times a day now".
 *
 * This is the first writer into `local/`, and it writes beside the metadata it
 * is keyed like: per connection, per database, per schema. A history that cannot
 * be written is not an error worth failing a page read over — the caller is
 * handed a note and the page renders from the live counters alone.
 */

const LOCAL_DIR = 'local'
export const SAMPLES_FILE_NAME = 'index-samples.json'

/** Frequent enough to make a day's trend, rare enough that clicking around the
 *  app does not fill the file with noise. */
export const SAMPLE_MIN_INTERVAL_MS = 15 * 60_000

/** About three months at one sample every fifteen minutes of use. Older samples
 *  describe a schema that has since been migrated. */
export const SAMPLE_HISTORY_LIMIT = 90

async function samplesFile(schema: string): Promise<string | null> {
  const { connection, database } = await currentScope()
  const segments = metadataPath({ connection, database, schema, fileName: SAMPLES_FILE_NAME })
  if (!segments) return null
  return resolve(process.cwd(), LOCAL_DIR, ...segments)
}

function oldestFirst(samples: IndexUsageSample[]): IndexUsageSample[] {
  return [...samples].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt))
}

/** What is on disk. A missing file is a first read; a corrupt one is reported
 *  through {@link appendIndexSample}, since only a write can repair it. */
export async function readIndexSamples(schema: string): Promise<IndexUsageSample[]> {
  const path = await samplesFile(schema)
  if (!path) return []
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
    return Array.isArray(parsed) ? oldestFirst(parsed as IndexUsageSample[]) : []
  } catch {
    return []
  }
}

/**
 * Add a snapshot, unless the last one is too recent, and hand back the history
 * the caller should render either way.
 */
export async function appendIndexSample(
  schema: string,
  sample: IndexUsageSample,
): Promise<{ history: IndexUsageSample[]; note: string | null }> {
  const path = await samplesFile(schema)
  if (!path) {
    return {
      history: [],
      note: 'Usage history is not stored while the connection is unknown, so only the cumulative counters are shown.',
    }
  }

  let existing: IndexUsageSample[] = []
  let note: string | null = null
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
    if (Array.isArray(parsed)) existing = oldestFirst(parsed as IndexUsageSample[])
    else note = 'The stored history was unreadable and has been started again.'
  } catch (error) {
    // A missing file is the normal first read; anything else is a file we are
    // about to overwrite, which the reader should be told about.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      note = 'The stored history was unreadable and has been started again.'
    }
  }

  const last = existing.at(-1)
  if (last && Date.parse(sample.takenAt) - Date.parse(last.takenAt) < SAMPLE_MIN_INTERVAL_MS) {
    return { history: existing, note }
  }

  const history = [...existing, sample].slice(-SAMPLE_HISTORY_LIMIT)
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(history, null, 2)}\n`, 'utf-8')
  } catch {
    return {
      history: existing,
      note: 'This snapshot could not be written, so the trend stops at the last one that was.',
    }
  }

  return { history, note }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/server/index-samples.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the file is not tracked**

Run: `git check-ignore -v local/` — expect a `.gitignore` rule to match. If it does not, stop and report; nothing under `local/` may be committed.

- [ ] **Step 6: Commit**

```bash
git add src/server/index-samples.ts tests/server/index-samples.test.ts
git commit -m "feat(indexes): snapshot the scan counters under local/"
```

---

### Task 7: The catalog and statistics read

**Files:**
- Create: `src/server/index-usage.ts`
- Test: `tests/server/index-usage.test.ts`
- Test: `tests/live/index-usage.test.ts`

**Interfaces:**
- Consumes: `query` from `#/server/db`, `readIndexSamples`/`appendIndexSample` from Task 6, types from Task 1.
- Produces: `getIndexUsage(schema?)` → `Promise<SchemaIndexUsage>`.

**All five statements below were run against the live PostgreSQL 15.15 target before this plan was written; they return the columns the mapper reads.** Do not "improve" them without re-running them.

**Conventions to copy from `src/server/schema-pressure.ts`:** `toNumber`, `toNameArray` (a `name[]` may arrive as the literal `{a,b}`), `toIso`, one `Promise.all` for all reads, and a `SHOW server_version_num` first.

- [ ] **Step 1: Write the failing test**

Create `tests/server/index-usage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()
const mockAppend = vi.fn()

vi.mock('#/server/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

vi.mock('#/server/index-samples', () => ({
  appendIndexSample: (...args: unknown[]) => mockAppend(...args),
  readIndexSamples: async () => [],
}))

const { getIndexUsage } = await import('#/server/index-usage')

/** Route each read by a fragment of its SQL: they run in parallel, so order is
 *  not something a test should depend on. Later routes win. */
function answer(routes: Array<[string, unknown]>) {
  mockQuery.mockImplementation(async (sql: string) => {
    for (let i = routes.length - 1; i >= 0; i -= 1) {
      const [fragment, rows] = routes[i]
      if (sql.includes(fragment)) return { rows }
    }
    return { rows: [] }
  })
}

const indexRow = {
  table_name: 'orders',
  index_name: 'orders_customer_created_idx',
  method: 'btree',
  definition:
    'CREATE INDEX orders_customer_created_idx ON public.orders USING btree (customer_id, created_at DESC)',
  predicate: null,
  is_unique: false,
  is_primary: false,
  is_valid: true,
  is_ready: true,
  is_partial: false,
  has_expression: false,
  constraint_backed: false,
  bytes: '4096',
  scans: '10',
  tup_read: '40',
  tup_fetch: '30',
  blks_hit: '90',
  blks_read: '10',
  key_columns: ['customer_id', 'created_at'],
  include_columns: null,
  descending: [false, true],
  nulls_first: [false, true],
}

const baseRoutes: Array<[string, unknown]> = [
  ['server_version_num', [{ server_version_num: '150015' }]],
  ['FROM pg_index x', [indexRow]],
  ['FROM pg_stat_user_tables', []],
  ["con.contype = 'f'", []],
  ['FROM pg_stats', []],
  ['stats_reset', [{ stats_reset: '2026-08-01T00:00:00.000Z' }]],
]

beforeEach(() => {
  mockQuery.mockReset()
  mockAppend.mockReset()
  mockAppend.mockResolvedValue({ history: [], note: null })
})

describe('getIndexUsage', () => {
  it('maps an index with its order flags, sizes and counters', async () => {
    answer(baseRoutes)
    const usage = await getIndexUsage('public')

    expect(usage.schema).toBe('public')
    expect(usage.serverVersionNum).toBe(150015)
    expect(usage.indexes).toHaveLength(1)
    expect(usage.indexes[0]).toMatchObject({
      table: 'orders',
      name: 'orders_customer_created_idx',
      method: 'btree',
      bytes: 4096,
      scans: 10,
      tuplesRead: 40,
      tuplesFetched: 30,
      blocksHit: 90,
      blocksRead: 10,
      includeColumns: [],
      isValid: true,
    })
    expect(usage.indexes[0].keyColumns).toEqual([
      { name: 'customer_id', descending: false, nullsFirst: false },
      { name: 'created_at', descending: true, nullsFirst: true },
    ])
  })

  it('keeps an uncounted index null rather than calling it zero', async () => {
    answer([
      ...baseRoutes,
      [
        'FROM pg_index x',
        [{ ...indexRow, scans: null, tup_read: null, tup_fetch: null, blks_hit: null, blks_read: null }],
      ],
    ])
    const usage = await getIndexUsage('public')
    expect(usage.indexes[0].scans).toBeNull()
    expect(usage.indexes[0].tuplesRead).toBeNull()
    expect(usage.indexes[0].blocksHit).toBeNull()
  })

  it('parses a column list whether the driver hands back an array or a literal', async () => {
    answer([
      ...baseRoutes,
      [
        'FROM pg_index x',
        [{ ...indexRow, key_columns: '{customer_id,created_at}', include_columns: '{total}' }],
      ],
    ])
    const usage = await getIndexUsage('public')
    expect(usage.indexes[0].keyColumns.map((column) => column.name)).toEqual([
      'customer_id',
      'created_at',
    ])
    expect(usage.indexes[0].includeColumns).toEqual(['total'])
  })

  it('attaches the column statistics for its key columns, in key order', async () => {
    answer([
      ...baseRoutes,
      [
        'FROM pg_stats',
        [
          { table_name: 'orders', column_name: 'created_at', n_distinct: '-1', correlation: '0.93', null_frac: '0', avg_width: '8' },
          { table_name: 'orders', column_name: 'customer_id', n_distinct: '50000', correlation: '0.01', null_frac: '0', avg_width: '8' },
          { table_name: 'other', column_name: 'customer_id', n_distinct: '1', correlation: '0', null_frac: '0', avg_width: '8' },
        ],
      ],
    ])
    const usage = await getIndexUsage('public')
    expect(usage.indexes[0].columnStats.map((stats) => stats.column)).toEqual([
      'customer_id',
      'created_at',
    ])
    expect(usage.indexes[0].columnStats[1].nDistinct).toBe(-1)
  })

  it('maps the table row, keeping -1 reltuples as the "never analyzed" value it is', async () => {
    answer([
      ...baseRoutes,
      [
        'FROM pg_stat_user_tables',
        [
          {
            table_name: 'orders',
            est_rows: '-1',
            live_tuples: '0',
            n_tup_ins: '100',
            n_tup_upd: '50',
            n_tup_hot_upd: '20',
            n_tup_del: '10',
            seq_scans: '4',
            index_scans: '16',
            table_bytes: '1000',
            index_bytes: '500',
            total_bytes: '1500',
          },
        ],
      ],
    ])
    const usage = await getIndexUsage('public')
    expect(usage.tables[0]).toMatchObject({
      table: 'orders',
      estimatedRows: -1,
      inserted: 100,
      hotUpdated: 20,
      totalBytes: 1500,
    })
  })

  it('takes a snapshot of the counters it read, and reports the note it gets back', async () => {
    mockAppend.mockResolvedValue({
      history: [],
      note: 'This snapshot could not be written, so the trend stops at the last one that was.',
    })
    answer(baseRoutes)
    const usage = await getIndexUsage('public')

    expect(mockAppend).toHaveBeenCalledTimes(1)
    const [schema, sample] = mockAppend.mock.calls[0]
    expect(schema).toBe('public')
    expect(sample.statsReset).toBe('2026-08-01T00:00:00.000Z')
    expect(sample.perIndex.orders_customer_created_idx).toEqual({
      scans: 10,
      tuplesRead: 40,
      tuplesFetched: 30,
    })
    expect(usage.historyNote).toMatch(/could not be written/)
  })

  it('leaves an uncounted index out of the snapshot rather than storing a zero', async () => {
    answer([...baseRoutes, ['FROM pg_index x', [{ ...indexRow, scans: null }]]])
    await getIndexUsage('public')
    expect(mockAppend.mock.calls[0][1].perIndex).toEqual({})
  })

  it('reads the schema it was given', async () => {
    answer(baseRoutes)
    await getIndexUsage('reporting')
    for (const call of mockQuery.mock.calls) {
      if (call[1]) expect(call[1]).toEqual(['reporting'])
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/server/index-usage.test.ts`
Expected: FAIL — cannot resolve `#/server/index-usage`.

- [ ] **Step 3: Implement**

Create `src/server/index-usage.ts`:

```ts
import { query } from '#/server/db'
import { appendIndexSample } from '#/server/index-samples'
import type {
  ForeignKeyColumns,
  IndexColumnStats,
  IndexKeyColumn,
  IndexTableEntry,
  IndexUsageEntry,
  IndexUsageSample,
  SchemaIndexUsage,
} from '#/lib/types'

/**
 * One read of everything the catalog and the statistics views know about a
 * schema's indexes: their shape, what has been read through them, what the last
 * ANALYZE thinks of their columns, and what their tables cost to write.
 *
 * Facts only. Which pattern an index serves, what its shape unlocks, what it
 * costs — all derived in `lib/indexes/*`, where the rules are testable and can
 * be read without reading SQL. Nothing here plans or executes a statement, and
 * no table data is touched, so the cost is the same on a 1.8 TB schema as on an
 * empty one.
 */

const DEFAULT_SCHEMA = 'public'

async function serverVersionNum(): Promise<number> {
  const result = await query('SHOW server_version_num')
  const parsed = Number(result.rows[0]?.server_version_num)
  return Number.isFinite(parsed) ? parsed : 0
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** A counter that was not collected stays absent: zero scans is a finding, and
 *  a missing statistics row is not one. */
function toCounter(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * A Postgres array of identifiers, however the driver handed it over.
 *
 * `array_agg(attname)` yields `name[]`, an OID node-postgres has no parser for,
 * so it can arrive as the literal `{a,b}`. The queries cast to `text[]` to get a
 * parsed array; this stays tolerant of the literal so a driver or cast change
 * degrades to the right answer instead of to an empty list, which would read as
 * "this index has no columns".
 */
function toNameArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value !== 'string') return []
  const body = value.trim().replace(/^\{/, '').replace(/\}$/, '')
  if (body === '') return []
  return body
    .split(',')
    .map((part) => part.trim().replace(/^"(.*)"$/, '$1'))
    .filter((part) => part.length > 0)
}

/** `boolean[]` has the same driver caveat as `name[]`. */
function toBoolArray(value: unknown): boolean[] {
  if (Array.isArray(value)) return value.map((item) => item === true || item === 't')
  return toNameArray(value).map((item) => item === 't' || item === 'true')
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function getIndexUsage(
  schema: string = DEFAULT_SCHEMA,
): Promise<SchemaIndexUsage> {
  const version = await serverVersionNum()

  const [indexResult, tableResult, fkResult, statsResult, resetResult] = await Promise.all([
    // Index shape, size and counters. `indoption` carries the per-column order
    // flags: bit 0 is DESC, bit 1 is NULLS FIRST — the only place the declared
    // order can be read as data rather than parsed out of the definition text.
    query(
      `
      SELECT
        table_rel.relname   AS table_name,
        index_rel.relname   AS index_name,
        access_method.amname AS method,
        pg_get_indexdef(x.indexrelid) AS definition,
        pg_get_expr(x.indpred, x.indrelid) AS predicate,
        x.indisunique   AS is_unique,
        x.indisprimary  AS is_primary,
        x.indisvalid    AS is_valid,
        x.indisready    AS is_ready,
        x.indpred IS NOT NULL  AS is_partial,
        x.indexprs IS NOT NULL AS has_expression,
        EXISTS (
          SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
        ) AS constraint_backed,
        pg_relation_size(x.indexrelid) AS bytes,
        index_stat.idx_scan      AS scans,
        index_stat.idx_tup_read  AS tup_read,
        index_stat.idx_tup_fetch AS tup_fetch,
        index_io.idx_blks_hit    AS blks_hit,
        index_io.idx_blks_read   AS blks_read,
        (
          SELECT array_agg(COALESCE(att.attname, '(expr)')::text ORDER BY k.ord)
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          LEFT JOIN pg_attribute att
            ON att.attrelid = x.indrelid AND att.attnum = k.attnum AND k.attnum > 0
          WHERE k.ord <= x.indnkeyatts
        ) AS key_columns,
        (
          SELECT array_agg(COALESCE(att.attname, '(expr)')::text ORDER BY k.ord)
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          LEFT JOIN pg_attribute att
            ON att.attrelid = x.indrelid AND att.attnum = k.attnum AND k.attnum > 0
          WHERE k.ord > x.indnkeyatts
        ) AS include_columns,
        (
          SELECT array_agg((opt.value & 1) = 1 ORDER BY opt.ord)
          FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS opt(value, ord)
          WHERE opt.ord <= x.indnkeyatts
        ) AS descending,
        (
          SELECT array_agg((opt.value & 2) = 2 ORDER BY opt.ord)
          FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS opt(value, ord)
          WHERE opt.ord <= x.indnkeyatts
        ) AS nulls_first
      FROM pg_index x
      JOIN pg_class index_rel ON index_rel.oid = x.indexrelid
      JOIN pg_class table_rel ON table_rel.oid = x.indrelid
      JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
      JOIN pg_am access_method ON access_method.oid = index_rel.relam
      LEFT JOIN pg_stat_user_indexes index_stat ON index_stat.indexrelid = x.indexrelid
      LEFT JOIN pg_statio_user_indexes index_io ON index_io.indexrelid = x.indexrelid
      WHERE ns.nspname = $1
        AND table_rel.relkind IN ('r', 'p')
      ORDER BY table_rel.relname, index_rel.relname
    `,
      [schema],
    ),
    // The table behind each index: how hard it is written, and what it occupies.
    query(
      `
      SELECT
        table_rel.relname       AS table_name,
        table_rel.reltuples::float8 AS est_rows,
        table_stat.n_live_tup   AS live_tuples,
        table_stat.n_tup_ins,
        table_stat.n_tup_upd,
        table_stat.n_tup_hot_upd,
        table_stat.n_tup_del,
        table_stat.seq_scan     AS seq_scans,
        table_stat.idx_scan     AS index_scans,
        pg_table_size(table_rel.oid)   AS table_bytes,
        pg_indexes_size(table_rel.oid) AS index_bytes,
        pg_total_relation_size(table_rel.oid) AS total_bytes
      FROM pg_class table_rel
      JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
      LEFT JOIN pg_stat_user_tables table_stat ON table_stat.relid = table_rel.oid
      WHERE ns.nspname = $1
        AND table_rel.relkind IN ('r', 'p')
      ORDER BY table_rel.relname
    `,
      [schema],
    ),
    // Foreign keys, for the gaps: Postgres indexes the referenced side and never
    // the referencing one.
    query(
      `
      SELECT
        table_rel.relname AS table_name,
        con.conname       AS constraint_name,
        (
          SELECT array_agg(att.attname::text ORDER BY k.ord)
          FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
        ) AS columns
      FROM pg_constraint con
      JOIN pg_class table_rel ON table_rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
      WHERE ns.nspname = $1
        AND con.contype = 'f'
      ORDER BY table_rel.relname, con.conname
    `,
      [schema],
    ),
    // What the last ANALYZE thinks of every column: selectivity and clustering.
    // Read for the whole schema in one pass rather than once per index.
    query(
      `
      SELECT
        col_stat.tablename AS table_name,
        col_stat.attname   AS column_name,
        col_stat.n_distinct,
        col_stat.correlation,
        col_stat.null_frac,
        col_stat.avg_width
      FROM pg_stats col_stat
      WHERE col_stat.schemaname = $1
    `,
      [schema],
    ),
    query(`SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()`),
  ])

  const statsByTable = new Map<string, Map<string, IndexColumnStats>>()
  for (const row of statsResult.rows) {
    const table = row.table_name as string
    const columns = statsByTable.get(table) ?? new Map<string, IndexColumnStats>()
    columns.set(row.column_name as string, {
      column: row.column_name as string,
      nDistinct: toCounter(row.n_distinct),
      correlation: toCounter(row.correlation),
      nullFraction: toCounter(row.null_frac),
      averageWidth: toCounter(row.avg_width),
    })
    statsByTable.set(table, columns)
  }

  const indexes: IndexUsageEntry[] = indexResult.rows.map((row) => {
    const names = toNameArray(row.key_columns)
    const descending = toBoolArray(row.descending)
    const nullsFirst = toBoolArray(row.nulls_first)
    const keyColumns: IndexKeyColumn[] = names.map((name, i) => ({
      name,
      descending: descending[i] ?? false,
      nullsFirst: nullsFirst[i] ?? false,
    }))
    const tableStats = statsByTable.get(row.table_name as string)

    return {
      table: row.table_name as string,
      name: row.index_name as string,
      method: row.method as string,
      definition: (row.definition as string | null) ?? '',
      keyColumns,
      includeColumns: toNameArray(row.include_columns),
      predicate: (row.predicate as string | null) ?? null,
      isUnique: Boolean(row.is_unique),
      isPrimary: Boolean(row.is_primary),
      isPartial: Boolean(row.is_partial),
      hasExpression: Boolean(row.has_expression),
      constraintBacked: Boolean(row.constraint_backed),
      isValid: Boolean(row.is_valid),
      isReady: Boolean(row.is_ready),
      bytes: toNumber(row.bytes),
      scans: toCounter(row.scans),
      tuplesRead: toCounter(row.tup_read),
      tuplesFetched: toCounter(row.tup_fetch),
      blocksHit: toCounter(row.blks_hit),
      blocksRead: toCounter(row.blks_read),
      // In key order, and only the columns ANALYZE has actually seen: a gap here
      // is what makes the capability panel say "no statistics" instead of
      // inventing a selectivity.
      columnStats: keyColumns
        .map((column) => tableStats?.get(column.name))
        .filter((stats): stats is IndexColumnStats => Boolean(stats)),
    }
  })

  const tables: IndexTableEntry[] = tableResult.rows.map((row) => ({
    table: row.table_name as string,
    // -1 is Postgres's own "never analyzed"; keeping it says so, where 0 would
    // claim an empty table.
    estimatedRows: toNumber(row.est_rows, -1),
    liveTuples: toCounter(row.live_tuples),
    inserted: toCounter(row.n_tup_ins),
    updated: toCounter(row.n_tup_upd),
    hotUpdated: toCounter(row.n_tup_hot_upd),
    deleted: toCounter(row.n_tup_del),
    seqScans: toCounter(row.seq_scans),
    indexScans: toCounter(row.index_scans),
    tableBytes: toNumber(row.table_bytes),
    indexBytes: toNumber(row.index_bytes),
    totalBytes: toNumber(row.total_bytes),
  }))

  const foreignKeys: ForeignKeyColumns[] = fkResult.rows.map((row) => ({
    table: row.table_name as string,
    constraint: row.constraint_name as string,
    columns: toNameArray(row.columns),
  }))

  const statsReset = toIso(resetResult.rows[0]?.stats_reset)

  // The snapshot carries only indexes whose counters were actually collected:
  // storing a zero for an uncounted one would show up later as a plausible flat
  // trend line.
  const perIndex: IndexUsageSample['perIndex'] = {}
  for (const index of indexes) {
    if (index.scans === null || index.tuplesRead === null || index.tuplesFetched === null) continue
    perIndex[index.name] = {
      scans: index.scans,
      tuplesRead: index.tuplesRead,
      tuplesFetched: index.tuplesFetched,
    }
  }

  const { history, note } = await appendIndexSample(schema, {
    takenAt: new Date().toISOString(),
    statsReset,
    perIndex,
  })

  return {
    schema,
    serverVersionNum: version,
    statsReset,
    indexes,
    tables,
    foreignKeys,
    history,
    historyNote: note,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/server/index-usage.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the live check**

Create `tests/live/index-usage.test.ts`, following `tests/live/help-sql.test.ts` for how it connects (`livePreset()`):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { livePreset } from './preset'

/**
 * The read, against a real server. Not part of `npm test`:
 *   npm run test:live -- tests/live/index-usage.test.ts
 *
 * It asserts the statement parses and returns the columns the mapper reads —
 * `indoption`, `indnkeyatts` and `pg_statio_user_indexes` are the parts most
 * likely to be spelled wrong, and a wrong one here is silent in the UI.
 */
describe('the index usage read', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = new pg.Pool({ ...livePreset(), max: 2 })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('returns one row per index in the schema, with order flags and counters', async () => {
    const result = await pool.query(
      `
      SELECT
        index_rel.relname AS index_name,
        x.indnkeyatts,
        (
          SELECT array_agg((opt.value & 1) = 1 ORDER BY opt.ord)
          FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS opt(value, ord)
          WHERE opt.ord <= x.indnkeyatts
        ) AS descending,
        index_stat.idx_tup_read,
        index_io.idx_blks_hit
      FROM pg_index x
      JOIN pg_class index_rel ON index_rel.oid = x.indexrelid
      JOIN pg_class table_rel ON table_rel.oid = x.indrelid
      JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
      LEFT JOIN pg_stat_user_indexes index_stat ON index_stat.indexrelid = x.indexrelid
      LEFT JOIN pg_statio_user_indexes index_io ON index_io.indexrelid = x.indexrelid
      WHERE ns.nspname = 'public' AND table_rel.relkind IN ('r','p')
      LIMIT 5
    `,
    )

    expect(result.rows.length).toBeGreaterThan(0)
    for (const row of result.rows) {
      expect(typeof row.index_name).toBe('string')
      expect(Array.isArray(row.descending)).toBe(true)
      expect(row.descending).toHaveLength(Number(row.indnkeyatts))
    }
  })
})
```

- [ ] **Step 6: Run the live check**

Run: `npm run test:live -- tests/live/index-usage.test.ts`
Expected: PASS. If there is no reachable database, say so and move on — this file is excluded from `npm test` by design.

- [ ] **Step 7: Commit**

```bash
git add src/server/index-usage.ts tests/server/index-usage.test.ts tests/live/index-usage.test.ts
git commit -m "feat(indexes): read index shape, usage and column stats for a schema"
```

---

### Task 8: The server function, the route, and the left rail

**Files:**
- Modify: `src/server/api.ts` (add beside `$getSchemaPressure`, around line 424)
- Create: `src/routes/d/$database/indexes/$schema.tsx`
- Create: `src/components/indexes/IndexList.tsx`
- Test: `tests/components/indexes/IndexList.test.tsx`

**Interfaces:**
- Consumes: `getIndexUsage` (Task 7); `buildIndexRows`, `filterRows`, `sortRows`, `IndexListRow`, `IndexFlag`, `IndexSort` (Task 5); `formatBytes` from `#/lib/pressure/bytes`; `useDatabaseParam` from `#/hooks/useDatabase`; `useConnectionGuard` from `#/hooks/useConnectionGuard`; `Chip`, `TableLink` from `#/components/pressure/PressureSection`.
- Produces: `$getIndexUsage` server function; the route at `/d/$database/indexes/$schema` with a `?index=` search param; `IndexList` component.

The route's structure copies `src/routes/d/$database/pressure/$schema.tsx`: connection guard, a `$getSchemas` lookup to find out whether the schema is a system one, the same "not measured" panel for system schemas, `staleTime: 60_000`, and a re-read button.

- [ ] **Step 1: Add the server function**

In `src/server/api.ts`, add the import beside the existing one:

```ts
import { getIndexUsage } from '#/server/index-usage'
```

and the function immediately after `$getSchemaPressure`:

```ts
/**
 * Everything behind `/d/$database/indexes/$schema`: index shape, usage counters,
 * the tables' write volume and the column statistics, plus the stored history of
 * the counters so a rate can be shown rather than a total. Five catalog and
 * statistics reads, no table data.
 */
export const $getIndexUsage = createServerFn({ method: 'GET' })
  .inputValidator((data: Scoped & { schema?: string }) => data)
  .handler(scoped((data) => getIndexUsage(data.schema)))
```

- [ ] **Step 2: Write the failing test for the rail**

Create `tests/components/indexes/IndexList.test.tsx`. Follow whatever provider wrapper the existing tests under `tests/components/` use (read one first — `TableLink` needs a router context, so the test must render inside the same wrapper those tests use, or pass rows whose rendering avoids it).

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import IndexList from '#/components/indexes/IndexList'
import type { IndexListRow } from '#/lib/indexes/ranking'

function row(overrides: Partial<IndexListRow> = {}): IndexListRow {
  return {
    kind: 'index',
    key: 'orders.orders_customer_idx',
    table: 'orders',
    label: 'orders_customer_idx',
    columns: ['customer_id'],
    bytes: 412 * 1024 * 1024,
    scansPerDay: 0,
    tuplesPerScan: null,
    indexedWrites: 41_000,
    pattern: 'never-scanned',
    flags: ['never-scanned'],
    ...overrides,
  }
}

describe('IndexList', () => {
  it('lists a row with its size and columns', () => {
    render(
      <IndexList
        rows={[row()]}
        selectedKey={null}
        onSelect={() => {}}
        criteria={{ text: '', flags: [] }}
        onCriteriaChange={() => {}}
        sort="size"
        onSortChange={() => {}}
      />,
    )
    expect(screen.getByText('orders_customer_idx')).toBeTruthy()
    expect(screen.getByText('412 MB')).toBeTruthy()
    expect(screen.getByText('(customer_id)')).toBeTruthy()
  })

  it('says a rate is unknown rather than showing zero per day', () => {
    render(
      <IndexList
        rows={[row({ scansPerDay: null })]}
        selectedKey={null}
        onSelect={() => {}}
        criteria={{ text: '', flags: [] }}
        onCriteriaChange={() => {}}
        sort="size"
        onSortChange={() => {}}
      />,
    )
    expect(screen.getByTitle(/no history yet/i)).toBeTruthy()
  })

  it('reports a missing foreign-key index as a gap, not as an index', () => {
    render(
      <IndexList
        rows={[
          row({
            kind: 'missing-fk',
            key: 'payments.payments_order_fk',
            table: 'payments',
            label: 'payments_order_fk',
            columns: ['order_id'],
            bytes: null,
            scansPerDay: null,
            pattern: null,
            flags: ['missing-fk'],
          }),
        ]}
        selectedKey={null}
        onSelect={() => {}}
        criteria={{ text: '', flags: [] }}
        onCriteriaChange={() => {}}
        sort="size"
        onSortChange={() => {}}
      />,
    )
    expect(screen.getByText(/no index/i)).toBeTruthy()
  })

  it('calls back with the row that was clicked', async () => {
    const onSelect = vi.fn()
    render(
      <IndexList
        rows={[row()]}
        selectedKey={null}
        onSelect={onSelect}
        criteria={{ text: '', flags: [] }}
        onCriteriaChange={() => {}}
        sort="size"
        onSortChange={() => {}}
      />,
    )
    screen.getByRole('button', { name: /orders_customer_idx/ }).click()
    expect(onSelect).toHaveBeenCalledWith('orders.orders_customer_idx')
  })

  it('says the list is empty when a filter matched nothing', () => {
    render(
      <IndexList
        rows={[]}
        selectedKey={null}
        onSelect={() => {}}
        criteria={{ text: 'nothing', flags: [] }}
        onCriteriaChange={() => {}}
        sort="size"
        onSortChange={() => {}}
      />,
    )
    expect(screen.getByText(/nothing matches/i)).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/components/indexes/IndexList.test.tsx`
Expected: FAIL — cannot resolve `#/components/indexes/IndexList`.

- [ ] **Step 4: Implement the rail**

Create `src/components/indexes/IndexList.tsx`. `IndexList` is presentational: it takes rows already filtered and sorted, and reports interaction upward, so the page owns the URL state and the component stays testable.

```tsx
import { Chip } from '#/components/pressure/PressureSection'
import { formatBytes } from '#/lib/pressure/bytes'
import type { IndexFlag, IndexListRow, IndexSort, RowCriteria } from '#/lib/indexes/ranking'

/**
 * Every index in the schema, and every foreign key that has none, in one list.
 * A gap and a sprawl are the same kind of decision; putting them in two places
 * hides whichever one you are not looking at.
 *
 * Presentational on purpose: the page owns the filter, the sort and the
 * selection, because all three belong in the URL.
 */

const SORTS: Array<{ value: IndexSort; label: string }> = [
  { value: 'scans-per-day', label: 'scans/day' },
  { value: 'size', label: 'size' },
  { value: 'tuples-per-scan', label: 'entries per scan' },
  { value: 'write-tax', label: 'write tax' },
  { value: 'name', label: 'name' },
]

const FLAGS: Array<{ value: IndexFlag; label: string }> = [
  { value: 'never-scanned', label: 'never scanned' },
  { value: 'redundant', label: 'covered' },
  { value: 'missing-fk', label: 'missing FK index' },
  { value: 'invalid', label: 'invalid' },
  { value: 'partial', label: 'partial' },
  { value: 'unique', label: 'unique' },
  { value: 'non-btree', label: 'not btree' },
]

const PATTERN_LABEL: Record<string, string> = {
  'never-scanned': 'never scanned',
  'point-lookup': 'point lookup',
  'narrow-range': 'narrow range',
  'wide-sweep': 'wide sweep',
  'full-index-read': 'full read',
  unknown: 'not counted',
}

function formatRate(scansPerDay: number | null): { text: string; title: string } {
  if (scansPerDay === null) {
    return { text: '—/d', title: 'No history yet: a rate needs two snapshots of the counters.' }
  }
  if (scansPerDay >= 1_000) {
    return { text: `${Math.round(scansPerDay / 1_000)}k/d`, title: `${Math.round(scansPerDay)} scans a day` }
  }
  if (scansPerDay >= 1) {
    return { text: `${Math.round(scansPerDay)}/d`, title: `${Math.round(scansPerDay)} scans a day` }
  }
  return { text: '<1/d', title: `${scansPerDay.toFixed(2)} scans a day` }
}

export default function IndexList({
  rows,
  selectedKey,
  onSelect,
  criteria,
  onCriteriaChange,
  sort,
  onSortChange,
}: {
  rows: IndexListRow[]
  selectedKey: string | null
  onSelect: (key: string) => void
  criteria: RowCriteria
  onCriteriaChange: (criteria: RowCriteria) => void
  sort: IndexSort
  onSortChange: (sort: IndexSort) => void
}) {
  const toggleFlag = (flag: IndexFlag) => {
    const flags = criteria.flags.includes(flag)
      ? criteria.flags.filter((entry) => entry !== flag)
      : [...criteria.flags, flag]
    onCriteriaChange({ ...criteria, flags })
  }

  return (
    <div className="island-shell flex min-h-0 flex-col rounded-xl">
      <div className="space-y-2 border-b border-[var(--line)] px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={criteria.text}
            onChange={(event) => onCriteriaChange({ ...criteria, text: event.target.value })}
            placeholder="index, table or column"
            aria-label="Filter indexes"
            className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs text-[var(--sea-ink)]"
          />
          <label className="flex items-center gap-1 text-[10px] text-[var(--sea-ink-soft)]">
            sort
            <select
              value={sort}
              onChange={(event) => onSortChange(event.target.value as IndexSort)}
              aria-label="Sort indexes"
              className="rounded border border-[var(--line)] bg-transparent px-1 py-0.5 text-[11px] text-[var(--sea-ink)]"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-1">
          {FLAGS.map((flag) => {
            const active = criteria.flags.includes(flag.value)
            return (
              <button
                key={flag.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleFlag(flag.value)}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  active
                    ? 'bg-[var(--lagoon-deep)] text-white'
                    : 'border border-[var(--line)] text-[var(--sea-ink-soft)] hover:bg-[rgba(79,184,178,0.1)]'
                }`}
              >
                {flag.label}
              </button>
            )
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-[var(--sea-ink-soft)]">
          Nothing matches that filter.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((row) => {
            const rate = formatRate(row.scansPerDay)
            const selected = row.key === selectedKey
            return (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => onSelect(row.key)}
                  aria-current={selected}
                  className={`flex w-full flex-col gap-0.5 border-b border-[var(--line)] px-3 py-1.5 text-left ${
                    selected ? 'bg-[rgba(79,184,178,0.12)]' : 'hover:bg-[rgba(79,184,178,0.06)]'
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--sea-ink)]">
                      {row.label}
                    </span>
                    {row.kind === 'missing-fk' ? (
                      <Chip tone="warn">no index</Chip>
                    ) : (
                      <>
                        <span
                          title={rate.title}
                          className="tabular-nums text-[10px] text-[var(--sea-ink-soft)]"
                        >
                          {rate.text}
                        </span>
                        <span className="tabular-nums text-[10px] font-medium text-[var(--sea-ink)]">
                          {row.bytes === null ? '—' : formatBytes(row.bytes)}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-[10px] text-[var(--sea-ink-soft)]">
                    <span className="font-mono">{row.table}</span>
                    <span className="font-mono">({row.columns.join(', ')})</span>
                    {row.pattern && row.pattern !== 'unknown' && (
                      <Chip>{PATTERN_LABEL[row.pattern]}</Chip>
                    )}
                    {row.flags.includes('invalid') && <Chip tone="bad">invalid</Chip>}
                    {row.flags.includes('redundant') && <Chip tone="warn">covered</Chip>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run the rail tests**

Run: `npx vitest run tests/components/indexes/IndexList.test.tsx`
Expected: PASS.

- [ ] **Step 6: Create the page, rail only**

Create `src/routes/d/$database/indexes/$schema.tsx`. The detail pane arrives in Task 9 — for now it renders a placeholder-free "pick an index" prompt.

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import IndexList from '#/components/indexes/IndexList'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { $getIndexUsage, $getSchemas } from '#/server/api'
import { buildIndexRows, filterRows, sortRows, type IndexFlag, type IndexSort } from '#/lib/indexes/ranking'
import { formatBytes } from '#/lib/pressure/bytes'
import { formatRelativeTime } from '#/lib/inspect/format'

/**
 * What every index in this schema costs, what the counters say it serves, and
 * what its shape unlocks. Catalog and statistics reads only — the page costs the
 * same on a 1.8 TB schema as on an empty one, and it never plans a statement.
 *
 * The selection, the filter and the sort live in the URL: a finding is worth
 * sending to someone.
 */
export const Route = createFileRoute('/d/$database/indexes/$schema')({
  validateSearch: (search: Record<string, unknown>) => ({
    index: typeof search.index === 'string' ? search.index : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
    sort: typeof search.sort === 'string' ? (search.sort as IndexSort) : undefined,
    flags: typeof search.flags === 'string' ? search.flags : undefined,
  }),
  component: IndexesPage,
})

function IndexesPage() {
  const database = useDatabaseParam()
  const { schema } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { isChecking, isConnected } = useConnectionGuard()

  // Whether Postgres keeps this schema to itself is the server's answer, not a
  // name this page recognises.
  const schemasQuery = useQuery({
    queryKey: ['schemas', database],
    queryFn: () => $getSchemas({ data: { database } }),
    staleTime: Infinity,
  })
  const isSystem =
    schemasQuery.data?.find((entry) => entry.name === schema)?.isSystem ?? false

  const usageQuery = useQuery({
    queryKey: ['indexUsage', database, schema],
    queryFn: () => $getIndexUsage({ data: { database, schema } }),
    enabled: isConnected && !isSystem && schemasQuery.isSuccess,
    // Counters move, and every read may also take a snapshot; a minute makes
    // tab-switching cheap without making the trend stand still.
    staleTime: 60_000,
  })

  const criteria = {
    text: search.q ?? '',
    flags: (search.flags ? search.flags.split(',') : []) as IndexFlag[],
  }
  const sort: IndexSort = search.sort ?? 'scans-per-day'

  const rows = useMemo(
    () => (usageQuery.data ? buildIndexRows(usageQuery.data) : []),
    [usageQuery.data],
  )
  const visible = useMemo(() => sortRows(filterRows(rows, criteria), sort), [rows, criteria, sort])

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  // The counters come from `pg_stat_user_*`, and `user` means "not system":
  // every number would read zero for pg_catalog, which is a page of confident
  // wrong answers rather than an empty one.
  if (isSystem) {
    return (
      <main className="px-4 pb-8 pt-6">
        <div className="mx-auto max-w-2xl space-y-2">
          <p className="island-kicker">Indexes</p>
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            Not measured for {schema}
          </h1>
          <p className="text-sm leading-relaxed text-[var(--sea-ink-soft)]">
            Index usage is counted in the <code>pg_stat_user_*</code> views, which
            by definition hold nothing for Postgres&rsquo;s own schemas. Browse{' '}
            {schema} from the table list instead.
          </p>
        </div>
      </main>
    )
  }

  const usage = usageQuery.data
  const totalBytes = rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0)

  return (
    <main className="flex h-[calc(100vh-var(--header-h,3rem))] flex-col gap-3 px-4 pb-4 pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="island-kicker">Indexes</p>
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            <span className="text-[var(--sea-ink-soft)]">{schema}</span> — what each one
            costs and what it serves
          </h1>
        </div>
        {usage && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            {usage.indexes.length} indexes · {formatBytes(totalBytes)} · counters reset{' '}
            {usage.statsReset
              ? formatRelativeTime(usage.statsReset, Date.now())
              : 'never (unknown)'}
          </p>
        )}
        <button
          type="button"
          onClick={() => usageQuery.refetch()}
          disabled={usageQuery.isFetching}
          className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)] disabled:opacity-50"
        >
          {usageQuery.isFetching ? 'reading…' : '↻ re-read'}
        </button>
      </div>

      {usageQuery.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          Could not read the index statistics: {String(usageQuery.error)}
        </div>
      )}

      {usage?.historyNote && (
        <p className="text-[11px] text-[var(--sea-ink-soft)]">{usage.historyNote}</p>
      )}

      {usageQuery.isLoading && !usage && (
        <div className="island-shell h-64 animate-pulse rounded-xl" />
      )}

      {usage && (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <IndexList
            rows={visible}
            selectedKey={search.index ?? null}
            onSelect={(key) => navigate({ search: (old) => ({ ...old, index: key }) })}
            criteria={criteria}
            onCriteriaChange={(next) =>
              navigate({
                search: (old) => ({
                  ...old,
                  q: next.text === '' ? undefined : next.text,
                  flags: next.flags.length === 0 ? undefined : next.flags.join(','),
                }),
              })
            }
            sort={sort}
            onSortChange={(next) => navigate({ search: (old) => ({ ...old, sort: next }) })}
          />
          <div className="island-shell flex items-center justify-center rounded-xl p-6 text-sm text-[var(--sea-ink-soft)]">
            Pick an index to see what it costs and what it serves.
          </div>
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 7: Regenerate the route tree and check the page loads**

Run: `npx tsc --noEmit` (the route tree is generated by the router plugin during `npm run dev`/`build`; if `src/routeTree.gen.ts` has no entry for the new route yet, run `npm run build` once to regenerate it, then re-run `tsc`).
Then run `npm run dev` and open `/d/<database>/indexes/public`.
Expected: the rail lists indexes; filtering, sorting and selecting all change the URL.

- [ ] **Step 8: Commit**

```bash
git add src/server/api.ts src/routes/d/\$database/indexes src/components/indexes tests/components/indexes src/routeTree.gen.ts
git commit -m "feat(indexes): add the index inspector page and its ranked rail"
```

---

### Task 9: The detail pane

**Files:**
- Create: `src/components/indexes/Sparkline.tsx`
- Create: `src/components/indexes/IndexDetail.tsx`
- Modify: `src/routes/d/$database/indexes/$schema.tsx` (replace the "pick an index" panel)
- Test: `tests/components/indexes/IndexDetail.test.tsx`

**Interfaces:**
- Consumes: `classifyAccess` (Task 1), `describeCapability` (Task 2), `writeTax` (Task 3), `indexTrend` (Task 4), `enforcesConstraint` and `createFkIndexSql` from `#/lib/pressure/index-audit`, `CopyButton` from `#/components/CopyButton`.
- Produces: `IndexDetail` taking `{ usage: SchemaIndexUsage; selectedKey: string }`, and `Sparkline` taking `{ values: number[]; label: string }`.

**Hard constraint:** no `DROP INDEX` text. The "standing" block states in prose what dropping would take with it. The only SQL offered is `createFkIndexSql` on a missing-FK gap.

- [ ] **Step 1: Write the failing test**

Create `tests/components/indexes/IndexDetail.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import IndexDetail from '#/components/indexes/IndexDetail'
import type { SchemaIndexUsage } from '#/lib/types'

function usage(overrides: Partial<SchemaIndexUsage> = {}): SchemaIndexUsage {
  return {
    schema: 'public',
    serverVersionNum: 150015,
    statsReset: '2026-08-01T00:00:00.000Z',
    indexes: [
      {
        table: 'orders',
        name: 'orders_customer_idx',
        method: 'btree',
        definition:
          'CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id)',
        keyColumns: [{ name: 'customer_id', descending: false, nullsFirst: false }],
        includeColumns: [],
        predicate: null,
        isUnique: false,
        isPrimary: false,
        isPartial: false,
        hasExpression: false,
        constraintBacked: false,
        isValid: true,
        isReady: true,
        bytes: 400,
        scans: 0,
        tuplesRead: 0,
        tuplesFetched: 0,
        blocksHit: 0,
        blocksRead: 0,
        columnStats: [
          { column: 'customer_id', nDistinct: 50_000, correlation: 0.01, nullFraction: 0, averageWidth: 8 },
        ],
      },
    ],
    tables: [
      {
        table: 'orders',
        estimatedRows: 1_000_000,
        liveTuples: 1_000_000,
        inserted: 100,
        updated: 50,
        hotUpdated: 20,
        deleted: 10,
        seqScans: 1,
        indexScans: 9,
        tableBytes: 1_600,
        indexBytes: 400,
        totalBytes: 2_000,
      },
    ],
    foreignKeys: [],
    history: [],
    historyNote: null,
    ...overrides,
  }
}

describe('IndexDetail', () => {
  it('shows the definition and the size', () => {
    render(<IndexDetail usage={usage()} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/CREATE INDEX orders_customer_idx/)).toBeTruthy()
    expect(screen.getByText('400 B')).toBeTruthy()
  })

  it('never offers a DROP statement', () => {
    const { container } = render(
      <IndexDetail usage={usage()} selectedKey="orders.orders_customer_idx" />,
    )
    expect(container.textContent).not.toMatch(/DROP/i)
  })

  it('says an index nothing has read enforces nothing either', () => {
    render(<IndexDetail usage={usage()} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/never scanned/i)).toBeTruthy()
    expect(screen.getByText(/enforces nothing/i)).toBeTruthy()
  })

  it('warns that dropping a unique index takes its constraint with it', () => {
    const unique = usage()
    unique.indexes[0].isUnique = true
    render(<IndexDetail usage={unique} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/would drop the constraint/i)).toBeTruthy()
  })

  it('states the rows a single value is expected to match', () => {
    render(<IndexDetail usage={usage()} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/~20 rows/)).toBeTruthy()
  })

  it('says there is no history rather than drawing a flat line', () => {
    render(<IndexDetail usage={usage()} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/no history yet/i)).toBeTruthy()
  })

  it('shouts about an invalid index', () => {
    const broken = usage()
    broken.indexes[0].isValid = false
    render(<IndexDetail usage={broken} selectedKey="orders.orders_customer_idx" />)
    expect(screen.getByText(/not valid/i)).toBeTruthy()
  })

  it('offers CREATE INDEX for a foreign key with none', () => {
    render(
      <IndexDetail
        usage={usage({
          indexes: [],
          foreignKeys: [
            { table: 'payments', constraint: 'payments_order_fk', columns: ['order_id'] },
          ],
        })}
        selectedKey="payments.payments_order_fk"
      />,
    )
    expect(screen.getByText(/CREATE INDEX CONCURRENTLY/)).toBeTruthy()
  })

  it('says so when the selection is not in the payload', () => {
    render(<IndexDetail usage={usage()} selectedKey="orders.gone_idx" />)
    expect(screen.getByText(/no longer in this schema/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/components/indexes/IndexDetail.test.tsx`
Expected: FAIL — cannot resolve `#/components/indexes/IndexDetail`.

- [ ] **Step 3: Implement the sparkline**

Create `src/components/indexes/Sparkline.tsx`:

```tsx
/**
 * A series, drawn small. Inline SVG rather than a chart library: it is a
 * polyline, and a dependency for a polyline is a dependency to keep up to date
 * forever.
 *
 * A single point is drawn as a dot — a line needs two, and stretching one across
 * the box would claim a trend that has not been measured.
 */
export default function Sparkline({
  values,
  label,
  width = 120,
  height = 24,
}: {
  values: number[]
  /** Read out to assistive tech, since the shape is not available to it. */
  label: string
  width?: number
  height?: number
}) {
  if (values.length === 0) return null

  const max = Math.max(...values, 1)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const y = (value: number) => height - (value / max) * (height - 2) - 1

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="overflow-visible text-[var(--lagoon-deep)]"
    >
      {values.length === 1 ? (
        <circle cx={width / 2} cy={y(values[0])} r={2} fill="currentColor" />
      ) : (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          points={values.map((value, i) => `${i * step},${y(value)}`).join(' ')}
        />
      )}
    </svg>
  )
}
```

- [ ] **Step 4: Implement the detail pane**

Create `src/components/indexes/IndexDetail.tsx`:

```tsx
import CopyButton from '#/components/CopyButton'
import Sparkline from '#/components/indexes/Sparkline'
import { Chip, TableLink } from '#/components/pressure/PressureSection'
import { describeCapability } from '#/lib/indexes/capability'
import { classifyAccess } from '#/lib/indexes/shape'
import { indexTrend } from '#/lib/indexes/trend'
import { indexedWrites, writeTax } from '#/lib/indexes/write-tax'
import { createFkIndexSql, enforcesConstraint } from '#/lib/pressure/index-audit'
import { formatBytes } from '#/lib/pressure/bytes'
import type { IndexUsageEntry, SchemaIndexUsage } from '#/lib/types'

/**
 * One index, argued from its numbers: what it is, what has been read through it,
 * whether that is rising, what its shape unlocks, and what it costs.
 *
 * No DROP statement is offered anywhere. Whether an index should go is a
 * judgement with a production lock behind it; the page's job is to give the
 * reader every number that judgement needs and say what dropping would take with
 * it — not to hand over the statement.
 */

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`
}

function rows(value: number | null): string {
  if (value === null) return 'unknown'
  if (value < 10) return `~${value.toFixed(1)} rows`
  return `~${Math.round(value).toLocaleString()} rows`
}

const PATTERN_SENTENCE: Record<string, string> = {
  'never-scanned': 'Never scanned since the counters were reset.',
  'point-lookup': 'Point lookups: a scan walks about one entry.',
  'narrow-range': 'Bounded ranges: a scan walks a handful of entries.',
  'wide-sweep': 'Wide sweeps: a scan walks many entries at a time.',
  'full-index-read': 'Whole-index reads: a scan touches much of the table.',
  unknown: 'Not counted: the statistics have no usable figures for this index.',
}

export default function IndexDetail({
  usage,
  selectedKey,
}: {
  usage: SchemaIndexUsage
  selectedKey: string
}) {
  const index = usage.indexes.find((entry) => `${entry.table}.${entry.name}` === selectedKey)
  if (index) return <IndexBlocks usage={usage} index={index} />

  const gap = usage.foreignKeys.find((fk) => `${fk.table}.${fk.constraint}` === selectedKey)
  if (gap) {
    return (
      <div className="island-shell space-y-3 rounded-xl p-4">
        <div>
          <p className="island-kicker">Foreign key with no index</p>
          <h2 className="font-mono text-sm text-[var(--sea-ink)]">{gap.constraint}</h2>
        </div>
        <p className="text-[11px] leading-relaxed text-[var(--sea-ink-soft)]">
          Postgres indexes the referenced side of a foreign key automatically and the
          referencing side never. Until one exists, a join through{' '}
          <span className="font-mono">({gap.columns.join(', ')})</span> and every parent
          delete has to scan <TableLink schema={usage.schema} table={gap.table} />.
        </p>
        <pre className="overflow-x-auto rounded bg-[rgba(23,58,64,0.06)] p-2 text-[11px] text-[var(--sea-ink)]">
          {createFkIndexSql(usage.schema, gap)}
        </pre>
        <CopyButton text={createFkIndexSql(usage.schema, gap)} label="Copy CREATE INDEX" />
      </div>
    )
  }

  return (
    <div className="island-shell flex items-center justify-center rounded-xl p-6 text-sm text-[var(--sea-ink-soft)]">
      That index is no longer in this schema — it may have been dropped since the page
      was read.
    </div>
  )
}

function IndexBlocks({
  usage,
  index,
}: {
  usage: SchemaIndexUsage
  index: IndexUsageEntry
}) {
  const table = usage.tables.find((entry) => entry.table === index.table) ?? null
  const shape = classifyAccess(index, table)
  const capability = describeCapability(index, table)
  const indexesOnTable = usage.indexes.filter((entry) => entry.table === index.table).length
  const tax = writeTax(index, table, indexesOnTable)
  const trend = indexTrend(usage.history, index.name)

  return (
    <div className="island-shell min-h-0 space-y-4 overflow-y-auto rounded-xl p-4">
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-mono text-sm text-[var(--sea-ink)]">{index.name}</h2>
          <span className="tabular-nums text-[11px] font-medium text-[var(--sea-ink)]">
            {formatBytes(index.bytes)}
          </span>
          <TableLink schema={usage.schema} table={index.table} />
          {index.isPrimary && <Chip>primary key</Chip>}
          {index.isUnique && !index.isPrimary && <Chip>unique</Chip>}
          {index.method !== 'btree' && <Chip>{index.method}</Chip>}
          {index.isPartial && <Chip tone="warn">partial</Chip>}
        </div>
        {!index.isValid && (
          <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            This index is not valid — the usual cause is a CREATE INDEX CONCURRENTLY that
            failed. The planner will not use it, and every write to{' '}
            <span className="font-mono">{index.table}</span> still maintains it.
          </p>
        )}
        <pre className="overflow-x-auto rounded bg-[rgba(23,58,64,0.06)] p-2 text-[11px] text-[var(--sea-ink)]">
          {index.definition}
        </pre>
        <CopyButton text={index.definition} label="Copy definition" />
      </section>

      <Block title="Access" note={`Counters are cumulative since the last reset${usage.statsReset ? ` (${usage.statsReset.slice(0, 10)})` : ''}.`}>
        <p className="text-[11px] text-[var(--sea-ink)]">{PATTERN_SENTENCE[shape.pattern]}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
          <Figure label="scans" value={shape.scans === null ? 'not counted' : shape.scans.toLocaleString()} />
          <Figure
            label="entries per scan"
            value={shape.tuplesPerScan === null ? '—' : shape.tuplesPerScan.toFixed(1)}
          />
          <Figure
            label="heap fetches"
            value={percent(shape.heapFetchRatio)}
            title="Share of index entries followed to the heap. Near 0% means the index is answering on its own."
          />
          <Figure label="cache hit" value={percent(shape.cacheHitRatio)} />
        </dl>
      </Block>

      <Block
        title="Trend"
        note="Scans per day, from the snapshots stored under local/. A cumulative counter cannot tell you about now."
      >
        {trend.empty ? (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            No history yet — a rate needs two snapshots, and one is taken every fifteen
            minutes this page is opened.
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <Sparkline
              values={trend.points.map((point) => point.scansPerDay)}
              label={`Scans per day over ${trend.windowDays?.toFixed(1)} days`}
            />
            <p className="text-[11px] text-[var(--sea-ink)]">
              {Math.round(trend.scansPerDay ?? 0).toLocaleString()} scans a day over{' '}
              {trend.windowDays?.toFixed(1)} days
              {trend.discontinuities > 0 &&
                ` · ${trend.discontinuities} gap${trend.discontinuities === 1 ? '' : 's'} where the counters restarted`}
            </p>
          </div>
        )}
      </Block>

      <Block title="Unlocks" note="Read from the key shape and the last ANALYZE — what it can serve, whether or not it has.">
        <ul className="space-y-1 text-[11px] text-[var(--sea-ink)]">
          {capability.equalityColumns.map((lookup) => (
            <li key={lookup.column}>
              <span className="font-mono">= {lookup.column}</span>{' '}
              <span className="text-[var(--sea-ink-soft)]">
                → {rows(lookup.estimatedRowsPerValue)} per value
              </span>
            </li>
          ))}
          {capability.sortOrders.map((order) => (
            <li key={order} className="text-[var(--sea-ink-soft)]">
              sorted by <span className="font-mono text-[var(--sea-ink)]">{order}</span>
            </li>
          ))}
          {capability.indexOnlyEligible && (
            <li className="text-[var(--sea-ink-soft)]">
              can answer without the heap for{' '}
              <span className="font-mono text-[var(--sea-ink)]">
                {capability.coveredColumns.join(', ')}
              </span>
            </li>
          )}
          {capability.restrictedTo && (
            <li className="text-[var(--sea-ink-soft)]">
              only the rows where{' '}
              <span className="font-mono text-[var(--sea-ink)]">{capability.restrictedTo}</span>
            </li>
          )}
        </ul>
        {capability.notes.length > 0 && (
          <ul className="space-y-1 text-[10px] text-[var(--sea-ink-soft)]">
            {capability.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Cost and standing" note="Every insert, delete and non-HOT update on the table has to be written into this index too.">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
          <Figure label="size" value={formatBytes(index.bytes)} />
          <Figure
            label="share of table"
            value={percent(tax.byteShare)}
            title={
              tax.tableTotalBytes === null
                ? undefined
                : `of ${formatBytes(tax.tableTotalBytes)} for the table, its indexes and its TOAST`
            }
          />
          <Figure
            label="indexed writes"
            value={
              tax.indexedWrites === null ? 'not counted' : tax.indexedWrites.toLocaleString()
            }
            title="Inserts, deletes and updates that could not stay on their page — each one maintains every index on the table."
          />
          <Figure label="indexes on the table" value={String(tax.indexCount)} />
        </dl>
        <p className="text-[11px] leading-relaxed text-[var(--sea-ink-soft)]">
          {enforcesConstraint({
            table: index.table,
            name: index.name,
            method: index.method,
            keyColumns: index.keyColumns.map((column) => column.name),
            isUnique: index.isUnique,
            isPrimary: index.isPrimary,
            isPartial: index.isPartial,
            hasExpression: index.hasExpression,
            constraintBacked: index.constraintBacked,
            scans: index.scans,
            bytes: index.bytes,
          })
            ? 'Removing this index would drop the constraint it enforces — a unique or primary key is not dead weight even when nothing scans it.'
            : 'This index enforces nothing, so removing it would cost only the lookups it serves.'}
        </p>
        {tax.seqScanShare !== null && tax.seqScanShare > 0.5 && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            {percent(tax.seqScanShare)} of scans of{' '}
            <span className="font-mono">{index.table}</span> are sequential — the planner
            is mostly not reaching for any index on it.
          </p>
        )}
        {indexedWrites(table) === 0 && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            No writes have been counted on this table since the reset, so the write cost
            above is a floor, not a measurement.
          </p>
        )}
      </Block>
    </div>
  )
}

function Block({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-1.5 border-t border-[var(--line)] pt-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
        {title}
      </h3>
      <p className="text-[11px] text-[var(--sea-ink-soft)]">{note}</p>
      {children}
    </section>
  )
}

function Figure({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}) {
  return (
    <div title={title}>
      <dt className="text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">{label}</dt>
      <dd className="tabular-nums text-[var(--sea-ink)]">{value}</dd>
    </div>
  )
}
```

- [ ] **Step 5: Wire it into the page**

In `src/routes/d/$database/indexes/$schema.tsx`, import `IndexDetail` and replace the placeholder panel:

```tsx
          {search.index ? (
            <IndexDetail usage={usage} selectedKey={search.index} />
          ) : (
            <div className="island-shell flex items-center justify-center rounded-xl p-6 text-sm text-[var(--sea-ink-soft)]">
              Pick an index to see what it costs and what it serves.
            </div>
          )}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/components/indexes/ && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Look at it**

Run `npm run dev`, open `/d/<database>/indexes/public`, select the largest index and the smallest, and one foreign-key gap. Confirm: no `DROP` anywhere on the page, the trend says "no history yet" on a first read, and an index whose counters are absent says "not counted" rather than zero.

- [ ] **Step 8: Commit**

```bash
git add src/components/indexes src/routes/d/\$database/indexes tests/components/indexes
git commit -m "feat(indexes): inspect one index — access, trend, capability, cost"
```

---

### Task 10: Reachable from the app

**Files:**
- Modify: `src/lib/menu-routes.ts:11`
- Modify: `src/lib/lens-links.ts:41` (the `schemaFromPathname` regex)
- Modify: `src/components/Header.tsx` (after the "Schema pressure" link, around line 307)
- Test: `tests/lib/menu-routes.test.ts`, `tests/lib/lens-links.test.ts` (extend both)

**Interfaces:**
- Consumes: the route from Task 8.
- Produces: nothing new — the page becomes reachable, and switching schema keeps you on it.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/menu-routes.test.ts`:

```ts
  it('marks the menu when the index inspector is the selected route', () => {
    expect(menuHoldsRoute('/d/reporting/indexes/public')).toBe(true)
  })

  it('does not mistake a route that merely starts with the same letters', () => {
    expect(menuHoldsRoute('/d/reporting/indexescape/public')).toBe(false)
  })
```

Add to `tests/lib/lens-links.test.ts`:

```ts
  it('reads the schema out of an index inspector URL', () => {
    expect(schemaFromPathname('/d/reporting/indexes/aggs_staged')).toBe('aggs_staged')
  })
```

(Import `schemaFromPathname` in that file if it is not already imported.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/lib/menu-routes.test.ts tests/lib/lens-links.test.ts`
Expected: FAIL on both new cases.

- [ ] **Step 3: Make the two libs know the route**

`src/lib/menu-routes.ts`:

```ts
const DATABASE_ROUTES = ['/queries', '/pressure', '/indexes'] as const
```

`src/lib/lens-links.ts`, in `schemaFromPathname`:

```ts
  const match = rest.match(/^\/(?:t|lens|pressure|indexes)\/([^/]+)/)
```

- [ ] **Step 4: Add the menu entry**

In `src/components/Header.tsx`, directly after the "Schema pressure" `Link` block:

```tsx
          {database && schema && (
            <Link
              to="/d/$database/indexes/$schema"
              params={{ database, schema }}
              role="menuitem"
              className={MENU_ITEM_CLASS}
              activeProps={{ className: MENU_ITEM_ACTIVE_CLASS }}
            >
              Indexes
              <span className={MENU_HINT_CLASS}>
                What each index costs, and what the counters say it serves
              </span>
            </Link>
          )}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/lib/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Check it by hand**

`npm run dev` → open the header menu on a table page, follow "Indexes", then switch schema in the schema picker. Expected: you stay on the index page, now reading the other schema.

- [ ] **Step 7: Commit**

```bash
git add src/lib/menu-routes.ts src/lib/lens-links.ts src/components/Header.tsx tests/lib/menu-routes.test.ts tests/lib/lens-links.test.ts
git commit -m "feat(indexes): reach the inspector from the menu and keep it on schema switch"
```

---

### Task 11: The help topic

**Files:**
- Create: `src/lib/help/topics/index-usage.ts`
- Create: `src/components/help/previews/IndexUsagePreview.tsx`
- Modify: `src/lib/help/index.ts` (import + registry entry, in the "Performance and cost" group)
- Modify: `src/components/help/previews/index.ts` (import + `HELP_PREVIEWS` entry)

**Interfaces:**
- Consumes: `HelpTopic` from `#/lib/help/types`; the SQL from Task 7.
- Produces: `indexUsageTopic`, `IndexUsagePreview`.

**Rules for this task:**
- `steps[].clause` fragments joined with `\n` must form the **real statement**, because `tests/live/help-sql.test.ts` PREPAREs every topic's SQL against the server. Copy the index statement from `src/server/index-usage.ts` verbatim and split it into clauses; do not paraphrase it.
- `source.line` must be the line in `src/server/index-usage.ts` where that statement starts, and `source.anchor` a distinctive line of it (`FROM pg_index x`). Read the file and use the real number.
- Model the topic on `src/lib/help/topics/index-audit.ts`; every field of `HelpTopic` is required, including `terms` and `cost`.
- Mock elements in the preview carry `data-step-id` (or whatever `src/components/help/highlight.tsx` expects — read it) matching `steps[].id`, so a clause lights up the pixels it produced. Read `IndexAuditPreview.tsx` and follow it exactly.

- [ ] **Step 1: Write the topic**

Create `src/lib/help/topics/index-usage.ts`. The `clause` fragments joined with `\n` must be the statement from `src/server/index-usage.ts` **character for character** — `tests/live/help-sql.test.ts` PREPAREs it against the server, and a paraphrase fails there. Read the real statement and check the split below against it before committing.

For `source.line`, run `grep -n "FROM pg_index x" src/server/index-usage.ts` and use the line the `SELECT` of that statement starts on.

```ts
import type { HelpTopic } from '#/lib/help/types'

/**
 * The index usage read. What each index *is* comes from the catalog; what it has
 * *served* comes from two statistics views; what a value costs to look up comes
 * from the last ANALYZE. The steps here explain what is fetched — the rules that
 * turn those numbers into a verdict live in `lib/indexes/*` and get their own
 * prose.
 */
export const indexUsageTopic: HelpTopic = {
  id: 'index-usage',
  section: 'Performance and cost',
  title: 'Index usage',
  question: 'What is each index doing for me, and what is it costing?',
  answer:
    'Postgres counts three things per index: how many scans started, how many index entries those scans read, and how many heap rows the entries were followed to. The ratios between them are the shape of the access — about one entry per scan is a point lookup, a million is a sweep, and entries that are never followed to the heap mean the index answered on its own. The counters are cumulative since the statistics were last reset, so this page also stores a snapshot of them every fifteen minutes under local/, which is what turns a running total into "read forty times a day".',
  route: '/indexes/$schema',
  previewCaption:
    'The rail ranks every index; the detail argues one of them from its numbers. Hover a clause to see the figure it produced.',
  source: {
    file: 'src/server/index-usage.ts',
    line: 0, // replace with the line `grep -n "FROM pg_index x"` reports for the SELECT
    anchor: 'FROM pg_index x',
  },
  prerequisite: null,
  steps: [
    {
      id: 'select-shape',
      clause: `SELECT
        table_rel.relname   AS table_name,
        index_rel.relname   AS index_name,
        access_method.amname AS method,
        pg_get_indexdef(x.indexrelid) AS definition,
        pg_get_expr(x.indpred, x.indrelid) AS predicate,`,
      title: 'Which index, on which table, written out',
      detail:
        'An index has a name, a table and an access method — btree for almost everything, gin for arrays and full text, and a few others. `pg_get_indexdef` hands back the CREATE INDEX statement Postgres would write for it, which is the definition you can read and copy rather than one this app rebuilt and might rebuild wrongly. `pg_get_expr` prints the WHERE clause of a partial index in the same way.',
    },
    {
      id: 'flags',
      clause: `        x.indisunique   AS is_unique,
        x.indisprimary  AS is_primary,
        x.indisvalid    AS is_valid,
        x.indisready    AS is_ready,
        x.indpred IS NOT NULL  AS is_partial,
        x.indexprs IS NOT NULL AS has_expression,
        EXISTS (
          SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
        ) AS constraint_backed,`,
      title: 'What it enforces, and whether it works at all',
      detail:
        'A unique or primary-key index is not spare weight even if nothing scans it: it is how the constraint is enforced, and dropping it drops the constraint. `indisvalid` is the one to watch — a CREATE INDEX CONCURRENTLY that failed leaves an index behind that the planner refuses to use while every write still maintains it. The EXISTS asks whether some constraint points at this index, which is the difference between "unused" and "safe to remove".',
    },
    {
      id: 'counters',
      clause: `        pg_relation_size(x.indexrelid) AS bytes,
        index_stat.idx_scan      AS scans,
        index_stat.idx_tup_read  AS tup_read,
        index_stat.idx_tup_fetch AS tup_fetch,
        index_io.idx_blks_hit    AS blks_hit,
        index_io.idx_blks_read   AS blks_read,`,
      title: 'What it costs, and what has been read through it',
      detail:
        '`pg_relation_size` is the disk the index occupies. The three counters are the interesting part: scans started, index entries read, heap rows fetched. Entries divided by scans says how wide a typical scan is; fetches divided by entries says how often the index had to go to the table anyway. The two block counters say whether those reads came from memory or from disk.',
    },
    {
      id: 'key-columns',
      clause: `        (
          SELECT array_agg(COALESCE(att.attname, '(expr)')::text ORDER BY k.ord)
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          LEFT JOIN pg_attribute att
            ON att.attrelid = x.indrelid AND att.attnum = k.attnum AND k.attnum > 0
          WHERE k.ord <= x.indnkeyatts
        ) AS key_columns,
        (
          SELECT array_agg(COALESCE(att.attname, '(expr)')::text ORDER BY k.ord)
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          LEFT JOIN pg_attribute att
            ON att.attrelid = x.indrelid AND att.attnum = k.attnum AND k.attnum > 0
          WHERE k.ord > x.indnkeyatts
        ) AS include_columns,`,
      title: 'Key columns, and the columns merely carried along',
      detail:
        '`indkey` is the list of column numbers, in the order they were declared — and order is everything for an index, since only the leading columns can be looked up by. `indnkeyatts` says how many of them are actually part of the key: anything past that came from an INCLUDE clause and is carried in the leaf pages so a query can read it without visiting the table, but cannot be searched on. A position with no column number is an expression, and is reported as `(expr)` rather than guessed at.',
    },
    {
      id: 'order-flags',
      clause: `        (
          SELECT array_agg((opt.value & 1) = 1 ORDER BY opt.ord)
          FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS opt(value, ord)
          WHERE opt.ord <= x.indnkeyatts
        ) AS descending,
        (
          SELECT array_agg((opt.value & 2) = 2 ORDER BY opt.ord)
          FROM unnest(x.indoption::int2[]) WITH ORDINALITY AS opt(value, ord)
          WHERE opt.ord <= x.indnkeyatts
        ) AS nulls_first`,
      title: 'Which direction each column is stored in',
      detail:
        '`indoption` holds one small integer per key column, and its bits are the order the column was declared with: bit 0 set means DESC, bit 1 set means NULLS FIRST. It matters because a btree index can be read forwards or backwards but not re-sorted — an index on (a, b DESC) satisfies ORDER BY a, b DESC and its exact mirror, and nothing else. Reading the bits is how that is known as data rather than by parsing the definition text.',
    },
    {
      id: 'joins',
      clause: `      FROM pg_index x
      JOIN pg_class index_rel ON index_rel.oid = x.indexrelid
      JOIN pg_class table_rel ON table_rel.oid = x.indrelid
      JOIN pg_namespace ns ON ns.oid = table_rel.relnamespace
      JOIN pg_am access_method ON access_method.oid = index_rel.relam
      LEFT JOIN pg_stat_user_indexes index_stat ON index_stat.indexrelid = x.indexrelid
      LEFT JOIN pg_statio_user_indexes index_io ON index_io.indexrelid = x.indexrelid`,
      title: 'Where all of that lives',
      detail:
        '`pg_index` has one row per index; `pg_class` names both the index and its table, `pg_namespace` the schema, `pg_am` the access method. The two statistics joins are LEFT joins on purpose: an index the collector has no row for should come back with empty counters, which this app then shows as "not counted" rather than as zero scans — a gap in the statistics is not a finding about the index.',
    },
    {
      id: 'scope',
      clause: `      WHERE ns.nspname = $1
        AND table_rel.relkind IN ('r', 'p')
      ORDER BY table_rel.relname, index_rel.relname`,
      title: 'One schema, ordinary and partitioned tables both',
      detail:
        'The schema is a parameter, so the name is never pasted into the statement. `relkind` keeps ordinary tables (`r`) and partitioned parents (`p`): an index declared on a partitioned table lives on the parent, and filtering to `r` alone — as an earlier version of this app did — hides every one of them.',
    },
  ],
  terms: [
    {
      term: 'index-only scan',
      meaning:
        'A read answered entirely from the index, without visiting the table. Possible when every column the query wants is in the index, and only for pages the visibility map marks as all-visible — so a table with vacuum debt falls back to visiting the heap.',
    },
    {
      term: 'HOT update',
      meaning:
        'An update that fits a new row version on the same page and changes no indexed column, so no index has to be touched. Counted separately, which is why the write cost on this page subtracts them.',
    },
    {
      term: 'n_distinct',
      meaning:
        'How many different values a column holds, as of the last ANALYZE. A negative figure is minus the fraction of rows that are distinct — `-1` means every row differs, at any table size.',
    },
    {
      term: 'visibility map',
      meaning:
        'A small per-table bitmap saying which pages hold only rows visible to everyone. Vacuum maintains it, and index-only scans depend on it.',
    },
    {
      term: 'partial index',
      meaning:
        'An index with a WHERE clause, holding only the rows that match it. Smaller and cheaper, but the planner uses it only for queries whose own WHERE implies that clause.',
    },
  ],
  cost:
    'Catalog and statistics reads only — no table data is touched, so it costs the same on a 1.8 TB schema as on an empty one. It plans nothing and executes nothing. One snapshot of the counters is written under local/ per schema, at most once every fifteen minutes.',
}
```

- [ ] **Step 2: Write the preview**

Create `src/components/help/previews/IndexUsagePreview.tsx` following `IndexAuditPreview.tsx` exactly — read it first, and read `src/components/help/highlight.tsx` for how a mock element is tied to a step. Mark the mock's parts with the step ids above: the index name and definition line (`select-shape`), the unique/invalid chips (`flags`), the scans and size figures (`counters`), the column list (`key-columns`), the sort order line (`order-flags`), the table name (`joins`), and the schema in the heading (`scope`).

- [ ] **Step 3: Register both**

`src/lib/help/index.ts` — import `indexUsageTopic` and place it directly after `indexAuditTopic` in `HELP_TOPICS`.
`src/components/help/previews/index.ts` — import `IndexUsagePreview` and add `'index-usage': IndexUsagePreview,` to `HELP_PREVIEWS`.

- [ ] **Step 4: Check the SQL is real**

Run: `npm run test:live -- tests/live/help-sql.test.ts`
Expected: PASS — the topic's statement PREPAREs against the server. If it fails, the clauses drifted from `src/server/index-usage.ts`; fix the clauses, never the test.

- [ ] **Step 5: Fill in the source line**

Run: `grep -n "FROM pg_index x" src/server/index-usage.ts`, and set `source.line` to the line the statement's `SELECT` starts on. `line: 0` must not survive this task.

- [ ] **Step 6: Look at it**

`npm run dev` → `/help/index-usage`. Expected: prose, the mock, and hovering a clause highlights the matching part of the mock.

- [ ] **Step 7: Commit**

```bash
git add src/lib/help src/components/help/previews
git commit -m "docs(help): explain the index usage read"
```

---

### Task 12: Shrink the pressure page's index section

**Files:**
- Modify: `src/components/pressure/IndexSection.tsx`
- Test: `tests/components/pressure/IndexSection.test.tsx` (create if absent; check `tests/components/` first)

**Interfaces:**
- Consumes: `indexAuditTotals`, `unusedIndexes` from `#/lib/pressure/index-audit`; the route from Task 8.
- Produces: nothing new. The three expanded findings become one summary that links to the inspector.

**Why:** two pages rendering the same three findings means two places to keep true. The rules stay where they are; only this rendering shrinks.

- [ ] **Step 1: Write the failing test**

Create `tests/components/pressure/IndexSection.test.tsx` (using the same provider wrapper as the other component tests — `IndexSection` renders `TableLink`, which needs router context):

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import IndexSection from '#/components/pressure/IndexSection'
import type { SchemaPressure } from '#/lib/types'

const pressure: SchemaPressure = {
  schema: 'public',
  statsReset: '2026-08-01T00:00:00.000Z',
  indexes: [
    {
      table: 'orders',
      name: 'orders_customer_idx',
      method: 'btree',
      keyColumns: ['customer_id'],
      isUnique: false,
      isPrimary: false,
      isPartial: false,
      hasExpression: false,
      constraintBacked: false,
      scans: 0,
      bytes: 412 * 1024 * 1024,
    },
  ],
  foreignKeys: [{ table: 'payments', constraint: 'payments_order_fk', columns: ['order_id'] }],
  sizes: [],
  vacuum: [],
  sequences: [],
}

describe('IndexSection, as a summary', () => {
  it('counts the findings and names the biggest unread index', () => {
    render(<IndexSection pressure={pressure} />)
    expect(screen.getByText(/1 never scanned/i)).toBeTruthy()
    expect(screen.getByText(/412 MB/)).toBeTruthy()
    expect(screen.getByText('orders_customer_idx')).toBeTruthy()
  })

  it('sends the reader to the inspector for the detail', () => {
    render(<IndexSection pressure={pressure} />)
    const link = screen.getByRole('link', { name: /inspect/i })
    expect(link.getAttribute('href')).toContain('/indexes/public')
  })

  it('still says how old the counters are', () => {
    render(<IndexSection pressure={pressure} />)
    expect(screen.getByText(/counters reset/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/components/pressure/IndexSection.test.tsx`
Expected: FAIL — the current section renders three findings and no link.

- [ ] **Step 3: Rewrite the section as a summary**

Replace the whole of `src/components/pressure/IndexSection.tsx` with the below. `UnusedRow`, `UncoveredFkRow` and `Finding` go with it, along with the imports only they used — leaving them would be dead code. The section keeps `id="indexes"` so existing in-page links still land.

```tsx
import { Link } from '@tanstack/react-router'
import PressureSection from '#/components/pressure/PressureSection'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { formatBytes } from '#/lib/pressure/bytes'
import { formatRelativeTime } from '#/lib/inspect/format'
import { indexAuditTotals, unusedIndexes } from '#/lib/pressure/index-audit'
import type { SchemaPressure } from '#/lib/types'

/**
 * Indexes, in one tile.
 *
 * The three findings this section used to expand — never scanned, covered by
 * another, foreign key with none — are all on the index inspector now, next to
 * the numbers needed to act on them. Rendering them in both places meant two
 * places to keep true, so this counts them and points at the page that argues
 * them.
 */
export default function IndexSection({ pressure }: { pressure: SchemaPressure }) {
  const database = useDatabaseParam()
  const { schema, indexes, foreignKeys, statsReset } = pressure
  const totals = indexAuditTotals(indexes, foreignKeys)
  const largestUnread = unusedIndexes(indexes)[0] ?? null

  return (
    <PressureSection
      id="indexes"
      title="Indexes"
      count={`${totals.indexCount} total · ${formatBytes(totals.unusedBytes)} unread`}
      rule="Usage comes from the cumulative scan counters, so every claim here is only as old as the last stats reset."
    >
      <div className="space-y-2">
        <p className="text-[11px] text-[var(--sea-ink-soft)]">
          Counters reset{' '}
          <span className="font-medium text-[var(--sea-ink)]">
            {statsReset ? formatRelativeTime(statsReset, Date.now()) : 'never (unknown)'}
          </span>
          {statsReset && ` (${statsReset.slice(0, 10)})`} — an index that looks unread may
          just be younger than that.
        </p>

        <ul className="space-y-1 text-[11px] text-[var(--sea-ink)]">
          <li>
            {totals.unusedCount} never scanned
            <span className="text-[var(--sea-ink-soft)]">
              {' '}
              · {totals.droppableCount} of them enforce nothing
            </span>
          </li>
          <li>
            {totals.redundantCount} covered by a longer index
          </li>
          <li>
            {totals.unindexedForeignKeyCount} foreign keys with no index to lead them
          </li>
        </ul>

        {largestUnread && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            Largest unread:{' '}
            <span className="font-mono text-[var(--sea-ink)]">{largestUnread.name}</span> on{' '}
            <span className="font-mono">{largestUnread.table}</span>,{' '}
            <span className="tabular-nums font-medium text-[var(--sea-ink)]">
              {formatBytes(largestUnread.bytes)}
            </span>
          </p>
        )}

        <Link
          to="/d/$database/indexes/$schema"
          params={{ database, schema }}
          className="inline-block text-[11px] text-[var(--lagoon-deep)] hover:underline"
        >
          Inspect every index — what it costs, and what it serves →
        </Link>
      </div>
    </PressureSection>
  )
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. Existing tests that asserted on the removed findings must be updated to the new summary — that is the intended change, not a regression to work around. Do not weaken an assertion to make it pass; delete the case if what it covered has moved to the inspector's tests.

- [ ] **Step 5: Look at both pages**

`npm run dev` → `/d/<database>/pressure/public` shows one index tile that links out; `/d/<database>/indexes/public` shows the full list. No finding appears twice.

- [ ] **Step 6: Commit**

```bash
git add src/components/pressure/IndexSection.tsx tests/components/pressure
git commit -m "refactor(pressure): summarise indexes and link to the inspector"
```

---

## Done when

- `npm test` passes, and `npx tsc --noEmit` is clean.
- `npm run test:live -- tests/live/index-usage.test.ts tests/live/help-sql.test.ts` passes against a real server.
- `/d/<database>/indexes/<schema>` lists every index and every un-indexed foreign key, and the URL carries the selection, filter and sort.
- Opening the page twice, fifteen minutes apart, produces a trend where there was none.
- `grep -rn "DROP INDEX" src/` returns nothing.
- `grep -rn "EXPLAIN" src/components/indexes src/lib/indexes src/server/index-usage.ts` returns nothing.
- `git status` shows nothing under `local/` staged.
