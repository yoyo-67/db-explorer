---
title: UI overhaul — sidebar navigation, row detail, filter DSL, SQL console
labels: needs-triage
date: 2026-04-30
---

## Problem Statement

App developers using db-explorer to inspect their own application database hit a wall the moment the database has more than a handful of tables or any meaningful relational depth. Today the entire `/explorer/preview` page renders every Table as a stacked card, every card opens at once, and there is no way to deep-link a single Table or share a filtered view. Foreign-key values are inert text — clicking a `user_id` cell does nothing, so chasing a relation requires scrolling, manually filtering by id, scrolling back, and remembering where you were. The Documents page tries to fill the gap but caps itself at 10 root rows per Root table with no filter, no paging, and no way to land on a single document. Per-column filtering is restricted to ILIKE on a text cast, so numeric range, null checks, and regex matching are all unavailable. Big Tables stutter because every row stays in the DOM. Connecting to a non-`public` Schema is impossible. Passwords sit in `presets.json` as plaintext. The result: the tool is pleasant to look at on a toy DB and unusable on a real one.

## Solution

Rebuild the navigation around a persistent sidebar (Groups → Tables tree, searchable, with a Schema picker in the header) and a per-Table route. The URL becomes the source of truth for selected Schema, selected Table, filter, sort, and page; the browser back button retraces the developer's path through the database. Row detail becomes its own route, which is also where incoming-FK children render — replacing the Documents page entirely. Foreign-key cells render as links to the referenced Row detail, so chasing a relation is one click and the back button still works. Per-column filter input accepts a small DSL (`>N`, `<N`, `>=N`, `<=N`, `=N`, `null`, `!null`, `~regex`, ILIKE fallback). Pagination is offset/limit with a page jumper at page size 50. Counts are exact below ~100k approximate rows and approximate-with-on-demand-exact above. A small SQL console exists at `/console` for ad-hoc read-only queries with localStorage history. Connection switching happens from the header; Preset passwords resolve from environment variables instead of plaintext. CSV and JSON export of the current view ship as well.

## User Stories

