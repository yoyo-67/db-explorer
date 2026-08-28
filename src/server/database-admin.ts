import pg from 'pg'
import { connectionSlug } from '#/lib/local-metadata-path'
import {
  applyDatabaseMetadataMove,
  planDatabaseMetadataMove,
} from '#/server/local-metadata'
import { renameDatabaseInPresets } from '#/server/presets'

/**
 * Renaming and dropping a database — the two statements the app's pools cannot
 * carry.
 *
 * Neither may run inside a transaction block, and every pooled connection is
 * marked `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, so
 * `withWriteTransaction` — the auditable path for changing a *row* — is the
 * wrong instrument twice over. A drop has a third problem: a pool open on the
 * target database is itself what makes the drop fail.
 *
 * So each operation opens one short-lived client on a *different* database,
 * lifts the read-only default on that session alone, frees the target of other
 * sessions, and issues its one statement. Everything that can change a database
 * lives in this file: grep for `ALTER DATABASE` or `DROP DATABASE` and you have
 * found all of it.
 *
 * A rename is not only a server-side change. The metadata folder under `local/`
 * is named after the database, and `presets.json` names it too, so both follow —
 * and the folder move is *checked before* the DDL runs, because a refusal
 * afterwards would leave the database and its metadata disagreeing.
 */

/** Databases that exist to be copied, not renamed or dropped. */
const TEMPLATES = new Set(['template0', 'template1'])

/** Databases to reach the server through, best first, when a target is excluded. */
const FALLBACK_ADMIN_DATABASES = ['postgres', 'template1']

/**
 * A database name as an identifier.
 *
 * Neither statement here can take the name as a parameter — Postgres has no
 * parameter slot for an identifier — so it is quoted, and a name that cannot be
 * quoted safely is refused rather than escaped into something else.
 */
export function quoteIdent(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A database name is required.')
  if (trimmed.includes('\0')) throw new Error(`Not a usable database name: ${JSON.stringify(name)}`)
  return `"${trimmed.replace(/"/g, '""')}"`
}

/** The credentials in play, or a refusal — this module never guesses a login. */
async function sessionConfig() {
  const { getLastConfig } = await import('#/server/db')
  const config = getLastConfig()
  if (!config) throw new Error('Not connected — connect before renaming or dropping a database.')
  return config
}

/**
 * Which database to speak to the server through, given one that is off limits.
 *
 * The session's own database first: it is proven to accept this login. When
 * that is the target — renaming the database you connected with is the ordinary
 * case for a restored dump — fall back to `postgres`, then `template1`, which
 * every cluster has.
 */
function adminDatabaseFor(target: string, sessionDatabase: string): string {
  const candidate = [sessionDatabase, ...FALLBACK_ADMIN_DATABASES].find((name) => name !== target)
  if (!candidate) throw new Error(`No other database to reach the server through than ${target}.`)
  return candidate
}

/**
 * Run one statement on a session of its own, read-write, and close it.
 *
 * `end()` in a finally: a leaked client is a connection to a database somebody
 * is trying to drop.
 */
async function onAdminSession<T>(
  target: string,
  body: (run: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>,
): Promise<T> {
  const config = await sessionConfig()
  const client = new pg.Client({
    host: config.host,
    port: config.port,
    database: adminDatabaseFor(target, config.database),
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  })

  await client.connect()
  try {
    // The pools are read-only by default; this session is the exception, and
    // says so in one place.
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE')
    return await body((sql, params) => client.query(sql, params))
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * Disconnect everyone else from a database.
 *
 * Both statements refuse while any session is attached, and the app's own pool
 * on that database is closed separately by the caller. The name goes in as a
 * parameter — this one has a slot for it.
 */
async function freeDatabase(
  run: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>,
  database: string,
): Promise<void> {
  await run(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [database],
  )
}

function refuseTemplate(database: string): void {
  if (TEMPLATES.has(database)) {
    throw new Error(`${database} is a template database — leave it alone.`)
  }
}

/**
 * Rename a database, and follow the rename through everything named after it.
 *
 * Order is the design: the folder move is planned first, so a collision refuses
 * while the server is still untouched; then the DDL; then the stale pool on the
 * old name goes, the folder moves, and `presets.json` catches up.
 */
export async function renameDatabase(
  from: string,
  to: string,
): Promise<{ metadataMoved: boolean }> {
  const fromIdent = quoteIdent(from)
  const toIdent = quoteIdent(to)
  if (from.trim() === to.trim()) throw new Error('That is the same name it already has.')
  refuseTemplate(from)
  refuseTemplate(to)

  const config = await sessionConfig()
  const connection = connectionSlug({ slug: config.slug, host: config.host })
  const move = await planDatabaseMetadataMove(connection, from, to)

  await onAdminSession(from, async (run) => {
    await freeDatabase(run, from)
    await run(`ALTER DATABASE ${fromIdent} RENAME TO ${toIdent}`)
  })

  const { closePoolFor, renameSessionDatabase } = await import('#/server/db')
  await closePoolFor(from)
  renameSessionDatabase(from, to)
  if (move) await applyDatabaseMetadataMove(move)
  await renameDatabaseInPresets(from, to)

  return { metadataMoved: Boolean(move) }
}

/**
 * Drop a database.
 *
 * The metadata folder under `local/` stays: a hand-curated catalog outlives the
 * restore it was written against, and a dropped copy is usually replaced by
 * another dump of the same database tomorrow.
 */
export async function dropDatabase(database: string): Promise<void> {
  const ident = quoteIdent(database)
  refuseTemplate(database)
  await sessionConfig()

  // Before the statement, not after: the drop fails while this app holds a
  // connection of its own on the database.
  const { closePoolFor } = await import('#/server/db')
  await closePoolFor(database)

  await onAdminSession(database, async (run) => {
    await freeDatabase(run, database)
    await run(`DROP DATABASE ${ident}`)
  })
}
