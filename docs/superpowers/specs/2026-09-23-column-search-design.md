# Column search, from the palette and across a schema

**Status:** design, section approved in brainstorming — spec pending review
**Date:** 2026-09-23

## The problem

Every way into the app starts from a table. The sidebar lists tables, the
palette matches table names, the lens draws tables. But the thing people
half-remember is often a column: "the table with `project_id` *and*
`deleted_at`", "whichever table has the `external_ref` column", "every `jsonb`
column in this schema". Today that question goes to the SQL console and
`information_schema.columns`, by hand.

Two jobs, both wanted:

- **Jump** — type a column name, land on the table that has it. Belongs in the
  palette.
- **Survey** — list every column matching a name or a type, with enough about
  each to decide which one matters. Belongs on its own page, with the query in
  the URL so an answer is a link.

## Data sources

Everything is read from the catalog, so it costs the same on a billion rows as
on none.

| What | Source | Cost |
|---|---|---|
| Column name, type, nullable | `$introspect` — `TableInfo.columns` | free: already cached under `['introspect', db, schema]` |
| Reference target + basis | merged schema graph, `$getSchemaGraph` | free: already cached for lens and Find |
| Indexed | `pg_index` | new, one read per schema |
| Null share, distinct estimate, stats age | `pg_stats` + `pg_stat_user_tables.last_(auto)analyze` | new, one read per schema |
| Comment | `col_description()` | new, one read per schema |
| Catalog description | `table-catalog.json` | free: already loaded, merged client-side |

The three new reads go in one server function, one round trip:

```ts
$getColumnFacets({ database, schema }) → {
  columns: Record<`${table}.${column}`, {
    index: 'lead' | 'member' | null   // leads an index / appears later in one
    nullFrac: number | null           // null = no stats, never 0
    nDistinct: number | null          // pg_stats sign convention resolved to a count or share
    comment: string | null
  }>
  analyzedAt: Record<table, string | null>
}
```

Lives in `src/server/column-facets.ts`, exported through `src/server/api.ts`
the same way `$getSchemaPressure` is.

## Pure logic

`src/lib/column-search.ts`, browser-safe, no fetching:

- **Matching and ranking.** Reuses the rank tiers `#/lib/palette/table-matches`
  already defines (whole name, prefix, word start, contiguous run, spread-out
  with `MIN_RUN_SHARE`), applied to column names. Ties break on table name so
  results are stable.
- **Facet filters.** `type` (set of data types), `ref` (`any | none |
  declared | model | convention`), `indexed` (`lead | any | none`), `nullable`.
- **URL codec.** `parseColumnSearch(search) / serializeColumnSearch(state)`,
  round-trips exactly.

## Palette

- **Root page:** up to `MAX_MATCHES` column hits, listed under the table hits
  and behind the same confidence gate. A spread-out match that doesn't
  clear `MIN_RUN_SHARE` stays off the root, same as a table.
- **New `Columns` page** (`src/lib/palette/views.ts`): every match, no gate.
- **On a hit:**
  - `↵` opens the table.
  - `⇥` opens the table with a fresh `notNull` condition on that column.
    "Show me the rows where it's set" is the usual next question.
  - `⌘↵` opens the table in a new tab, like every other palette row, since
    each row is a real link.
- **Last row:** *All N matches →* opens the survey page with `q` prefilled.

## Survey page

Route: `/d/$database/columns/$schema?q=&type=&ref=&indexed=&nullable=`
(`src/routes/d/$database/columns/$schema.tsx`). Added to `DATABASE_ROUTES` in
`src/lib/menu-routes.ts` and to the header menu.

One flat table, one row per column:

| Column | Table | Type | Null? | References | Indexed | Null % | Distinct | Comment |
|---|---|---|---|---|---|---|---|---|

- **Table** prints with its catalog group, as the sidebar does, and is a link
  to the table page.
- **References** shows the target `table.column` with the lens's `BasisTag`.
  Each basis is labelled and they're never mixed.
- **Type filter** is a chip set built from the types actually present in the
  schema, not a fixed list.
- **Filters sit in the URL.** Changing one replaces the URL rather than
  pushing, same as the table page's filters.
- **Stats age** shows as a note above the table, like the Profile tab's:
  "stats from the last ANALYZE, N days ago".
- **Help topic:** `src/lib/help/topics/column-search.ts`.

## Honesty rules

- A column with no `pg_stats` row reads "— never analyzed", not `0%`.
  Unknown is never shown as zero.
- An **unindexed reference column** (has a reference, `index === null`) is
  flagged. Following that relation from the referenced side seq-scans.
- The table-level stats age is shown next to any number read from `pg_stats`,
  since those numbers are only as fresh as the last ANALYZE.

## Error handling

- Facets failing (permissions on `pg_stats`, timeout) must not take the page
  down. Name, type, nullable and reference still render. The facet columns
  read "unavailable" with the reason once, above the table.
- The graph not having loaded yet: the References column shows a skeleton,
  not "none".

## Testing

- `tests/lib/column-search.test.ts`: ranking tiers, gate behaviour on the
  root page, each facet filter, URL round-trip.
- `tests/lib/palette-actions.test.ts`: the `⇥` action builds a `notNull`
  condition on the right column.
- Server: the facets query against the dev database in the existing
  server-test style. Covers the lead vs member index cases, a column with no
  stats, and a commented column.

## Deliberately not built

- Searching column **values**. That is Find's job.
- Cross-schema search. A schema is the unit everywhere else in the app.
- Fuzzy matching on type names. The chip set covers it.
