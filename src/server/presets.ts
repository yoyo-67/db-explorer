import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolvePresets } from '#/lib/preset-resolver'
import type { ConnectionConfig, ConnectionPreset } from '#/lib/types'

/**
 * The connections named in `presets.json`, with `$VARS` resolved from the
 * environment. Absent file is not an error — ad-hoc connections are the other
 * half of how this app is used.
 */
export async function readPresets(): Promise<{
  presets: ConnectionPreset[]
  error: string | null
}> {
  let raw: string
  try {
    raw = await readFile(resolve(process.cwd(), 'presets.json'), 'utf-8')
  } catch {
    return { presets: [], error: null }
  }
  try {
    return { presets: resolvePresets(JSON.parse(raw) as unknown, process.env), error: null }
  } catch (err) {
    return { presets: [], error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Which preset a live config came from, matched on the server it points at
 * rather than on the name the session happens to remember.
 *
 * The name is what private metadata is filed under, so it has to survive a
 * reconnect that lost it, an ad-hoc form filled in with the same details, and a
 * database switch. The database is deliberately not compared: every database on
 * one server is the same connection.
 */
export async function findPresetName(config: ConnectionConfig): Promise<string | null> {
  const { presets } = await readPresets()
  const match = presets.find(
    (preset) =>
      preset.host === config.host &&
      preset.port === config.port &&
      preset.user === config.user,
  )
  return match?.name ?? null
}