1. As an app developer, I want a persistent sidebar that lists every Group and Table in the current Schema, so that I can see the shape of the database without scrolling a giant page.
2. As an app developer, I want to type into the sidebar's search box and have Tables and Groups filter in place, so that I can find a Table in a database with hundreds of them.
3. As an app developer, I want clicking a Table in the sidebar to load a per-Table route, so that I can bookmark, share, or revisit a specific Table directly.
4. As an app developer, I want the URL to reflect my current Schema, Table, filter, sort, and page, so that copy-pasting the URL to a teammate gives them exactly what I'm looking at.
5. As an app developer, I want my browser's back button to undo navigation between Tables and Row details, so that exploring relations feels like exploring any normal web app.
6. As an app developer, I want a Schema picker in the header, so that I can explore schemas other than `public`.
7. As an app developer, I want my Schema selection to persist in the URL, so that opening two browser tabs lets me explore two schemas side-by-side.
8. As an app developer, I want a Connection switcher in the header populated from my Presets, so that I can jump between known databases without going back to the connect screen.
9. As an app developer, I want my Preset password to come from an environment variable referenced by `${VAR_NAME}` in `presets.json`, so that I can check `presets.json` into source control without leaking secrets.
10. As an app developer, I want a Group in the sidebar to expand to show its Tables, so that the schema's intended structure (per Catalog) shapes my exploration.
11. As an app developer, I want Tables not assigned to a Group to fall under an `Uncategorized` bucket, so that nothing is hidden.
12. As an app developer, I want each Table row in the sidebar to show its approximate row count, so that I can spot the heavy tables at a glance.
13. As an app developer, I want the Table page to render columns with their data types and FK markers, so that I can read the schema while I read the data.
14. As an app developer, I want each column header to accept a Filter DSL input, so that I can narrow rows with `>100`, `null`, `~^foo`, or a plain substring without choosing an operator from a dropdown.
15. As an app developer, I want sortable column headers, so that I can reorder by any column without writing SQL.
16. As an app developer, I want pagination at page size 50 with a page jumper, so that I can move through a large Table without "load more" fatigue.
17. As an app developer, I want the row count to display as exact below a 100k threshold and approximate above it, so that I get an honest number without paying for a `count(*)` on a 50M-row Table.
18. As an app developer, I want a button to force an exact count when the Table is large, so that I can pay the cost when I actually need the number.
19. As an app developer, I want clicking a foreign-key cell to navigate to the Row detail of the referenced row, so that chasing a relation is one click.
20. As an app developer, I want the Row detail page to list every column of the row with its value, so that I can see the full record without scrolling a horizontal table.
21. As an app developer, I want the Row detail page to list every Table that holds an FK back to this row, grouped by Table, so that I see incoming relations alongside the row itself.
22. As an app developer, I want the incoming-FK children on Row detail to be paginated and filterable like any Table page, so that a row with 10,000 children is still navigable.
23. As an app developer, I want JSONB cells to pretty-print on hover or expansion, so that nested structure is readable without leaving the page.
24. As an app developer, I want long text cells to truncate inline and reveal in a popover on hover, so that one fat cell doesn't blow up row height.
25. As an app developer, I want a "copy current view as JSON" button on the Table page, so that I can paste a slice of data into another tool.
26. As an app developer, I want a "download current view as CSV" button, so that I can hand the result to a spreadsheet user.
27. As an app developer, I want a `/console` route with a textarea, run button, and a results table, so that I can run an ad-hoc read-only query without leaving the app.
28. As an app developer, I want my last 20 console queries kept in localStorage, so that my recent work survives a page reload.
29. As an app developer, I want the SQL console to refuse writes by virtue of the existing session-level `READ ONLY` setting, so that I can't accidentally mutate state.
30. As an app developer, I want the connect screen to keep its Presets and SSL toggle, so that the existing first-run flow still works.
31. As an app developer, I want the old Documents page to be gone, so that there's a single place — Row detail — to see a row and its children.
32. As an app developer, I want the eager fetch-all-Table-Previews on connect to be removed, so that connecting to a database with 200 Tables doesn't take 30 seconds.
33. As an app developer, I want Table data to load lazily when I open a Table, so that the app stays responsive.
34. As an app developer, I want React Query to cache Table results across navigations within a session, so that bouncing between Tables doesn't re-hit the database.
35. As an app developer, I want sidebar Group expansion state persisted in the URL or localStorage, so that my preferred sections don't collapse every reload.
36. As an app developer, I want filter and sort state cleared by a single button when I want a fresh look, so that I'm not fighting stale URL params.
37. As an app developer, I want NULL values rendered distinctly (italic placeholder), so that I can tell a missing value from an empty string at a glance.
38. As an app developer, I want primary keys highlighted in column headers, so that I can spot identity at a glance.
39. As an app developer, I want FK columns badged with the referenced Table, so that I can see the relation before clicking.
40. As an app developer, I want light/dark mode preserved across the new pages, so that the existing theme toggle still works.
41. As a security-aware operator, I want `presets.json` examples and docs to never include a real password, so that the example is safe to commit.
42. As a developer reading the codebase, I want a `CONTEXT.md` and ADRs that explain the navigation/URL model and why the Documents route was deleted, so that I don't reinvent the rejected alternatives.

## Implementation Decisions

