---
title: "S14: Vitest unit tests for deep modules"
labels: needs-triage
type: AFK
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Add vitest unit tests for the deep modules introduced by earlier slices. No live database, no jsdom for these — the modules are pure or near-pure. Conventions to establish: one test file per module under `tests/<module-name>.test.ts`, explicit assertions over snapshots (snapshots only for SQL fragments where readability outweighs explicit checks).

Modules to cover:

- `catalog-grouping` — bucket order, `Uncategorized` placement, prefix-fallback shape.
- `filter-dsl-parser` — full input grid (`>10`, `<= 5`, `null`, `!null`, `~^foo`, plain substring); malformed inputs degrade to ILIKE without throwing.
- `filter-dsl-compiler` — `{ sql, params }` for each Predicate × column type; identifier escaping for tricky names.
- `row-label` — PK > FK > short string preference; graceful fallback when none present.
- `preset-resolver` — `${VAR}` substitution from a stub `env`; labeled error for unresolved vars; no silent empty-string substitution.
- `table-query` SQL builder — produced SQL fragment ordering and parameter shape across `{ filter, sort, page, pageSize }`; count-strategy branch selection at the threshold.

## Acceptance criteria

- [ ] One test file per listed module exists.
- [ ] All listed modules have at least the cases above covered.
- [ ] `npm run test` is green.
- [ ] No live PG dependency in any test (no testcontainers, no real connections).

## Blocked by

- S2
- S6
- S8
- S13
