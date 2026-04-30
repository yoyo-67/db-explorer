---
title: "S8: Filter DSL (parser + compiler) + per-column input + sort in URL"
labels: needs-triage
type: AFK
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Implement two deep modules:

- `filter-dsl-parser`: pure `(input string) → Predicate`. Predicate union covers numeric/date comparisons (`>N`, `<N`, `>=N`, `<=N`, `=N`), null checks (`null` / `!null`), regex (`~pattern`), and an ILIKE fallback for any other input.
- `filter-dsl-compiler`: pure `(Predicate, columnName, columnType) → { sql, params }`. Generates a parameterized SQL fragment with proper identifier escaping.

Wire per-column inputs in column headers to the parser; on debounced change, push the predicate into URL params (`col[name]=>10`). Extend `getTablePage` to accept the compiled predicates. Sort state (`sort=col:dir`) goes in the URL too. Existing search behaviors are removed in favor of this DSL.

## Acceptance criteria

- [ ] `filter-dsl-parser` and `filter-dsl-compiler` exist as separate modules with narrow interfaces.
- [ ] Per-column input parses live; the URL updates with the active filters debounced.
- [ ] Numeric, null, regex, and ILIKE predicates all behave correctly against a real table.
- [ ] Sort indicator + URL `sort=col:dir` round-trip on reload.
- [ ] A "Clear filters & sort" button resets both and updates the URL.
- [ ] Old per-column ILIKE-only filtering and `searchTable` server function removed.

## Blocked by

- S6
