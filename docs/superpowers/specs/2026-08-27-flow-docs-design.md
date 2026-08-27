# Flow docs — a captured investigation, replayed richly

## The problem

An LLM investigates a database — MCP calls, `execute_sql`, a chain of foreign
keys — and everything it saw is terminal scrollback: monospace result grids with
no links, no schema, no order, gone on the next scroll. The explanation of the
flow lives in prose in a chat window; the evidence lives in another window; the
tables the evidence came from live in a third.

A **flow doc** is one JSON file that holds all three: the narrative, the queries
with the rows they returned, and typed references to the real tables and rows.
db-explorer loads it from a URL and renders it as a page — markdown prose, rich
result tables, and links that open the actual table and row pages of the live
database.

## What it is not

- Not a live dashboard. A flow doc holds **captured** results, stamped with when
  they were captured. It never re-runs anything on load; a stale doc must read as
  stale, not as today's answer.
- Not a query tool. Every query block offers "copy SQL" and "open in console" —
  running it is the console's job, which is already read-only.
- Not schema metadata. `local/<connection>/<database>/<schema>/*.json` describes
  a schema forever. A flow doc describes one investigation, once.

## The format

One file, one flow: `local/flows/<slug>.json` — under `local/`, which this
public repo gitignores, because captured rows are real data.

```json
{
  "version": 1,
  "id": "order-lifecycle",
  "title": "How an order becomes an invoice",
  "question": "Where does an order's money end up?",
  "summary": "Markdown. Two or three sentences.",
  "capturedAt": "2026-08-27T09:14:00.000Z",
  "author": "claude · mcp devgrounds-db",
  "scope": { "database": "app", "schema": "public" },
  "blocks": [ … ]
}
```

`scope` is what turns references into links: a block naming `orders` becomes a
link to `/d/app/t/public/orders`. Absent scope, or a different database in the
URL, and references render as plain names — never as links to somewhere else.

### Blocks

An ordered list, discriminated on `kind`. Every block may carry a `note`
(markdown) and an `id` (anchor for the outline).

| kind | holds | renders as |
|---|---|---|
| `prose` | `markdown` | headings, lists, code, links |
| `note` | `tone` (`info`/`warn`/`gotcha`), `markdown` | callout |
| `query` | `sql`, `result` (columns + rows), `durationMs`, `rowCount`, `truncated`, `ranAt` | SQL with copy / open-in-console, then the rows as a real table |
| `table` | `table` (`schema.name`), `columns?`, `rows?` | table header linking to the table page, optional sample rows |
| `rows` | `table`, `pk`, `items[{ id, label?, fields? }]` | one card per row, each linking to its row page |
| `steps` | `items[{ title, detail, ref? }]` | numbered flow, each step optionally pointing at a table or row |

`result.rows` accepts array-of-arrays (what most drivers hand back) or
array-of-objects; the reader normalises to objects against `result.columns` so
the renderer only ever sees one shape.

### Links inside prose

Markdown links take two extra schemes, so narrative text can point at the
database without knowing route syntax:

- `[orders](table:public.orders)` → the table page
- `[order 42](row:public.orders/42)` → the row page

Unresolvable scope leaves the link text in place, unlinked.

## Loading

`/flow/$slug` reads `local/flows/<slug>.json`. `/flow/$slug?file=<path>` reads a
path instead — resolved inside the repo only, `.json` only, so a URL cannot read
`/etc/passwd`. `/flow` lists what is on disk.

No connection required: like `/help`, a flow doc is readable before there is a
database, because most of it is prose and captured rows. Links light up when the
doc's database is known.

## Authoring

Two ways in, both writing the same file:

- `scripts/flow.mjs` — `new`, `add-prose`, `add-note`, `add-query`, `add-table`,
  `add-rows`, `add-steps`, `append` (a raw block on stdin), `validate`, `list`.
  Every mutation validates before writing, so a half-typed block never lands.
- `.claude/skills/flow-doc/SKILL.md` — the structure, and the pattern for
  turning an MCP `execute_sql` result into an `add-query` call as the
  investigation happens, not afterwards from memory.

## Components

- `src/lib/flow-doc.ts` — types, `parseFlowDoc` (returns errors, never throws),
  row normalisation, outline.
- `src/lib/flow-markdown.ts` — the markdown subset, and `table:`/`row:` link
  resolution. No new dependency: the subset is small and the app already renders
  inline code by hand (`renderInlineCode`).
- `src/server/flows.ts` — list and read, path-sandboxed.
- `src/components/flow/*` — the renderer.
- `src/routes/flow/index.tsx`, `src/routes/flow/$slug.tsx`.

## Testing

Unit tests over the pure parts (parse, normalisation, markdown, link
resolution, path sandbox), a component test over the renderer, and a drift test
asserting the CLI's block-kind list matches the TypeScript one.
