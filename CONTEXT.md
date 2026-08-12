# db-explorer

Read-only PostgreSQL explorer for app developers inspecting their own application database. Optimized for navigating a documented schema (groups, descriptions, FK-derived nested views), not ad-hoc DBA work.

## Language

**Connection**:
A live `pg.Pool` bound to a `ConnectionConfig`. Single global per server process. Set to `READ ONLY` per session.
_Avoid_: session, db handle.

**Preset**:
A named `ConnectionConfig` loaded from `presets.json` at server startup. Convenience for switching between known DBs from header switcher or connect screen. Passwords resolved from `${ENV_VAR}` references, never stored plaintext in checked-in files.
_Avoid_: profile, saved connection.

**Catalog**:
Manually-curated `table-catalog.json` mapping table names to **Group**s and short per-table descriptions. Drives sidebar grouping and per-table descriptions. Falls back to underscore-prefix grouping when missing.
_Avoid_: schema doc, metadata file.

**Group**:
A named bucket of tables defined by Catalog (`{ name, description, order, tables[] }`). Has `Uncategorized` sentinel for tables not listed.

**Table**:
A base table surfaced from `information_schema.tables`, joined with `pg_stat_user_tables` for approximate `rowCount` (`n_live_tup`) and `lastModified`. Scoped by current **Schema** (selected via header picker, defaults to `public`).

**Schema**:
A Postgres namespace. Selected at the connection level via header dropdown. Persisted in URL.

**Preview**:
First N rows of a Table fetched via paged `SELECT * ... LIMIT N OFFSET M`. Default page size 50.

**Row detail**:
Dedicated route `/t/$schema/$table/row/$id` showing one row's fields plus all incoming-FK children inline, grouped by child table (replaces the old Documents page).

**FK navigation**:
Cell rendering a foreign-key value links to the referenced **Row detail**. FK metadata fetched alongside columns from `information_schema.key_column_usage`.

**Filter DSL**:
Per-column free-form input, parsed by prefix:
- `>N`, `<N`, `>=N`, `<=N`, `=N` — numeric/date comparisons
- `null` / `!null` — nullness
- `~regex` — regex match
- everything else — `ILIKE %v%` fallback (works for JSONB / text casts)

**Filtered count** ("≈ vs exact"):
For tables with `n_live_tup < 100k`, run real `SELECT count(*)` for current filter. Above threshold, show approximate `n_live_tup` with on-demand "Exact" button.

**Lens**:
A read-only architectural view of the current **Schema** at `/lens/$schema`, answering how the schema is *shaped* rather than what is in it. Three pictures over one graph — Group × Group matrix, one **Group** expanded, and the tables nothing references — each clicking through into the table browser. A plugin, not a second app.
_Avoid_: diagram, ERD, visualizer.

**Merged graph**:
The edge set the Lens draws: live Postgres constraints merged with Django relations and column-name rules. Fetched whole once per Schema by `$getSchemaGraph`; every metric is derived from it client-side so each has one definition.

**Basis**:
Where an edge came from, never conflated. `declared` = a real Postgres FK constraint (solid). `model` = a Django relation whose constraint was stripped by `simple_history` or `CrossDBForeignKey` — authoritative but unenforced (dashed). `convention` = inferred from the column name, applied only where no model relation described the column (dashed). Precedence is declared → model → convention, one edge per source column.
_Avoid_: inferred (ambiguous — covers both model and convention), guessed.

**Crossing**:
An edge whose two ends sit in different **Group**s. A count, never a verdict: 75% of edges cross, so the words *violation*, *leak* and *breach* appear nowhere in the Lens.

**Boundary stub**:
In the expanded Group view, an edge leaving the Group drawn to a labelled box at the right-hand boundary instead of to its target node, grouped per target table with a count. Most of a Group's edges leave it, so the stubs are the main content.

**Damping**:
`?damp=historical,agg`, on by default. Historical and Aggregation crossings are an order of magnitude larger than anything else, so undamped they set the matrix colour scale and flatten every real signal.

**No references found**:
The honest label for a table with no edge in either direction on the Merged graph. Never "dead" or "unused" — application code can reach a table through a column no basis ever saw. Framework tables (`django_*`, `social_auth_*`, `auth_*`) and views are tagged into their own buckets rather than counted.

**Not counted**:
`total: null` on an incoming reference — distinct from a counted zero. The eager batch only counts references whose column is index-backed on a table under 100k estimated rows; the rest carry a reason (`unindexed`, `large`, `timeout`) and a per-table button. 45% of inferred columns are unindexed, so this is the common case.

**Trace**:
Following what one row actually touches, one steered hop at a time. It *is* the **Row detail** route with an `outgoing` array beside `children` — no separate route, so hop history is browser history and a shareable trace is the row URL.

**SQL console**:
Read-only textarea at `/console`, runs query, renders result in shared `DataTable`. localStorage-backed history of last 20 queries. No save/share. Constrained by session-level `READ ONLY` already set on the pool.

