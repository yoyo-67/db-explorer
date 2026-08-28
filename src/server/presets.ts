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

/**
 * Point a database on this connection at the metadata of another one, or stop
 * pointing it anywhere.
 *
 * The preset is found the way {@link findPresetName} finds it — on the server,
 * not the database — then patched raw, so the `${VAR}` a password may be stays
 * one. A connection that was never saved has nowhere to keep the alias, and is
 * told so rather than silently having it dropped.
 */
export async function setDatabaseAlias(
  config: ConnectionConfig,
  database: string,
  aliasFor: string | null,
): Promise<void> {
  const name = await findPresetName(config)
  if (!name) throw new Error('This connection is not saved — save it as a preset to keep aliases.')

  const presets = await readRawPresets()
  const entry = presets.find((preset) => preset.name === name)
  if (!entry) throw new Error(`Preset "${name}" is no longer in the file.`)

  const aliases = { ...(entry.databaseAliases as Record<string, string> | undefined) }
  if (aliasFor) aliases[database] = aliasFor
  else delete aliases[database]

  if (Object.keys(aliases).length > 0) entry.databaseAliases = aliases
  else delete entry.databaseAliases

  await writeRawPresets(presets)
}

/**
 * Follow a database rename through the file.
 *
 * Three places name a database and all three move: the database a preset
 * connects to, an alias key — the copy that was renamed — and an alias target —
 * the original that was renamed. Nothing else is touched, and no file is not an
 * error: the rename happened on the server either way.
 */
export async function renameDatabaseInPresets(from: string, to: string): Promise<void> {
  const presets = await readRawPresets()
  if (presets.length === 0) return

  for (const entry of presets) {
    if (entry.database === from) entry.database = to
    const aliases = entry.databaseAliases as Record<string, string> | undefined
    if (!aliases) continue
    entry.databaseAliases = Object.fromEntries(
      Object.entries(aliases).map(([database, aliasFor]) => [
        database === from ? to : database,
        aliasFor === from ? to : aliasFor,
      ]),
    )
  }

  await writeRawPresets(presets)
}
