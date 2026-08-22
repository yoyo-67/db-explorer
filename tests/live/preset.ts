import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolvePresets } from '#/lib/preset-resolver'
import type { ConnectionPreset } from '#/lib/types'

/**
 * The connection a live check runs against, read from `local/presets.json` —
 * gitignored, so the checks themselves carry no host, user or password and can
 * live in this repo.
 *
 * `${VARS}` are resolved the same way the server resolves them, so a preset
 * that keeps its password in the environment works here too.
 *
 * `LIVE_PRESET` picks one by name (a prefix is enough); without it the first
 * preset wins. A missing file is a setup problem rather than something to
 * diagnose from a test body, so this throws with the fix in the message.
 */
export function livePreset(): ConnectionPreset {
  const path = resolve(process.cwd(), 'local', 'presets.json')
  let presets: ConnectionPreset[]
  try {
    presets = resolvePresets(JSON.parse(readFileSync(path, 'utf-8')), process.env)
  } catch (err) {
    throw new Error(`live checks need ${path}: ${err instanceof Error ? err.message : err}`)
  }

  const wanted = process.env.LIVE_PRESET
  const preset = wanted ? presets.find((p) => p.name.startsWith(wanted)) : presets[0]
  if (!preset) {
    throw new Error(
      `no preset ${wanted ? `whose name starts with ${wanted}` : 'at all'} in ${path}` +
        ` — have: ${presets.map((p) => p.name).join(', ') || '(none)'}`,
    )
  }
  return preset
}
