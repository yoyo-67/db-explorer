# db-explorer

A lightweight, **read-only** PostgreSQL schema and data explorer. Connect to a
database, browse tables grouped by domain, page through rows, follow foreign
keys, run read-only SQL in a console, and watch query performance live.

Built with [TanStack Start](https://tanstack.com/start) (React + server
functions), TypeScript, and Tailwind.

## Features

- **Browse** tables and schemas, grouped via an optional catalog.
- **Paginated rows** with filtering and sorting; smart row-count estimation for
  huge tables (uses planner stats instead of `COUNT(*)` seqscans).
- **Foreign-key navigation** — click a value to jump to the related row; lazy
  child counts. A row also lists its *outgoing* references and flags any that
  point at a row that isn't there.
- **Table inspector** — three tabs above the rows, all read from the catalog so
  they cost the same on a billion rows as on none. *Profile* shows every column's
  nulls, distinct estimate and most common values from the last `ANALYZE` (and
  says how old that is); clicking a common value filters the rows below to it.
  *DDL* reconstructs the `CREATE TABLE` — real declared types, constraints,
  indexes, comments — ready to copy. *Types* lists enum labels and, per sequence,
  how much room is left measured against whichever ceiling binds first: a
  `bigint` sequence on an `integer` column runs out at 2.1B, not 9.2E18. It also
  flags a sequence sitting *below* its column's maximum, where the next insert
  collides.
- **Schema lens** (`/lens/$schema`) — three views over one merged reference
  graph: a Group × Group matrix of how much the groups reference each other, one
  group drawn on its own with the edges that leave it stubbed at the boundary,
  and a list of tables nothing references. Deterministic layout, no graph
  library. Edges are labelled by where they came from — a real FK constraint, an
  optional schema map, or a column-name rule — and never conflated.
- **SQL console** — every statement runs inside a `BEGIN READ ONLY`
  transaction, so the connection can never write.
- **Query HUD** — a badge in the navbar shows how many queries the last action
  fired, with per-query timings and session stats.
- **Flow docs** (`/flow/$slug`) — a walk through the data, captured to a file and
  rendered as a page: markdown prose, the queries with the rows they returned,
  and links to the tables and rows they came from. Written by `scripts/flow.mjs`
  as an investigation happens — the intended author is an agent that has just
  been running queries. Captured, never live: every page says how old its rows
  are and refuses to re-read them.
- **Connection presets** with `${ENV_VAR}` substitution, so you never commit
  credentials.

> Everything is read-only: the pool is opened with
> `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` and user SQL is wrapped
> in a read-only transaction.

## Requirements

- Node.js 20+
- A reachable PostgreSQL database

## Setup

```bash
npm install

# create your local presets from the example
mkdir -p local && cp presets.example.json local/presets.json
```

Connections live in `local/presets.json`, next to the private schema metadata
they name folders for. Add and remove them from the connect screen — "Save
current" files whatever is in the form under a name, and a chip's `×` forgets
it. Editing the file by hand works just as well.

Keep secrets out of the file by referencing environment variables:

```json
[
  {
    "name": "Local Postgres",
    "host": "127.0.0.1",
    "port": 5432,
    "database": "postgres",
    "user": "postgres",
    "password": "${POSTGRES_PASSWORD}"
  }
]
```

`${VAR}` references are resolved from the process environment at runtime; a
missing variable is reported rather than silently blanked. Saving from the
connect screen rewrites only the preset you saved, so a `${VAR}` in any other
entry survives untouched.

`perf-log.jsonl` and the whole `local/` directory are gitignored by this repo —
they hold credentials and descriptions of your own schema, and are never
committed here. `local/` is expected to be its own private repo; a preset saved
from the UI is a plaintext credential in it.

## Run

```bash
POSTGRES_PASSWORD=yourpassword npm run dev
```

Open http://localhost:3001, pick a preset (or type connection details), and
connect.

## Optional: local schema metadata

Both files live in `local/` and both are optional.

**`local/table-catalog.json`** groups tables and adds descriptions in the
sidebar, and gives the lens its groups:

```json
{
  "groups": [
    { "name": "Users", "description": "...", "order": 1, "tables": ["users"] }
  ],
  "tables": { "users": "User accounts" }
}
```

Without it, tables are grouped by name prefix.

