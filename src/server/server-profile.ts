import { query } from '#/server/db'
import { NOTABLE_SETTINGS, TOOL_SET_SETTINGS } from '#/lib/server-profile/settings'
import type {
  CollationDrift,
  DatabaseLocale,
  ExtensionEntry,
  ServerProfile,
  SettingEntry,
} from '#/lib/server-profile/types'

/**
 * What kind of Postgres this is: the settings somebody changed, the extensions
 * it carries, and the locale its text indexes were built under.
 *
 * Read once per connection and cheap — `pg_settings` is a memory structure, not
 * a table. Several of these reads can be refused by a managed provider, so each
 * one is allowed to fail on its own and say why, rather than taking the panel
 * down with it.
 */

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

/**
 * Run a read that a hosted server may refuse, and turn the refusal into a note.
 *
 * A managed Postgres hides parts of its own catalog behind roles nobody is
 * given, and a panel that renders empty in that case is a panel that lies.
 */
async function attempt<T>(
  notes: string[],
  what: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read()
  } catch (error) {
    notes.push(`${what}: ${error instanceof Error ? error.message : String(error)}`)
    return fallback
  }
}

function toSetting(row: Record<string, unknown>): SettingEntry {
  return {
    name: String(row.name),
    setting: String(row.setting ?? ''),
    unit: toText(row.unit),
    bootValue: toText(row.boot_val),
    source: String(row.source ?? 'unknown'),
    shortDesc: toText(row.short_desc),
    category: toText(row.category),
    context: String(row.context ?? ''),
    vartype: String(row.vartype ?? ''),
    pendingRestart: row.pending_restart === true,
  }
}

export async function getServerProfile(): Promise<ServerProfile> {
  const notes: string[] = []

  const [identity, settingsResult] = await Promise.all([
    query(`
      SELECT
        version()                          AS version,
        current_setting('server_version_num') AS version_num,
        pg_is_in_recovery()                AS in_recovery,
        pg_postmaster_start_time()         AS started_at,
        current_setting('max_connections') AS max_connections,
        (SELECT count(*) FROM pg_stat_activity) AS used_connections
    `),
    query(`
      SELECT name, setting, unit, boot_val, source, short_desc, category, context,
             vartype, pending_restart
      FROM pg_settings
      ORDER BY name
    `),
  ])

  const row = identity.rows[0] ?? {}
  const settings = settingsResult.rows.map(toSetting)
  const byName = new Map(settings.map((entry) => [entry.name, entry]))

  const sessionSet: SettingEntry[] = []
  const changed: SettingEntry[] = []
  for (const entry of settings) {
    const differs = entry.bootValue !== null && entry.bootValue !== entry.setting
    if (!differs) continue
    // `session` and `client` mean this connection did it — including everything
    // this tool sets on the way in. Reporting those as the server's shape would
    // be reporting our own footprint back at the reader.
    if (entry.source === 'session' || entry.source === 'client' || TOOL_SET_SETTINGS.has(entry.name)) {
      sessionSet.push(entry)
      continue
    }
    changed.push(entry)
  }

  const changedNames = new Set(changed.map((entry) => entry.name))
  const notable = NOTABLE_SETTINGS.map((name) => byName.get(name)).filter(
    (entry): entry is SettingEntry => entry !== undefined && !changedNames.has(entry.name),
  )

  const version = toNumber(row.version_num) ?? 0

  const extensions = await attempt<ExtensionEntry[]>(
    notes,
    'Extensions',
    async () => {
      const result = await query(`
        SELECT e.extname AS name,
               e.extversion AS version,
               n.nspname AS schema,
               a.default_version AS available_version
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        LEFT JOIN pg_available_extensions a ON a.name = e.extname
        ORDER BY e.extname
      `)
      return result.rows.map((extension) => ({
        name: String(extension.name),
        version: String(extension.version),
        schema: String(extension.schema),
        availableVersion:
          extension.available_version && extension.available_version !== extension.version
            ? String(extension.available_version)
            : null,
      }))
    },
    [],
  )

  const locale = await attempt<DatabaseLocale | null>(
    notes,
    'Database locale',
    async () => {
      // datlocprovider and datcollversion arrived in Postgres 15; before that a
      // database had one libc collation and no recorded version.
      const modern = version >= 150_000
      const result = await query(`
        SELECT d.datname,
               pg_encoding_to_char(d.encoding) AS encoding,
               d.datcollate,
               d.datctype,
               ${modern ? 'd.datlocprovider::text' : 'NULL::text'} AS locprovider,
               ${modern ? 'd.datcollversion' : 'NULL::text'} AS collversion,
               ${modern ? 'pg_database_collation_actual_version(d.oid)' : 'NULL::text'} AS actual_collversion
        FROM pg_database d
        WHERE d.datname = current_database()
      `)
      const database = result.rows[0]
      if (!database) return null
      return {
        database: String(database.datname),
        encoding: String(database.encoding),
        collate: String(database.datcollate),
        ctype: String(database.datctype),
        localeProvider: toText(database.locprovider),
        collationVersion: toText(database.collversion),
        actualCollationVersion: toText(database.actual_collversion),
      }
    },
    null,
  )

  const collationDrift = await attempt<CollationDrift[]>(
    notes,
    'Collation versions',
    async () => {
      if (version < 100_000) return []
      const result = await query(`
        SELECT c.collname, n.nspname AS schema, c.collversion,
               pg_collation_actual_version(c.oid) AS actual_version
        FROM pg_collation c
        JOIN pg_namespace n ON n.oid = c.collnamespace
        WHERE c.collversion IS NOT NULL
          AND c.collversion IS DISTINCT FROM pg_collation_actual_version(c.oid)
        ORDER BY c.collname
      `)
      return result.rows.map((drift) => ({
        name: String(drift.collname),
        schema: String(drift.schema),
        recordedVersion: toText(drift.collversion),
        actualVersion: toText(drift.actual_version),
      }))
    },
    [],
  )

  return {
    serverVersion: String(row.version ?? 'unknown'),
    serverVersionNum: version,
    isInRecovery: row.in_recovery === true,
    startedAt: toIso(row.started_at),
    changed,
    notable,
    sessionSet,
    extensions,
    locale,
    collationDrift,
    maxConnections: toNumber(row.max_connections),
    usedConnections: toNumber(row.used_connections),
    notes,
  }
}
