---
title: "S2: Sidebar with Groups tree and search"
labels: needs-triage
type: AFK
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Replace the stacked-cards page with a persistent left sidebar listing Groups (from Catalog) and the Tables under each Group, with an `Uncategorized` bucket for Tables not assigned to a Group. The sidebar has a search box that filters Tables and Groups in place. Clicking a Table navigates to `/t/$schema/$table` (delivered in S1). Each Table row shows its approximate row count.

Extract `catalog-grouping` as a deep module: pure function `(tables, catalog?) → CatalogGroup[]` covering both the Catalog-driven path and the prefix fallback. Move it out of `routes/explorer/preview.tsx`.

## Acceptance criteria

- [ ] Sidebar renders Groups (collapsible) and Tables; `Uncategorized` group exists when needed.
- [ ] Search input filters Tables and Groups in place.
- [ ] Clicking a Table navigates to `/t/$schema/$table`.
- [ ] Each Table row displays approximate row count.
- [ ] Group expansion state persists across navigation within the session.
- [ ] `catalog-grouping` lives in its own module and is consumed by both server and client paths if used in both.
- [ ] Sidebar is shown on every authenticated route except connect.

## Blocked by

- S1