**`local/schema-map.json`** teaches the lens about references your database does
not declare as constraints — common when an ORM strips them, or when a column
points into another database. Generate it from whatever your source of truth is;
the shape is:

```json
{
  "tables": { "users": { "model": "User", "module": "app.models", "group": "Users" } },
  "groups": { "Users": ["users"] },
  "edges": [
    {
      "fromTable": "orders", "fromColumn": "user_id",
      "toTable": "users", "toColumn": "id",
      "basis": "model", "nullable": true
    }
  ],
  "conventions": {
    "byColumn": { "user_id": "users.id" },
    "byTableColumn": {}
  }
}
```

`edges` with `basis: "model"` are authoritative per-table relations; the
`conventions` name rules apply only to columns no constraint and no model edge
already explains. Live constraints always win, and anything unresolved is left
undrawn rather than guessed at.

**`local/<connection>/<database>/<schema>/table-inventory.json`** is the other
side of the catalog: what the schema actually has, written by
`npm run catalog:sync` and never by hand. Every live table with its kind, row
estimate, columns, declared foreign keys in both directions, comment, and the
group and description the catalog currently gives it — plus an `unsorted` list of
the ones no group names. That list is the worklist for curating the catalog after
a migration, and it is what the `organize-table-catalog` skill works from.

## Flow docs

A flow doc is one investigation written down: `local/flows/<slug>.json`, rendered
at `/flow/<slug>`. It exists because the alternative is chat scrollback — an
agent traces how an order reaches billing, and everything it saw is monospace
grids with no links, in a window nobody else can open.

```bash
npm run flow -- new order-lifecycle --title "How an order becomes an invoice" \
  --question "Where does an order's money end up?" --database app --schema public

npm run flow -- add-prose order-lifecycle --md "It starts in \`orders\`."
npm run flow -- add-query order-lifecycle --sql-file /tmp/q.sql --result-file /tmp/rows.json \
  --rows 981 --truncated
npm run flow -- add-rows  order-lifecycle --table public.orders --pk id --ids 42,71
npm run flow -- validate  order-lifecycle
```

Six kinds of block — `prose`, `note`, `query`, `table`, `rows`, `steps` — appended
one command at a time, so the file grows in the order the investigation happened.
Prose can point into the database without knowing route syntax:
`[orders](table:public.orders)` and `[order 42](row:public.orders/42)` become
links to the real pages when the doc names a database.

`--result-file` takes an array of row objects (what an MCP query hands back), a
`pg` result, or the `{ columns, rows }` the format asks for. `--rows N` and
`--truncated` say how many rows there really were, so a five-row sample never
reads as the whole answer.

Two things a flow doc deliberately does not do: re-run anything (a query block
offers *copy* and *open in console* — the console is the one place that runs SQL,
inside a read-only transaction), and claim to be current (the header states the
age of the newest capture, and says so out loud past a week).

*Open in console* opens a **new tab**, so a reader keeps their place in the flow
and can have several consoles open at once. The statement does not travel in the
URL — the link carries a short ticket and the SQL waits in `localStorage` under
it, read once (`src/lib/console-handoff.ts`).

Docs live under `local/`, which this repo does not track: captured rows are real
data. A loose file elsewhere in the repo can be opened with
`/flow/x?file=notes/billing.json`, sandboxed to the repo and to `.json`. The
`flow-doc` skill in `.claude/skills/` is the authoring guide for an agent.

## Scripts

```bash
npm run dev      # dev server on :3001
npm run build    # production build
npm run test     # run the Vitest suite

# refresh one schema's inventory, and prune names the schema no longer has
# out of its catalog
npm run catalog:sync -- --preset "Devgrounds" --database mydb --schema public

# write a flow doc as you investigate; `npm run flow` with no arguments lists
# every subcommand
npm run flow -- list
```

`catalog:sync` defaults to the first remote preset in `local/presets.json`, that
preset's database, and schema `public`; `--schema a,b` does several, and
`--dry-run` reports without writing. It prunes only — dropped tables and their
descriptions leave the catalog, and new tables are left for a person (or the
`organize-table-catalog` skill) to file, because a generated bucket in a curated
file reads as curation.

The other two scripts under `scripts/` are one-offs for bootstrapping a catalog:
`generate-schema-mapping.mjs` writes a derived grouping for every schema on a
connection that has none, and `seed-table-catalog.mjs` carries one database's
curated groups over to another database holding overlapping tables.
