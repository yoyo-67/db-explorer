---
title: "S12: Connection switcher in header"
labels: needs-triage
type: AFK
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Add a header dropdown listing Presets. Selecting a Preset tears down the current pool and rebuilds it against the chosen Connection, then refreshes the introspector and routes to the first Table in the new Connection's default Schema. The single-pool model is preserved — the dropdown is a swap, not a multi-pool.

## Acceptance criteria

- [ ] Header dropdown shows all Presets.
- [ ] Selecting a Preset cleanly tears down the existing pool, builds the new one, and refreshes Schema/Table data.
- [ ] React Query caches scoped to the previous Connection are invalidated on switch.
- [ ] If the new Connection fails to come up, the switcher surfaces the error and the previous Connection is restored if possible.
- [ ] The connect screen continues to work for ad-hoc connections not in `presets.json`.

## Blocked by

None — can start immediately.
