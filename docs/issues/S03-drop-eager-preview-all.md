---
title: "S3: Drop eager preview-all and delete /explorer/preview"
labels: needs-triage
type: AFK
status: done
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Remove the eager `getAllTablesPreview` server function and any call paths that hit it during connect. Each per-Table route loads its own Preview on mount (already in place from S1). Delete the now-redundant `/explorer/preview` route entirely; the sidebar is the sole entry into Table pages. Update any internal links pointing at `/explorer/preview` to send the user to the first Table in the current Schema (or to the connect screen if not connected).

## Acceptance criteria

- [ ] `getAllTablesPreview` and `$getAllTablesPreview` are removed.
- [ ] Connecting to a database with many Tables no longer triggers a bulk preview fetch.
- [ ] `/explorer/preview` route file is removed.
- [ ] No dead imports of the removed symbols remain.
- [ ] Existing nav links that targeted `/explorer/preview` route to a sensible destination instead.

## Blocked by

- S2
