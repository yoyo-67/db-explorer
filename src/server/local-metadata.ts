import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { connectionSlug, metadataPath } from '#/lib/local-metadata-path'
import type { SchemaMap, TableCatalog } from '#/lib/types'

/**
 * Internal schema metadata lives in `local/` — gitignored by this repo, which is
 * public, and kept in its own private git repo. Every file is hand- or
 * extractor-produced and may simply be absent: each reader returns null instead
 * of throwing, and the lens shows the gap in its staleness panel.
 *
 * Metadata is keyed by connection, database and schema — see
 * `#/lib/local-metadata-path` for why all three:
 *
 *   local/<connection>/<database>/<schema>/table-catalog.json   groups, hand-curated
 *   local/<connection>/<database>/<schema>/schema-map.json      extractor output
 *
 * `schema-map.json` is written by an external extractor — see that repo for how
 * to regenerate it.
 */

const LOCAL_DIR = 'local'

async function readLocalJson<T>(segments: string[]): Promise<T | null> {
  try {
    const path = resolve(process.cwd(), LOCAL_DIR, ...segments)
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

/**
 * Which connection and database the reads are scoped to.
 *
 * Read off the live pool's config rather than passed in: every caller already
 * asks about "the schema I am looking at", and the connection behind it is not
 * theirs to know. Nothing connected means nothing to read, which is not an
 * error — the lens reports missing metadata as a gap.
 */
export async function currentScope(): Promise<{
  connection: string | null
  database: string | null
}> {
  const { getLastConfig, getPresetName, resolveDatabase } = await import('#/server/db')
  const config = getLastConfig()
  if (!config) return { connection: null, database: null }

  // The session's own preset name first, then the one `local/presets.json` gives this
  // server. Without that second look the folder would move the moment a
  // reconnect forgot the name — and a host that rotates (a managed endpoint
  // reassigned nightly, say) would take the fallback somewhere new every day.
  const { findPresetName } = await import('#/server/presets')
  const presetName = getPresetName() ?? (await findPresetName(config))

  // The database THIS request is about, not the one the session happened to
  // connect with. Reading `config.database` here filed every page's metadata
  // under the session's database, so a tab on another one was handed the wrong
  // catalog — its tables then fell back to prefix grouping, or to a curated
  // grouping that named none of them.
  return {
    connection: connectionSlug({ presetName, host: config.host, port: config.port }),
    database: resolveDatabase() ?? config.database,
  }
}

async function readForSchema<T>(schema: string, fileName: string): Promise<T | null> {
  const { connection, database } = await currentScope()
  const segments = metadataPath({ connection, database, schema, fileName })
  if (!segments) return null
  return readLocalJson<T>(segments)
}

export function readTableCatalog(schema: string): Promise<TableCatalog | null> {
  return readForSchema<TableCatalog>(schema, 'table-catalog.json')
}

export function readSchemaMap(schema: string): Promise<SchemaMap | null> {
  return readForSchema<SchemaMap>(schema, 'schema-map.json')
}
