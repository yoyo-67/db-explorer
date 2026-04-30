---
title: "S1: Schema introspector + per-Table route"
labels: needs-triage
type: AFK
status: done
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Land the foundation of URL-as-state navigation. Add a server-side `schema-introspector` deep module returning `{ schemas, tables, columns, fks }` for a given Schema in a single round-trip, replacing the split queries in the current `functions.ts`. Add a header Schema picker that lists available schemas and persists the selection in the URL. Introduce a per-Table route `/t/$schema/$table` that fetches a basic Preview (existing 10-row paging behavior is fine for this slice) and renders columns + rows using the existing DataTable component. The connect screen continues to land on whatever the default landing page is for now; the sidebar is not yet introduced.

This is the tracer bullet through every layer: SQL → server function → server-fn API export → URL → page component → table render.

## Acceptance criteria

- [ ] `schema-introspector` returns `{ schemas, tables, columns, fks }` in one batched introspection per Schema.
- [ ] Header has a Schema dropdown populated from `getSchemas()`. Selection persists in URL.
- [ ] Route `/t/$schema/$table` exists, fetches its own preview on mount, and renders columns + rows.
- [ ] Direct navigation to `/t/$schema/$table` URL works after a fresh load (no dependence on prior in-app navigation).
- [ ] React Query caches Table data so revisiting a Table within a session does not re-hit the database.
- [ ] No regression on connect screen flow.

## Blocked by

None — can start immediately.
