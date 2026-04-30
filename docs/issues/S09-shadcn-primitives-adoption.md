---
title: "S9: Adopt shadcn primitives (Sheet, Sidebar, Command, Dialog, Button, Input, Select)"
labels: needs-triage
type: HITL
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Adopt shadcn primitives incrementally. Bring in `Sheet`, `Sidebar`, `Command`, `Dialog`, `Button`, `Input`, and `Select` via the shadcn CLI. Replace the corresponding ad-hoc elements (sidebar, drawers, command-palette-style search, modal connect errors, form inputs, schema/preset dropdowns) with shadcn versions. Preserve the existing CSS palette (`--lagoon`, `--sea-ink`, etc.) by overriding shadcn's defaults — do not drift to shadcn's default neutral palette.

This is HITL because the visual review on Sidebar and Sheet styling benefits from a human eye.

## Acceptance criteria

- [ ] shadcn primitives listed above are installed and used where each fits.
- [ ] Existing palette tokens still drive colors (no untouched shadcn default neutrals visible).
- [ ] Light/dark mode toggling continues to work across all migrated components.
- [ ] No double-layer of components (e.g. ad-hoc sidebar wrapping a shadcn sidebar).
- [ ] Visual review signed off by the project owner.

## Blocked by

None — can run in parallel with other slices.
