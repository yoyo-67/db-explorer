---
title: "S7: Filtered count strategy (exact <100k, approx + button)"
labels: needs-triage
type: AFK
status: done
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Implement the count branch in `getTablePage`. When the underlying Table's `n_live_tup` is below the 100k threshold, run an exact `SELECT count(*)` for the current filter and return `{ count, isCountApproximate: false }`. Above the threshold, return the approximate `n_live_tup` immediately and expose an on-demand "Exact" button that re-issues the count. The page jumper reflects whichever count is currently in hand.

## Acceptance criteria

- [ ] Tables under 100k `n_live_tup` show an exact filtered count.
- [ ] Tables at or above 100k show an approximate count, labeled with "≈".
- [ ] An "Exact" button next to the approximate count triggers a real `count(*)` and updates the UI.
- [ ] The threshold is centralized as a single named constant.
- [ ] Filtered counts respect the active Filter DSL once S8 lands (test with both no filter and a stub filter).

## Blocked by

- S6
