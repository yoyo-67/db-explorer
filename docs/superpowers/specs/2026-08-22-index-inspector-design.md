# Index inspector — design

## Goal

A page that settles index decisions: what each index costs, what access pattern
it actually serves, what lookups its shape unlocks, and whether its usage is
rising or dead — for one schema at a time.

Today `/d/$database/pressure/$schema` answers *"which indexes look like waste"*
in three findings (never scanned, prefix-redundant, uncovered foreign key). It
cannot answer *"what does this index do for me"*, because it carries only
`idx_scan` and size per index. This page answers that.

## Non-goals

- **No `EXPLAIN`.** Nothing on this page plans or executes a statement.
- **No query→index attribution.** Mapping `pg_stat_statements` entries to
  indexes needs either the planner (ruled out) or a real SQL grammar as a new
  dependency, and its best honest claim would be *eligible*, never *used*. Out
  of scope; the `devgrounds-db` MCP tools cover that question when it comes up.
- **No `DROP INDEX` statement anywhere.** The page states what dropping would
  take with it and leaves the writing of destructive DDL to the operator.
  `CREATE INDEX` for a missing foreign-key index is still offered — additive.
- **No new counters.** Every number is a catalog or statistics read, so the page
  costs the same on a 1.8 TB schema as on an empty one.

## Source of truth

New server module `src/server/index-usage.ts`. `schema-pressure.ts` is left
alone — the pressure page keeps working unchanged. One `Promise.all` of catalog
and statistics reads, all scoped to one schema:

| Read | For |
|---|---|
| `pg_index` + `pg_class` + `pg_am` + `pg_get_indexdef` | key columns in order, INCLUDE columns, `indpred` (partial), `indisvalid`/`indisready`, unique/primary/constraint-backed, method, definition text |
| `pg_stat_user_indexes` | `idx_scan`, `idx_tup_read`, `idx_tup_fetch` |
| `pg_statio_user_indexes` | `idx_blks_hit`, `idx_blks_read` → cache hit |
| `pg_stat_user_tables` | `n_tup_ins/upd/del/hot_upd`, `seq_scan`, `idx_scan`, `n_live_tup` → write tax, and the table's own seq-vs-index balance |
| `pg_stats` for each index's key columns | `n_distinct`, `correlation`, `null_frac`, `avg_width` → leading-column selectivity, clustered-ness |
| `pg_relation_size(indexrelid)`, `pg_table_size`, `pg_indexes_size` | bytes, and this index's share of the table's total |
| `pg_stat_database.stats_reset` | how old every counter is |

Relations included: `relkind IN ('r','p')`. Partitioned parents were absent from
the pressure read (`'r'` only), which silently hid every index declared on a
partitioned table.

Version handling follows `query-board.ts`: `SHOW server_version_num` once, and
the number is carried in the payload so the UI can say what it could not read.
`last_idx_scan` (Postgres 16+) is deliberately *not* read: the target is 15, so a
version-conditional column here would ship untested against every server it
could answer for. The stored snapshots give the same answer — when an index was
last read — for every version.

`null` never becomes `0`. A missing statistics row means *not counted*; calling
that zero scans would invent a finding.

## Derivations — pure, tested, no SQL

New directory `src/lib/indexes/`. Each function takes plain data and is unit
tested, so the rules can be read and challenged without reading SQL. Mirrors the
existing split between `server/schema-pressure.ts` and `lib/pressure/*`.

### `shape.ts` — what the counters say the index is used for

- `tuplesPerScan = idx_tup_read / idx_scan` — how many index entries a typical
  scan walks.
- `heapFetchRatio = idx_tup_fetch / idx_tup_read` — near 0 means the visibility
  map is answering (index-only territory); near 1 means every entry costs a heap
  visit.
- `cacheHitRatio = idx_blks_hit / (idx_blks_hit + idx_blks_read)`.
- `classifyAccess()` → `never-scanned | point-lookup | narrow-range |
  wide-sweep | full-index-read`, with the numbers that produced it, and
  `unknown` when the counters are absent. Boundaries are named constants with a
  comment saying why, and are what the tests pin.

### `capability.ts` — what the shape unlocks, regardless of usage

From key columns, INCLUDE columns, method, predicate and `pg_stats`:

- equality lookups it serves, each with estimated rows per value from
  `n_distinct` and the table's row estimate;
- the one column that can take a range or sort (the first non-equality
  position), and the sort orders the index satisfies, including `DESC` and
  `NULLS` variants as declared;
- index-only-scan eligibility: which select lists the key + INCLUDE columns
  cover, with the visibility-map caveat stated once;
- what a partial predicate excludes — a partial index answers only queries whose
  own `WHERE` implies that predicate;
- non-btree methods report only what their method supports (no sort order from a
  hash or GIN index).

### `write-tax.ts` — what the index costs on the write path

Table write volume (`n_tup_ins + n_tup_upd - n_tup_hot_upd + n_tup_del`) against
index count, plus this index's byte share of the table's total. HOT updates are
subtracted because they skip index maintenance — that is the difference between
an honest number and a scary one.

### `trend.ts` — usage now, not usage since the stats reset