## Relationships

- A **Connection** exposes many **Schema**s; one selected at a time.
- A selected **Schema** exposes many **Table**s.
- A **Catalog** assigns **Table**s to **Group**s (0 or 1 Group per Table).
- A **Table** has **Column**s; some **Column**s are FKs referencing another **Table**.
- A **Row detail** of one Table shows all rows from other Tables holding an FK back to it.
- A **Preset** produces a **Connection** when applied (from connect screen or header switcher).

## Decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| Q1 | Target user = app developer exploring own DB | catalog/Documents/FK-detect lean this way; (a) DBA = pgAdmin territory, (c) analyst = needs charts+auth |
| Q2 | Sidebar + per-table route, URL = source of truth | only shape supporting FK navigation, deep-link, big-DB tree |
| Q3 | Tiny SQL console (`/console`), localStorage history | dev will hit query needs, full pgAdmin clone overkill |
| Q4 | Schema picker in sidebar header, persisted in URL | multi-schema is real (auth, audit), picker is small lift |
| Q5 | URL holds: schema + table + filter + sort + page; row detail = own route | back button, deep-link, FK click as `<Link>` |
| Q6 | Offset/limit pagination, page size 50, page jumper | dev DBs rarely 100M rows; cursor deferred |
| Q7 | No row virtualization yet, page cap 50 | profile first |
| Q8 | FK click → navigate to parent row detail; hover-peek = v2 | URL state honest, peek is sugar |
| Q9 | Row detail = own route (not modal/drawer) | FK chains want stable history, real estate for incoming-FKs |
| Q10 | Delete `/explorer/documents` route, fold children into row detail | redundant with Q9 |
| Q11 | Drop eager `getAllTablesPreview`, lazy per-table fetch | wasted work with sidebar nav |
| Q12 | Filter DSL (`>N`, `<N`, `null`, `~regex`, fallback ILIKE) | keyboard-flow > op-picker UI |
| Q13 | Exact count if `n_live_tup < 100k`, else approx + on-demand button | balances honesty with cost |
| Q14 | Connection switcher in header, single pool | swap on click, no multi-pool complexity |
| Q15 | Passwords via `${ENV_VAR}` in `presets.json` | cheapest real fix, no native dep |
| Q16 | Export = clipboard-JSON + CSV download of current view | tiny lift, common request |
| Q17 | Adopt shadcn primitives (Sheet, Command, Sidebar, Dialog), keep custom palette via CSS var override | sidebar + command palette want it |
| Q18 | localStorage query history (20), no server persistence | dev tool |
| Q19 | Vitest unit tests on pure helpers only (catalog grouping, row label, filter DSL) | (c) testcontainers over-engineered |
| Q20 | Lens ships inside this app, not as a second project | its payoff is click-through into the existing browser |
| Q21 | One whole-schema `$getSchemaGraph` fetch; degrees derived client-side | one definition per metric, in one place |
| Q22 | Never draw the whole schema — one Group at a time, matrix as the entry point | 337 tables in one picture is the failure mode |
| Q23 | Deterministic layout only; no graph library, no force simulation | largest Group is 37 nodes, so a sorted ring is enough and stable |
| Q24 | Three bases kept distinct, unresolved columns left undrawn | inventing edges for `celery_task_id` would fabricate structure |
| Q25 | Trace = Row detail extended, no `/trace` route | hop history is browser history; the row URL is the shareable trace |
| Q26 | Incoming counts split into eager (indexed, < 100k est.) and not-counted | 45% of inferred columns are unindexed; eager counting would seq-scan per neighbour |
| Q27 | Internal schema metadata (`local/`) is gitignored, its own private repo | this repo is public |

## Execution order

1. Sidebar + table route + URL state (Q2/Q4/Q5).
2. Drop eager preview-all (Q11).
3. Row detail route + children inline (Q9), delete documents page (Q10).
4. FK metadata + click navigation (Q8).
5. Pagination + count strategy (Q6/Q13).
6. Filter DSL (Q12).
7. shadcn migration (Q17) — incremental, in parallel.
8. SQL console (Q3) — last, optional.
9. Export, switcher, password fix, tests — fill-ins.

## Flagged ambiguities

- "Preview" overloaded: route name (`/explorer/preview`) AND per-table data fetch. Route renamed away once sidebar lands; "preview" reserved for the data-fetch sense only.
- "Document" was product-specific (FK-derived nested row), not Mongo-style. Term retired with route deletion (Q10) to avoid conflation with JSONB blobs.

## Example dialogue

> **Dev:** "Why does clicking a `user_id` cell in `orders` not pop a modal?"
> **Maintainer:** "**Row detail** is its own route — `/t/public/users/row/$id` — so the back button works and FK chains are real history. Modals would break that."

> **Dev:** "Where's the Documents page from the old README?"
> **Maintainer:** "Gone. Every **Row detail** already shows incoming-FK children inline. One concept, one place."
