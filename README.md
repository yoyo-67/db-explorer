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
  child counts.
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

`presets.json`, `perf-log.jsonl`, and `table-catalog.json` are gitignored — they
hold local/credential/schema data and are never committed.

## Run

```bash
POSTGRES_PASSWORD=yourpassword npm run dev
```

Open http://localhost:3000, pick a preset (or type connection details), and
connect.

## Optional: table catalog

Drop a `table-catalog.json` at the project root to group tables and add
descriptions in the sidebar. Shape:

```json
{
  "groups": [
    { "name": "Users", "description": "...", "order": 1, "tables": ["users"] }
  ],
  "tables": { "users": "User accounts" }
}
```

Without it, tables are listed flat.

## Scripts

```bash
npm run dev      # dev server on :3000
npm run build    # production build
npm run test     # run the Vitest suite
```
