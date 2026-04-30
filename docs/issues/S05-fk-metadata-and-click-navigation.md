---
title: "S5: FK metadata + FK cell links + FK column badges"
labels: needs-triage
type: AFK
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Extend `ColumnInfo` with `references?: { table, column }` populated from the introspector's FK list. In Table page column headers, show an FK badge identifying the referenced Table; in cells, render FK values as `<Link>` to the corresponding Row detail. Extract a `fk-resolver` deep module: pure helper `(fks, columnName) → { table, column } | undefined` consumed by header and cell rendering.

Hover-peek popovers are explicitly out of scope here — click-to-navigate is the v1 interaction.

## Acceptance criteria

- [ ] `ColumnInfo.references` populated from introspector for every FK column.
- [ ] FK column headers render a clear badge with the referenced Table name.
- [ ] FK cells render as `<Link>` to `/t/$schema/$parent/row/$id`.
- [ ] Browser back button after FK navigation returns to the previous Table view with its filter/sort/page intact.
- [ ] `fk-resolver` is its own module.
- [ ] Non-FK cells render unchanged.

## Blocked by

- S4
