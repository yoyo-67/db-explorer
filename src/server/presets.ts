import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { resolvePresets } from '#/lib/preset-resolver'
import type { ConnectionConfig, ConnectionPreset } from '#/lib/types'

/**
 * Connections live in `local/presets.json` — the same private, gitignored
 * folder the schema metadata they name folders for lives in. Absent file is not
 * an error: ad-hoc connections are the other half of how this app is used.
 */
const PRESETS_PATH = ['local', 'presets.json']

function presetsFile(): string {
  return resolve(process.cwd(), ...PRESETS_PATH)
}

/**
 * The file exactly as it sits on disk, `${VARS}` unresolved.
 *
 * Every write goes through this, never through {@link readPresets}. Writing the
 * resolved list back would replace `${PGPASSWORD}` with whatever the env held
 * at that moment — baking the secret into the file and deleting the
 * indirection the author asked for.
 */
async function readRawPresets(): Promise<Array<Record<string, unknown>>> {
  let raw: string
  try {
    raw = await readFile(presetsFile(), 'utf-8')
  } catch {
    return []
  }
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : []
}

async function writeRawPresets(presets: Array<Record<string, unknown>>): Promise<void> {
  const path = presetsFile()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(presets, null, 2)}\n`, 'utf-8')
}

/** The connections named in the file, with `$VARS` resolved from the environment. */
export async function readPresets(): Promise<{
  presets: ConnectionPreset[]
  error: string | null
}> {
  try {
    return { presets: resolvePresets(await readRawPresets(), process.env), error: null }
  } catch (err) {
    return { presets: [], error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Save a connection under its name, replacing any entry already using it.
 *
 * The name is the identity here rather than the server: saving over a preset is
 * how you correct the host you mistyped in it.
 */
export async function upsertPreset(preset: ConnectionPreset): Promise<void> {
  const presets = await readRawPresets()
  const at = presets.findIndex((entry) => entry.name === preset.name)
  if (at === -1) presets.push({ ...preset })
  else presets[at] = { ...preset }
  await writeRawPresets(presets)
}

/**
 * Forget a connection.
 *
 * A name that isn't there leaves the file untouched — including the case where
 * there is no file at all, so a delete racing a delete is not an error. Reading
 * raw means a preset whose `${VAR}` no longer resolves can still be removed;
 * that is precisely the one you want gone.
 */
export async function removePreset(name: string): Promise<void> {
  const presets = await readRawPresets()
  const kept = presets.filter((entry) => entry.name !== name)
  if (kept.length === presets.length) return
  await writeRawPresets(kept)
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
