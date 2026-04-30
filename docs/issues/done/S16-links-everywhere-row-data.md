---
title: "S16: FK + PK links wherever row data is rendered"
labels: needs-triage
type: AFK
status: done
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Today FK/PK links only render in the in-table cell of the Table page. The same values are visible in three more places where they remain plain text:

1. The inline expanded panel that opens when a row in the Table page is clicked (`ExpandedField`).
2. The Row detail page root row fields.
3. The Row detail page child-row fields under "Incoming references".

Make all three sites render FK and PK values as `<Link>`s with the same affordance as the table cells (FK → parent row, PK → row's own detail). Extract a single `LinkableValue` component (or helper) so the four sites share one rendering path.

(3) requires a server change: `RowChildGroup` must carry `columns: ColumnInfo[]` for the child table so the row-detail page can resolve FK metadata for child rows. Existing introspect FK list is reused; columns are fetched once per child table during `getRowDetail`.

PK on the row-detail root is a self-link — render as bold text, not a link, to avoid useless clicks.

## Acceptance criteria

- [ ] Inline expanded panel on Table page renders FK and PK values as `<Link>`s.
- [ ] Row-detail root fields render FK values as `<Link>`s; root PK rendered bold but not linked.
- [ ] Row-detail child rows render FK values as `<Link>`s, and the child-row PK links to that child's own detail page.
- [ ] `RowChildGroup` exposes `columns: ColumnInfo[]` for the child table; FKs pulled from existing introspect.
- [ ] One shared `LinkableValue` (or equivalent helper) is used by all four rendering sites.
- [ ] No new round-trips on row detail beyond what S15 already shapes.

## Blocked by

- S15 (server shape for `RowChildGroup` is already in flux there)