Deltas between snapshots → scans/day over the sampled window, a series for the
sparkline, and an explicit discontinuity when `stats_reset` moved or a counter
went backwards (a restart, a `pg_stat_reset()`). No negative deltas are ever
computed or shown.

### Verdicts

Reused from `src/lib/pressure/index-audit.ts` as chips — `unusedIndexes`,
`redundantIndexes`, `enforcesConstraint`, `unindexedForeignKeys`. The rules stay
in one place; this page renders them, it does not restate them.

## Sampling

New `src/server/index-samples.ts`, the first writer into `local/`:

```
local/<connection>/<database>/<schema>/index-samples.json
```

Keyed exactly like the read side (`lib/local-metadata-path`), so a rotating host
behind a named preset keeps its history.

- Appended during `$getIndexUsage`, at most once per 15 minutes.
- Entry: `{ takenAt, statsReset, perIndex: { [name]: { scans, tupRead, tupFetch } } }`.
- Last 90 entries kept; older ones dropped on write.
- First read shows *no history yet*, not a flat line.
- Unwritable or corrupt file degrades to counters-only with a quiet note. A
  history that cannot be written is not an error worth blocking a page read.

## Route and data flow

`/d/$database/indexes/$schema`, with the selected index in a search param
(`?index=<name>`) so a finding is linkable.

One server function, `$getIndexUsage({ database, schema })` in
`src/server/api.ts`, returning facts + history in one payload. Client caches it
with `staleTime: 60_000` and an explicit re-read button, matching the pressure
page. System schemas get the same "not measured" panel the pressure page shows,
for the same reason: `pg_stat_user_*` holds nothing for them.

Wiring: header menu entry ("Indexes — what each one costs and what it serves"),
`/indexes` added to `DATABASE_ROUTES` in `src/lib/menu-routes.ts`, `indexes`
added to the segment regex in `src/lib/lens-links.ts` so schema switching keeps
you on the page, and a help topic `src/lib/help/topics/index-usage.ts`.

## UI

Master–detail, because the page has two jobs: rank every index, then inspect one.

```
┌ Indexes · public ─ 214 indexes · 1.2 GB unread · counters 12d old ─ [↻] ┐
│ filter [        ]  sort [scans/day ▾]   ⦿never scanned ⦿invalid ⦿partial │
├──────────────────────────────────┬──────────────────────────────────────┤
│ ● orders_customer_idx     0/d    │ orders_customer_idx        412 MB    │
│   orders (customer_id)  412 MB   │ btree (customer_id) · not unique     │
│ ○ orders_created_idx  1.2k/d     │ CREATE INDEX … [copy definition]     │
│   orders (created_at)    88 MB   │                                      │
│ ○ users_email_key       33/d     │ Access · never scanned since reset   │
│   users (email) unique   12 MB   │   ▁▁▁▁▁▁ scans/day, 14d sampled      │
│ ⚠ payments (order_id)  no index  │ Unlocks · = customer_id → ~38 rows   │
│ ⨯ idx_broken           invalid   │   sorts (customer_id) · not index-only│
│ …                                │ Cost · 18% of orders' 2.3 GB total   │
│                                  │   orders takes 41k writes/day        │
│                                  │ Standing · enforces nothing          │
└──────────────────────────────────┴──────────────────────────────────────┘
```

**Left rail** — one row per index: verdict dot, table and index name, key
columns, scans/day with a sparkline, size, access-pattern chip. Sort by
scans/day, size, tuples-per-scan, write tax or name. Substring filter over
index, table and column names. Quick filters: never scanned, invalid, redundant,
partial, unique, non-btree, missing FK index. Foreign keys with no index appear
as ghost rows so a gap is visible in the same list as the sprawl.

**Detail pane** — five stacked blocks, each stating the numbers it argues from:

1. **Identity** — definition (copyable), method, unique/primary/constraint-backed,
   and a loud banner when `indisvalid` is false (a failed
   `CREATE INDEX CONCURRENTLY` leaves an index that costs writes and answers
   nothing).
2. **Access** — the classification sentence, tuples per scan, heap fetch ratio,
   cache hit, and how old the counters are.
3. **Trend** — scans/day sparkline from the local samples, with discontinuities
   marked and a plain "no history yet" first-run state.
4. **Unlocks** — the capability list from `capability.ts`.
5. **Cost and standing** — bytes, share of the table's total, write tax, plus
   the verdict chips and, where relevant, one sentence on what dropping it would
   take with it. No `DROP` statement.

A missing-FK ghost row's detail offers the `CREATE INDEX CONCURRENTLY` statement
(`createFkIndexSql`, already written and tested).

The existing pressure page keeps a compact index tile — counts, unread bytes,
worst offender — linking here, and loses its three expanded findings, so the
rules render in one place.

## Testing

- Unit (`vitest`): every function in `lib/indexes/*` — classification boundaries,
  absent counters staying `null`, trend discontinuity on a stats reset, HOT-update
  subtraction in the write tax, capability derivation for partial, expression,
  INCLUDE and non-btree indexes.
- Snapshot store: min-interval dedupe, 90-entry cap, corrupt and unwritable file
  both degrading to counters-only.
- Live (`vitest.live.config.ts`): `getIndexUsage` against the real database,
  asserting shape and that every index in the schema appears once.
