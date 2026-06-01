# Query HUD — design

## Goal

A small always-on floating window (badge → expandable panel) that shows how
many PostgreSQL queries the backend fired and a breakdown with statistics, so a
developer can see at a glance why a given click was slow.

## Source of truth

No new query instrumentation. `query()` in `src/server/db.ts` already appends
every PG query to `perf-log.jsonl` via `appendPerfEntry`, with the shape
(`src/server/perf-log.ts`):

```ts
interface PerfLogEntry {
  ts: number        // epoch ms, query start
  preset: string
  sql: string
  ms: number
  ok: boolean
  error?: string
  rowCount?: number
}
```

The HUD reads this log. This means it also captures console queries and any
query the server fans out into (e.g. one table click = columns + data + approx
count + fkeys).

## Architecture & data flow

1. **Server fn `$getPerfLog({ sinceTs?, limit? })`** (`src/server/api.ts`)
   - Thin wrapper over the existing `readPerfLog(limit)`.
   - When `sinceTs` is provided, returns only entries with `ts > sinceTs`.
   - Read-only; reads the log file, no DB connection required.
   - Default `limit` 500.

2. **Client `QueryHud` component**, mounted in the app shell so it shows on
   every route.
   - Holds a `cursor` (max `ts` seen so far) and an in-memory `session` buffer
     of `PerfLogEntry[]`, capped at 1000 (drop oldest).
   - Polls `$getPerfLog({ sinceTs: cursor })` every ~1000ms while mounted.
     New entries are appended to `session`; `cursor` advances to the max `ts`.
   - No per-click hooks — fully decoupled from the data-fetching code.

3. **"Last action" via burst grouping**
   - Sort `session` by `ts`. Walk from the newest entry backwards; entries
     whose gap to the previous is `< 750ms` belong to the same burst.
   - The newest such burst = "last action". A click that fans out to N queries
     in quick succession is grouped into one action.

### Known limitation

`perf-log.jsonl` is server-global, so queries from a second browser tab or the
SQL console can land in the same time window and bleed into a burst. Acceptable
for an internal dev tool. Documented, not solved.

## UI

- **Badge**: fixed bottom-right pill — `⚡ {lastActionCount} · {lastActionMs}ms`.
  Turns red (warning state) when the last action contains an errored query or
  any query `> 1000ms`. Click toggles the panel.
- **Panel**, two tabs:
  - **Last action**: per-query rows, sorted slowest-first —
    `ms · rowCount · sql`. SQL truncated with full text on hover/expand.
    Header shows query count + total ms for the action.
  - **Session**: aggregate stats — total queries, total ms, avg ms, p95 ms,
    error count, slowest single query. Plus a **by-SQL-shape** table: normalize
    each SQL (strip string/number literals and collapse `IN (...)` lists) to a
    shape key, group by it, show count / total ms / avg ms, sorted by total ms.
  - A **Clear** control resets `session` and `cursor`.
- Pure client state (React `useState`/`useReducer`), no persistence.

## Components & boundaries

- `src/server/api.ts` — add `$getPerfLog`. (`readPerfLog` already exists.)
- `src/lib/query-stats.ts` — pure helpers, unit-testable without React or DB:
  - `groupBursts(entries, gapMs)` → bursts; newest burst is last action.
  - `normalizeSql(sql)` → shape key.
  - `sessionStats(entries)` → totals, avg, p95, errorCount, slowest.
  - `shapeBreakdown(entries)` → grouped-by-shape rows.
- `src/components/QueryHud/` — `QueryHud.tsx` (badge + panel + polling),
  presentational subparts as needed. Mounted in the root/shell layout.

## Testing

- TDD the pure helpers in `src/lib/query-stats.ts`: burst grouping (gap
  boundaries, single entry, empty), SQL normalization (literals, IN-lists,
  whitespace), session stats (avg/p95/error count/slowest), shape breakdown
  ordering.
- `$getPerfLog` `sinceTs` filtering tested against a mocked `readPerfLog`.
- HUD component logic kept thin; the testable weight lives in the pure helpers.

## Out of scope (YAGNI)

- Persisting HUD history across reloads.
- Per-tab attribution / request correlation IDs.
- Server-fn (HTTP) call counting — we count PG queries only.
- EXPLAIN integration from the HUD.
