---
title: "S10: SQL console at /console with localStorage history"
labels: needs-triage
type: AFK
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Add a `/console` route with a textarea, a Run button, and a results region that renders successful results through the shared DataTable. Failures render the verbatim Postgres error. Maintain a localStorage history of the last 20 queries with a sidebar list inside the console; clicking a history entry repopulates the textarea. The pool's session-level `READ ONLY` setting is the enforcement mechanism for write rejection — no client-side parsing.

Server: `runReadOnlyQuery(sql) → TableData` (or `{ error }`).

## Acceptance criteria

- [ ] `/console` route exists with textarea + Run button.
- [ ] Successful queries render through the shared DataTable.
- [ ] Failed queries surface the Postgres error message verbatim.
- [ ] Last 20 queries persist in localStorage and survive reload.
- [ ] History entries can be clicked to repopulate the textarea.
- [ ] `Cmd+Enter` runs the query.
- [ ] Attempted writes (e.g. `UPDATE`, `DELETE`, `INSERT`) fail because of the session `READ ONLY` setting; the error is surfaced in the UI.

## Blocked by

- S1
