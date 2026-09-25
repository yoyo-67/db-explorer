# Row neighborhood — design

**Status:** proposed · **Date:** 2026-09-25

## Intent

The lens draws how *tables* connect. Row detail lists one row's parents and
child groups, one hop out, as text. Neither answers the question you have while
chasing a bug: *what is this row actually attached to?* — the order, its
customer, the customer's account, the invoices and shipments hanging off the
order, drawn at once.

Row neighborhood draws that: one row in the middle, the rows it references to
its left, the rows that reference it to its right, one or two hops out.

Success: from any row page, one click shows its real neighbors as a picture; any
neighbor is one click from becoming the center; nothing on screen claims a
number the database did not answer, and a neighborhood never costs an
unbounded scan.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Where | Own route `/d/$database/t/$schema/$table/neighborhood/$id?col=&hops=`, linked from row detail's header | Row detail's `view` param belongs to the sidebar; a route is linkable and keeps the already-large row page untouched. `/t/` paths already feed `schemaFromPathname`, so table names follow the *Table names* setting for free. |
| How far | `hops=1` (default) or `2` | Two hops is where the picture beats the list; three is a hairball. |
| Which direction on hop 2 | Same direction only: parents of parents, children of children | Keeps the graph layered left→right and small. Siblings (a parent's other children) are the Find page's job. |
| Edges | The merged graph's edges (declared / catalog / model / convention), inferred ones drawn dashed with their basis in the tooltip | Same edges row detail and Find use; an inferred link is shown *and* labelled as inferred. |
| Children per edge | Up to 5 rows shown, then a "+N more" node | A node per row does not survive a 40k-child edge. |
| When children are not fetched | Same gate as row detail and Find: the child column must be indexed and the child table under 100k estimated rows; otherwise one "not read" node with the reason and a link to the filtered child table | One rule across the app. A skipped edge is a node that says why, never an absent edge or a zero. |
| Node label | Table name through `TableName`, then the row's key, then one *label column* value if the table has one (`name`, `title`, `label`, `email`, `code`, `slug`, `status`, first found) | Enough to recognise a row without opening it. |
| Layout | Pure, deterministic layered layout: columns −2 … +2, sorted by table then key; SVG, like the lens group view | No graph library, testable without a DOM, stable between reloads. |
| Re-centering | Click a node → its own neighborhood (new URL). A small link on each node opens its row page | The picture is for walking; the row page is for reading. |

Out of scope: cross-database references, editing, siblings, three hops, custom
label columns.

## Architecture

```
route neighborhood/$id.tsx
  └─ useQuery ['rowNeighborhood', db, schema, table, id, col, hops]
       └─ $getRowNeighborhood  (server/api.ts, scoped)
            └─ getRowNeighborhood  (server/row-neighborhood.ts)
                 ├─ fetchTraceEdges(table)          — existing, per table visited, memoised per request
                 ├─ planHop(frontier, edges, stats) — lib/row-neighborhood.ts, pure
                 └─ fetch batches under queryWithTimeout (read-only, SET LOCAL statement_timeout)
  └─ layoutNeighborhood(graph)  — lib/neighborhood-layout.ts, pure
  └─ <NeighborhoodGraph>        — components/neighborhood/, SVG + TableName
```

### Pure core — `src/lib/row-neighborhood.ts`

Types:

- `NeighborKey = { table: string; column: string; value: string }` — how a row
  is addressed (`column` is the key column, usually the PK).
- `NeighborNode`:
  - `{ kind: 'row', id, table, key: NeighborKey, label: string | null, depth: -2|-1|0|1|2 }`
  - `{ kind: 'more', id, table, depth, hidden: number | null, via: EdgeRef }`
    (`hidden: null` when the count itself was not read)
  - `{ kind: 'skipped', id, table, depth, reason: 'unindexed' | 'large' | 'timeout', via: EdgeRef }`
  - `{ kind: 'missing', id, table, depth, key }` — a parent value that points at
    no row (an inferred edge that does not hold, or a dangling id).
- `NeighborEdge = { from: nodeId, to: nodeId, column: string, basis: EdgeBasis }` —
  always drawn child → parent.
- `RowNeighborhood = { root: nodeId, nodes: NeighborNode[], edges: NeighborEdge[], truncated: boolean }`

Functions:

- `nodeId(table, column, value)` — one node per row, however many paths reach it.
- `planHop(frontier, edges, tables, direction)` → the batches to run: for each
  (table, column) a list of values; child batches carry `skip` from the shared
  gate (`countSkipReason` in `row-trace.ts`).
- `mergeHop(graph, results)` → adds nodes and edges, dedups, applies the
  5-per-edge cap and the node budget.
- `labelColumn(columns)` → the label column or `null`.

Limits (constants, exported):

- `CHILDREN_PER_EDGE = 5` (fetch `LIMIT 6` to know there is more; the exact
  hidden count comes from the gated `COUNT(*)` row detail already runs, or is
  `null`).
- `NODE_BUDGET = 80` — once reached, remaining frontier becomes `more` nodes
  and `truncated: true`.
- `HOP_TIMEOUT_MS = 8000` per batch; a timed-out batch becomes `skipped: 'timeout'`
  nodes, the rest of the hop continues.

### Server — `src/server/row-neighborhood.ts`

`getRowNeighborhood({ schema, table, id, col, hops })`:

1. Resolve the root exactly like `getRowDetail` (same key column rules, same
   `id` fallback). Unknown table/column → the same errors row detail throws.
2. For each hop and direction: `fetchTraceEdges` for the tables in the frontier
   (memoised), `planHop`, then run batches:
   - parents: `SELECT <key>, <label> FROM t WHERE col IN (…)` — one statement
     per (target table, target column);
   - children: `SELECT … FROM t WHERE col = %L LIMIT 6` per edge per value,
     several joined with `UNION ALL` per batch; skipped edges are not queried.
   All identifiers through `pg-format` `%I`, values `%L`; every statement
   through `queryWithTimeout` (read-only transaction).
3. `mergeHop`; return `RowNeighborhood`.

Exposed as `$getRowNeighborhood` in `src/server/api.ts` (`Scoped & {…}`).

### Layout — `src/lib/neighborhood-layout.ts`

`layoutNeighborhood(graph)` → `{ width, height, nodes: {id, x, y}[], edges: {from, to, path}[] }`.
Columns by `depth`, fixed node size, rows sorted by (table, key value); column
heights centred on the root; edges as cubic paths between node sides. Pure.

### UI

- `src/routes/d/$database/t/$schema/$table/neighborhood/$id.tsx` — validates
  `col?: string`, `hops?: 1 | 2` (anything else → 1); header with the root's
  `TableName`, a 1/2 hop toggle (`navigate({ replace: true })`), a link back to
  the row page; the graph inside an `island-shell rounded-xl` panel like other
  pages.
- `src/components/neighborhood/NeighborhoodGraph.tsx` — SVG; row nodes show
  `TableName`, key and label; `more` nodes link to the child table filtered by
  the edge column (`encodeConditions` eq); `skipped` nodes print the reason in
  words ("not read — no index on invoices.order_id") and link the same way;
  `missing` nodes read "no row" in the destructive colour; inferred edges dashed.
  Wide graphs scroll horizontally inside the panel.
- Row detail header: a "Neighborhood" link next to "Where else".
- Palette: none in this iteration.

## Error handling

- Root not found → the page says "No row with <col> = <id>", like row detail.
- A batch timeout → `skipped: 'timeout'` nodes for that batch; the page shows
  the rest.
- Graph edges unavailable (introspection error) → error box like other pages;
  no partial "no neighbors" state.
- Unknown is never zero: an unread child count is `hidden: null` ("more"), never
  "+0".

## Testing

- `tests/lib/row-neighborhood.test.ts` — dedup of a row reached twice; per-edge
  cap and `more` node; node budget → `truncated`; gate → `skipped` with reason;
  parent pointing nowhere → `missing`; hop 2 only continues in the same
  direction; `labelColumn` preference order.
- `tests/lib/neighborhood-layout.test.ts` — columns by depth, deterministic
  order, root centred, stable across input order.
- `tests/server/row-neighborhood.test.ts` — mocked db: identifiers quoted, values
  as literals, skipped edges never queried, a timeout becomes `skipped`
  without failing the hop, statements go through `queryWithTimeout`.
- `tests/components/neighborhood/NeighborhoodGraph.test.tsx` — table names via
  the *Table names* setting; skipped node prints its reason; missing node
  renders "no row".
- Help topic `row-neighborhood` (registry test covers anchor and steps).

## Review focus

1. A row reachable along two edges (an order referenced twice by the same
   invoice) — one node, two edges.
2. A self-referencing table (`parent_id` → same table) — must not loop; hop 2
   stops at the budget.
3. A child edge on a huge table with no index — never queried, one `skipped`
   node with reason.
4. Composite or missing primary key on a neighbor table — rows still shown,
   keyed by the edge column; link falls back like row detail's does.
5. `hops=banana` or `hops=3` in the URL → treated as 1.
