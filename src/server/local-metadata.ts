import { readFile, rename, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { aliasDatabase, connectionSlug, metadataPath, slugify } from '#/lib/local-metadata-path'
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
  const { getLastConfig, resolveDatabase } = await import('#/server/db')
  const config = getLastConfig()
  if (!config) return { connection: null, database: null }

  // The database THIS request is about, not the one the session happened to
  // connect with. Reading `config.database` here filed every page's metadata
  // under the session's database, so a tab on another one was handed the wrong
  // catalog — its tables then fell back to prefix grouping, or to a curated
  // grouping that named none of them.
  //
  // The alias is applied here and nowhere else: every reader — catalogs, schema
  // maps, index samples, cross-database refs — asks this one question, so a copy
  // that stands in for another database answers with that database's name
  // throughout, rather than in whichever readers remembered to translate.
  return {
    connection: connectionSlug({ slug: config.slug, host: config.host }),
    database: aliasDatabase(resolveDatabase() ?? config.database, config.databaseAliases),
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

/**
 * Where a database's metadata folder would move to, or null when there is
 * nothing to move.
 *
 * Split from the move itself because the caller renaming a database has to know
 * the move is possible *before* it changes the server: a refusal afterwards
 * leaves the database and its metadata disagreeing with no way back. A
 * destination that already exists is refused rather than merged — two curated
 * folders sharing a name is how one database's grouping ends up labelling
 * another's tables.
 */
export async function planDatabaseMetadataMove(
  connection: string,
  from: string,
  to: string,
): Promise<{ from: string; to: string } | null> {
  const fromSlug = slugify(from)
  const toSlug = slugify(to)
  if (fromSlug === toSlug) return null

  const dir = (slug: string) => resolve(process.cwd(), LOCAL_DIR, connection, slug)
  const isFolder = async (path: string) => {
    try {
      return (await stat(path)).isDirectory()
    } catch {
      return false
    }
  }

  if (!(await isFolder(dir(fromSlug)))) return null
  if (await isFolder(dir(toSlug))) {
    throw new Error(`local/${connection}/${toSlug} already exists — move or remove it first.`)
  }
  return { from: dir(fromSlug), to: dir(toSlug) }
}

/** Carry out a move {@link planDatabaseMetadataMove} said was possible. */
export async function applyDatabaseMetadataMove(plan: {
  from: string
  to: string
}): Promise<void> {
  await rename(plan.from, plan.to)
}

/**
 * Move a database's metadata folder to the name the database now has.
 *
 * The folder is named after the database, so a rename on the server has to move
 * it or every catalog and schema map written about that database goes unread.
 * Returns whether anything moved: a database nobody has described has no folder,
 * which is the ordinary case and not an error.
 */
export async function moveDatabaseMetadata(
  connection: string,
  from: string,
  to: string,
): Promise<boolean> {
  const plan = await planDatabaseMetadataMove(connection, from, to)
  if (!plan) return false
  await applyDatabaseMetadataMove(plan)
  return true
}
