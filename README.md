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
cp presets.example.json presets.json
```

Edit `presets.json` with your connection(s). Keep secrets out of the file by
referencing environment variables:

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
missing variable is reported rather than silently blanked.

`presets.json`, `perf-log.jsonl`, and the whole `local/` directory are
gitignored — they hold credentials and descriptions of your own schema, and are
never committed.

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

## Scripts

```bash
npm run dev      # dev server on :3001
npm run build    # production build
npm run test     # run the Vitest suite
```
