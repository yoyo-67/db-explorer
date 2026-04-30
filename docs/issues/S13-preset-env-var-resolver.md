---
title: "S13: Preset password ${ENV_VAR} resolver + .gitignore"
labels: needs-triage
type: AFK
---

## Parent

`docs/prd-ui-overhaul.md`

## What to build

Extract a `preset-resolver` deep module: pure `(rawPresetsJson, env) → ConnectionPreset[]`. It scans every string field for `${VAR_NAME}` patterns and substitutes from the supplied `env`. Unresolved variables produce a clearly-labeled error containing the missing variable name; partial resolution must not silently emit empty strings. The server `$getPresets` calls this resolver against `process.env`.

Add `presets.json` to `.gitignore`. Keep `presets.example.json` as the committed example, with `${POSTGRES_PASSWORD}`-style placeholders.

## Acceptance criteria

- [ ] `preset-resolver` exists as its own module with the documented interface.
- [ ] `${VAR_NAME}` references in any string field of `presets.json` resolve at server-fn time.
- [ ] Missing env vars surface a labeled error at connect time, not at server start.
- [ ] `presets.json` is added to `.gitignore`.
- [ ] `presets.example.json` uses `${ENV_VAR}` placeholders, not literal passwords.
- [ ] Existing Presets without `${...}` references continue to work unchanged.

## Blocked by

None — can start immediately.
