---
title: "S11: CSV download + clipboard JSON export of current view"
labels: needs-triage
type: AFK
status: done
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Add two buttons to the Table page: "Copy as JSON" (clipboard) and "Download CSV". Both export the current view — current Schema, Table, filter, sort, and page. Server endpoint streams CSV with a stable column order matching the on-screen header order; JSON export is the same `rows` payload the page already has, no extra round-trip required.

## Acceptance criteria

- [ ] "Copy as JSON" button copies the current page's rows as a JSON array to the clipboard.
- [ ] "Download CSV" downloads a CSV of the current page (current filter/sort/page applied).
- [ ] Column order in CSV matches the order shown in the UI.
- [ ] Quoting / escaping handles commas, newlines, double quotes, and JSONB cells.
- [ ] Large pages (50 rows) export within reasonable time.

## Blocked by

- S6
- S8