- **Navigation shape**: ADR-0001 — sidebar (Groups → Tables tree, searchable) + per-Table route + per-Row-detail route. URL holds Schema, Table, filter, sort, page. Row detail is its own route (not modal/drawer).
- **Documents page removed**: ADR-0002 — `/explorer/documents` and `getDocumentCollections` retired. Incoming-FK children render on Row detail.
- **Schema scope**: header Schema picker, persisted in URL, defaults to `public`.
- **Pagination**: offset/limit, page size 50, page jumper. Cursor pagination deferred until measured pain.
- **Counts**: exact `SELECT count(*)` for filtered query when underlying Table's `n_live_tup < 100k`; otherwise approximate with on-demand exact button.
- **Filter DSL**: free-form input per column. Prefix-parsed into a `Predicate` (numeric/date comparisons, `null` / `!null`, `~regex`, ILIKE fallback). Compiled to a parameterized SQL fragment (`pg-format` for identifiers).
- **FK navigation**: `ColumnInfo` extended with `references?: { table, column }`. FK cells render as `<Link>` to `/t/$schema/$parent/row/$id`. Hover-peek deferred to v2.
- **Row detail**: own route. Renders root row's columns, then one expandable group per Table holding an FK back to this row. Each group is a paged child Table view.
- **SQL console**: `/console` route, textarea + run button, result rendered through the shared `DataTable` component. localStorage history of last 20 queries. Read-only enforcement comes from the existing session `READ ONLY` setting on the pool.
- **Connection switcher**: header dropdown listing Presets. Single global pool; selecting a Preset tears down and rebuilds the pool against the new Connection.
- **Preset password resolution**: server reads `presets.json`, then resolves any `${VAR_NAME}` reference against `process.env`. Unset vars produce a clearly-labeled error at connect time.
- **Export**: clipboard JSON and CSV download of the current Table view (current filter, sort, page).
- **Eager preview-all dropped**: `getAllTablesPreview` and the on-connect bulk fetch are removed. Each Table page fetches its own data on mount, cached by React Query.
- **shadcn adoption**: `Sheet` (drawer if needed), `Sidebar`, `Command` (sidebar search / Schema picker), `Dialog`, `Button`, `Input`, `Select` adopted incrementally. Existing CSS palette variables (`--lagoon`, `--sea-ink`, etc.) preserved by overriding shadcn's defaults.
- **Tests stay vitest, helpers only**: no testcontainers, no live PG.

### Modules

Deep modules (pure or near-pure, testable in isolation):

- **catalog-grouping**: `(tables, catalog?) → CatalogGroup[]`. Extracted from the current `preview.tsx` inline implementation.
- **filter-dsl-parser**: `input string → Predicate`. Predicate union: `{kind: 'cmp', op, value}`, `{kind: 'null', negated}`, `{kind: 'regex', pattern}`, `{kind: 'ilike', pattern}`. Pure.
- **filter-dsl-compiler**: `(Predicate, columnName, columnType) → { sql, params }`. Pure SQL builder, paired with the parser.
- **row-label**: `(row, columns, fks) → string`. Replaces the current heuristic; prefers PK then FK-tagged columns then short string fields.
- **preset-resolver**: `(rawPresetsJson, env) → ConnectionPreset[]`. Resolves `${VAR}` references and reports unresolved variables as errors.
- **fk-resolver**: `(fks, columnName) → { table, column } | undefined`. Pure lookup helper consumed by both column rendering and cell rendering.
- **table-query** (server): `(schema, table, { filter, sort, page, pageSize, exactCount? }) → { rows, count, pageMeta }`. Owns the SQL string assembly, parameter binding, and count-strategy branch. Tested by asserting on the produced SQL string + params, not by hitting a real database.
- **schema-introspector** (server): single batched introspection returning `{ schemas, tables, columns, fks }` for the current Connection. Replaces the current split queries.

Shallow modules (UI / glue, not isolation-tested):

- **Sidebar** — Groups tree, search, Schema picker.
- **TablePage** — replaces the stacked-cards `/explorer/preview` page.
- **RowDetailPage** — root row + paged incoming-FK children, FK links.
- **SqlConsolePage** — `/console`.
- **ConnectionSwitcher** — header dropdown.
- **ExportButtons** — clipboard JSON + CSV download.

### Server contracts

- `getSchemas() → string[]`.
- `introspect(schema) → { tables: TableInfo[], fks: ForeignKey[] }`. Single round-trip per Schema.
- `getTablePage({ schema, table, filter?, sort?, page, pageSize, exactCount? }) → { rows, count, isCountApproximate, columns }`.
- `runReadOnlyQuery(sql) → TableData`. Honors the pool's `READ ONLY` session setting. Errors surface verbatim.

### URL contracts

