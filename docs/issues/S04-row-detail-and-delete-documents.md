---
title: "S4: Row detail route + delete /explorer/documents"
labels: needs-triage
type: AFK
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Introduce `/t/$schema/$table/row/$id` rendering one row's columns alongside one expandable group per Table holding an FK back to this row. Each child group is a small paged list of related rows. Replace and retire the old Documents page: delete `/explorer/documents`, `getDocumentCollections`, and the `DocumentView` component. Move the inline `getRowLabel` heuristic into a `row-label` deep module and upgrade it to prefer PK then FK-tagged columns then short string fields.

Per ADR-0002, this is the single answer to "where do I look at a row and its children" — the Documents concept is retired.

## Acceptance criteria

- [ ] Route `/t/$schema/$table/row/$id` exists and renders the root row's full set of columns.
- [ ] Incoming-FK children are listed grouped by child Table, each group expandable.
- [ ] Each child group is paged independently (small initial page size, "next page" works).
- [ ] `/explorer/documents` route, `getDocumentCollections`, and `DocumentView` are removed.
- [ ] `row-label` is its own module; the page header label uses it.
- [ ] Direct deep-link to the row-detail URL works on fresh load.

## Blocked by

- S1
