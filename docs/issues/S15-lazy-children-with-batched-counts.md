---
title: "S15: Lazy children on row detail + batched counts upfront"
labels: needs-triage
type: AFK
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

`getRowDetail` currently runs `Promise.all` over every incoming-FK child table, firing one `SELECT * LIMIT 25` plus one `SELECT COUNT(*)` per child. For a hub table referenced by 30+ children this is 60+ queries on first paint, half of them returning empty.

Replace with a two-phase fetch:

1. **Phase 1 (eager, one round-trip)**: a single batched query returns `{ table → count }` for every incoming-FK target. Postgres parallelizes a UNION-ALL of small `SELECT '<t>' AS t, COUNT(*) FROM <t> WHERE <fk> = $id` selects; counts on indexed FK columns are cheap.
2. **Phase 2 (lazy, on expand)**: a new server function fetches a single child's first N rows when the user expands its group.

Empty children are skipped from the row detail view by default. A "Show empty references" toggle reveals them.

## Acceptance criteria

- [ ] `getRowDetail` returns one `RowChildGroup` per incoming FK with `total` populated but `rows: []` (no per-child SELECT).
- [ ] Counts come from a single batched server round-trip (one query against the database).
- [ ] New `getRowChildren({schema, parentTable, childTable, fkColumn, parentId, limit, offset})` server function fetches rows for one child group on demand.
- [ ] Row detail UI hides empty (`total === 0`) groups by default; a toggle reveals them.
- [ ] Expanding a non-empty child triggers a single LIMIT-N query and renders the rows.
- [ ] No regression on row label, FK column information, or root-row rendering.

## Blocked by

None — can start immediately.