- `/` — connect screen (unchanged).
- `/t/$schema/$table?q=...&sort=col:dir&p=N&col[email]=alice` — Table page.
- `/t/$schema/$table/row/$id` — Row detail.
- `/console` — SQL console.

## Testing Decisions

A good test in this codebase exercises a module's external behavior — given inputs, assert outputs — and never reaches into private structure. UI tests (when added) assert on what the user sees and clicks, not on internal React state. Server tests for `table-query` build a request and assert on the produced SQL string and bound parameters; they do not hit a live database.

Modules covered by unit tests:

- **catalog-grouping** — given a `tables[]` and an optional Catalog, asserts the bucket order, `Uncategorized` placement, and prefix fallback when no Catalog is provided.
- **filter-dsl-parser** — input strings (`>10`, `<= 5`, `null`, `!null`, `~^foo`, `bar baz`) map to the expected `Predicate`; malformed inputs degrade to ILIKE rather than throw.
- **filter-dsl-compiler** — given a Predicate + column name/type, asserts the produced `{ sql, params }`. Identifier escaping verified for tricky names.
- **row-label** — picks PK over FK over short string; falls back gracefully on rows missing all three.
- **preset-resolver** — `${VAR}` references resolve from a stub `env`; unresolved variables produce a labeled error containing the missing name; partial resolution does not silently use empty string.
- **table-query** — parameter shape and SQL fragment ordering for `(schema, table, filter, sort, page)`; count branch (exact vs approximate) selected based on the threshold input.

Prior art for these tests: there is none in the current `tests/` directory. Conventions to establish in this round: vitest, no jsdom for these (they're pure), one file per module under `tests/<module-name>.test.ts`, snapshot only for SQL fragments and only when readability outweighs explicit assertions.

UI components are not unit-tested at the component level. Manual exercise via the dev server during implementation; rely on TypeScript + the helper unit tests to catch the load-bearing logic.

## Out of Scope

- DBA features: index inspection, query plans, `EXPLAIN ANALYZE`, vacuum/analyze controls, connection-level tuning.
- Write operations: edit, insert, delete, schema changes. Pool stays `READ ONLY`.
- Saved/shared queries on the server side. SQL console history is localStorage-only.
- Charts, dashboards, or aggregations — analyst-shaped features explicitly rejected (Q1).
- Multi-pool / multi-tab connections. Single global pool, switched via header.
- Hover-peek popovers for FK cells. Click-to-navigate ships first; peek is a v2 candidate.
- Row virtualization. Page cap of 50 rows is the throttle until profiling shows real pain.
- Cursor pagination, full-text search over all Tables, fuzzy global search.
- OS-keychain or keyring integration for Preset secrets — `${ENV_VAR}` is the cheap fix; native dep is not justified.
- Authentication or multi-user support. Tool runs locally for the developer.
- Migrations to a non-pg database driver.

## Further Notes

- ADR-0001 and ADR-0002 are the two architectural commitments behind this PRD; both are linked from `CONTEXT.md` under "Decisions (locked)".
- Word "Preview" is overloaded today — both a route name and a per-Table fetch concept. Once the sidebar lands, the `/explorer/preview` route is renamed (or replaced by an overview/dashboard) and "Preview" is reserved for the data-fetch sense.
- Word "Document" exits the glossary with the deletion of `/explorer/documents`. This avoids future confusion with JSONB blobs.
- `presets.json` should be added to `.gitignore` regardless of the env-var fix; `presets.example.json` remains the committed example.
- The current `getRowLabel` heuristic is moved into the `row-label` deep module and upgraded to use FK and PK information so that Row detail labels stop picking arbitrary short strings.
- Execution order is captured in `CONTEXT.md` and should be followed: navigation foundation → drop eager fetch → row detail + delete documents → FK click → pagination/count → filter DSL → shadcn (parallel) → SQL console → export/switcher/password/tests.
- No git remote / issue tracker is configured, so this PRD is published as a markdown file in `docs/`. Move it into the project's tracker (with the `needs-triage` label) once one is wired up.
