# Grill session — UI overhaul direction

Date: 2026-04-30
Trigger: user feels UI weak, lots missing. Walked design tree to lock direction before code.

## Initial diagnosis

Read-only PG explorer. 3 routes: connect, `/explorer/preview` (stacked table cards), `/explorer/documents` (FK-derived nested rows).

### Big gaps surfaced
- No SQL console.
- No schema view (FKs / indexes / constraints).
- Hardcoded `public` schema only.
- No row detail / FK navigation.
- "Load more +10" only — no pagination, no jump.
- No row virtualization → big tables lag.
- `getAllTablesPreview` eager-fetches every table on connect.
- No URL state → no deep link, no back button.
- No export (CSV/JSON).
- Documents page fixed at 10 root rows, no paging, no filter.
- `getRowLabel` heuristic picks wrong field often.
- Per-column filter = ILIKE-on-text-cast only. No type-aware ops.
- `presets.json` stores password plaintext.
- No connection switcher.

### Smaller smells
- TableCard `useState(true)` defaults expanded → contradicts commit message about collapse-by-default.
- Sticky `top-[40px]` magic number.
- `DataTable` sort coerces with `Number()` → inconsistent on mixed-type cols.
- `getDocumentCollections` does N×M queries on first paint.

## Resolved (all locked, "yes" to recommendations)

| Q | Decision |
|---|----------|
| Q1 Target user | app dev exploring own DB |
| Q2 Navigation | sidebar + per-table route, URL = state |
| Q3 SQL console | tiny `/console`, localStorage history (20) |
| Q4 Schema | header picker, URL-persisted |
| Q5 URL state | schema/table/filter/sort/page; row detail = own route |
| Q6 Pagination | offset/limit, page size 50, page jumper |
| Q7 Virtualization | none yet, page cap 50 |
| Q8 FK click | navigate to row detail; peek = v2 |
| Q9 Row detail | own route, not modal/drawer |
| Q10 Documents page | delete; fold children into row detail |
| Q11 Eager preview-all | drop, lazy per table |
| Q12 Filter ops | mini-DSL (>N, <N, null, ~regex, ILIKE fallback) |
| Q13 Counts | exact if `n_live_tup < 100k`, else approx + button |
| Q14 Connection switcher | header dropdown, single pool |
| Q15 Password storage | `${ENV_VAR}` references in presets.json |
| Q16 Export | clipboard JSON + CSV download |
| Q17 Theme/shadcn | adopt shadcn primitives, keep custom palette |
| Q18 Query history | localStorage, no server persistence |
| Q19 Tests | vitest on pure helpers only |
| Q20 Order | nav → drop eager → row detail/delete docs → FK click → pagination/count → filter DSL → shadcn (parallel) → SQL console → export/switcher/password/tests |

## ADRs spawned

- [0001 — navigation and URL state](./adr/0001-navigation-and-url-state.md)
- [0002 — drop documents route, fold into row detail](./adr/0002-drop-documents-route.md)

## Notes for next session

- Rename `/explorer/preview` to overview (or kill it) when sidebar lands. "Preview" word should mean data-fetch only thereafter.
- Verify `presets.json` is in `.gitignore` before shipping env-var resolver.
- Extend `ColumnInfo` with `references?: { table, column }` for FK rendering — single query change in `functions.ts:getTables`.
- `useConnectionGuard` will need to also check schema availability when picker added.
