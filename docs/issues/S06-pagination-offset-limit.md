---
title: "S6: Offset/limit pagination + page jumper"
labels: needs-triage
type: AFK
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Replace the "Load more +10" mechanism with offset/limit pagination at page size 50, page jumper UI, and `?p=N` in the URL. Introduce a server `getTablePage({ schema, table, page, pageSize }) → { rows, count, columns, pageMeta }` and replace the existing `getTablePreview` consumers. Filter and sort are wired through this same server contract in later slices.

## Acceptance criteria

- [ ] Page size is 50.
- [ ] URL `?p=N` reflects the current page; deep-linking to `?p=3` lands on page 3.
- [ ] Page jumper shows current/total and supports first / prev / next / last / arbitrary page.
- [ ] "Load more" button is gone.
- [ ] `getTablePage` is the single server entry-point used by Table pages.

## Blocked by

- S1
