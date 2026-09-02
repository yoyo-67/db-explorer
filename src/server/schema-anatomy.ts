import { query } from '#/server/db'
import type {
  CacheEntry,
  ExtendedStatsEntry,
  FreezeEntry,
  PartitionEntry,
  PolicyEntry,
  RowLayoutEntry,
  SchemaAnatomy,
  StatsCandidate,
  TriggerEntry,
} from '#/lib/anatomy/types'
import type { PhysicalColumn, StorageMode, TypeAlign } from '#/lib/physical/types'

/**
 * The structural read of a whole schema: every table's column layout, its two
 * freeze clocks, how much of its reading came from memory, and the parts of the
 * schema that do work no query mentions — partitions, triggers, policies, and
 * the multi-column statistics nobody created.
 *
 * Facts only; the rules that turn them into findings live under `lib/anatomy/*`
 * and `lib/physical/*`. Catalog and statistics reads throughout, so the cost
 * does not move with the size of the data.
 */

const DEFAULT_SCHEMA = 'public'

async function serverVersionNum(): Promise<number> {
  const result = await query('SHOW server_version_num')
  const parsed = Number(result.rows[0]?.server_version_num)
  return Number.isFinite(parsed) ? parsed : 0
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function toNameArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value !== 'string') return []
  const body = value.trim().replace(/^\{/, '').replace(/\}$/, '')
  if (body === '') return []
  return body
    .split(',')
    .map((part) => part.trim().replace(/^"(.*)"$/, '$1'))
    .filter((part) => part.length > 0)
}

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

const ALIGNS = new Set(['c', 's', 'i', 'd'])
const STORAGES = new Set(['p', 'm', 'e', 'x'])

function toAlign(value: unknown): TypeAlign {
  const text = String(value ?? '')
  return (ALIGNS.has(text) ? text : 'c') as TypeAlign
}

function toStorage(value: unknown, fallback: StorageMode = 'p'): StorageMode {
  const text = String(value ?? '')
  return (STORAGES.has(text) ? text : fallback) as StorageMode
}

/**
 * The trigger's timing, spelled out from `tgtype`'s bits — the same bits
 * `pg_get_triggerdef` reads, kept here so the list costs one query rather than
 * one per trigger.
 */
function triggerTiming(tgtype: number): string {
  const row = (tgtype & 1) !== 0
  const timing = (tgtype & 2) !== 0 ? 'BEFORE' : (tgtype & 64) !== 0 ? 'INSTEAD OF' : 'AFTER'
  const events: string[] = []
  if ((tgtype & 4) !== 0) events.push('INSERT')
  if ((tgtype & 8) !== 0) events.push('DELETE')
  if ((tgtype & 16) !== 0) events.push('UPDATE')
  if ((tgtype & 32) !== 0) events.push('TRUNCATE')
  return `${timing} ${events.join(' OR ')} FOR EACH ${row ? 'ROW' : 'STATEMENT'}`
}

export async function getSchemaAnatomy(
  schema: string = DEFAULT_SCHEMA,
): Promise<SchemaAnatomy> {
  const notes: string[] = []
  const version = await serverVersionNum()
  const compressionColumn = version >= 140_000 ? 'a.attcompression::text' : `''::text`

  const [tableResult, columnResult, freezeResult] = await Promise.all([
    query(
      `
      SELECT c.relname AS table_name,
             c.reltuples::float8 AS est_rows,
             pg_relation_size(c.oid) AS heap_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
      ORDER BY c.relname
    `,
      [schema],
    ),
    query(
      `
      SELECT c.relname AS table_name,
             a.attnum,
             a.attname AS name,
             a.attisdropped AS dropped,
             a.attnotnull AS not_null,
             format_type(a.atttypid, a.atttypmod) AS type,
             t.typlen, t.typalign, t.typstorage,
             a.attstorage,
             ${compressionColumn} AS compression,
             s.avg_width, s.null_frac
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_stats s
        ON s.schemaname = n.nspname AND s.tablename = c.relname AND s.attname = a.attname
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND a.attnum > 0
      ORDER BY c.relname, a.attnum
    `,
      [schema],
    ),
    query(
      `
      SELECT c.relname AS table_name,
             age(c.relfrozenxid)::bigint AS frozen_age,
             mxid_age(c.relminmxid)::bigint AS multixact_age,
             c.relpages::bigint AS relpages,
             c.relallvisible::bigint AS relallvisible,
             pg_total_relation_size(c.oid) AS total_bytes,
             COALESCE((
               SELECT o.option_value FROM pg_options_to_table(c.reloptions) o
               WHERE o.option_name = 'autovacuum_freeze_max_age'
             )::bigint, current_setting('autovacuum_freeze_max_age')::bigint) AS freeze_max_age,
             COALESCE((
               SELECT o.option_value FROM pg_options_to_table(c.reloptions) o
               WHERE o.option_name = 'autovacuum_multixact_freeze_max_age'
             )::bigint, current_setting('autovacuum_multixact_freeze_max_age')::bigint)
               AS multixact_freeze_max_age
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = 'r'
      ORDER BY c.relname
    `,
      [schema],
    ),
  ])

  const columnsByTable = new Map<string, PhysicalColumn[]>()
  for (const row of columnResult.rows) {
    const table = String(row.table_name)
    const list = columnsByTable.get(table) ?? []
    list.push({
      name: String(row.name),
      attnum: toNumber(row.attnum),
      dropped: row.dropped === true,
      type: row.dropped === true ? 'dropped' : String(row.type),
      typlen: toNumber(row.typlen),
      align: toAlign(row.typalign),
      typstorage: toStorage(row.typstorage),
      storage: toStorage(row.attstorage, toStorage(row.typstorage)),
      compression:
        String(row.compression ?? '') === 'p'
          ? 'pglz'
          : String(row.compression ?? '') === 'l'
            ? 'lz4'
            : String(row.compression ?? '') === ''
              ? null
              : 'default',
      notNull: row.not_null === true,
      avgWidth: toNullableNumber(row.avg_width),
      nullFraction: toNullableNumber(row.null_frac),
    })
    columnsByTable.set(table, list)
  }

  const layouts: RowLayoutEntry[] = tableResult.rows.map((row) => ({
    table: String(row.table_name),
    estimatedRows: Math.max(0, toNumber(row.est_rows)),
    heapBytes: toNumber(row.heap_bytes),
    columns: columnsByTable.get(String(row.table_name)) ?? [],
  }))

  const freeze: FreezeEntry[] = freezeResult.rows.map((row) => ({
    table: String(row.table_name),
    frozenAge: toNullableNumber(row.frozen_age),
    multixactAge: toNullableNumber(row.multixact_age),
    freezeMaxAge: toNumber(row.freeze_max_age, 200_000_000),
    multixactFreezeMaxAge: toNumber(row.multixact_freeze_max_age, 400_000_000),
    relpages: toNumber(row.relpages),
    relallvisible: toNumber(row.relallvisible),
    totalBytes: toNumber(row.total_bytes),
  }))

  const cache = await attempt<CacheEntry[]>(
    notes,
    'Cache counters',
    async () => {
      const result = await query(
        `
        SELECT relname AS table_name,
               COALESCE(heap_blks_read, 0)  AS heap_read,
               COALESCE(heap_blks_hit, 0)   AS heap_hit,
               COALESCE(idx_blks_read, 0)   AS index_read,
               COALESCE(idx_blks_hit, 0)    AS index_hit,
               COALESCE(toast_blks_read, 0) AS toast_read,
               COALESCE(toast_blks_hit, 0)  AS toast_hit
        FROM pg_statio_user_tables
        WHERE schemaname = $1
      `,
        [schema],
      )
      return result.rows.map((row) => ({
        table: String(row.table_name),
        heapRead: toNumber(row.heap_read),
        heapHit: toNumber(row.heap_hit),
        indexRead: toNumber(row.index_read),
        indexHit: toNumber(row.index_hit),
        toastRead: toNumber(row.toast_read),
        toastHit: toNumber(row.toast_hit),
      }))
    },
    [],
  )

  const partitions = await attempt<PartitionEntry[]>(
    notes,
    'Partitions',
    async () => {
      if (version < 100_000) return []
      const result = await query(
        `
        SELECT parent.relname AS table_name,
               pt.partstrat::text AS strategy,
               pg_get_partkeydef(parent.oid) AS partition_key,
               child.relname AS partition_name,
               pg_get_expr(child.relpartbound, child.oid) AS bounds,
               pg_total_relation_size(child.oid) AS bytes,
               child.reltuples::float8 AS est_rows
        FROM pg_class parent
        JOIN pg_namespace n ON n.oid = parent.relnamespace
        JOIN pg_partitioned_table pt ON pt.partrelid = parent.oid
        LEFT JOIN pg_inherits inh ON inh.inhparent = parent.oid
        LEFT JOIN pg_class child ON child.oid = inh.inhrelid
        WHERE n.nspname = $1
        ORDER BY parent.relname, bytes DESC NULLS LAST
      `,
        [schema],
      )
      const byParent = new Map<string, PartitionEntry>()
      for (const row of result.rows) {
        const table = String(row.table_name)
        const strategyCode = String(row.strategy ?? '')
        const entry =
          byParent.get(table) ??
          ({
            table,
            strategy:
              strategyCode === 'r'
                ? 'range'
                : strategyCode === 'l'
                  ? 'list'
                  : strategyCode === 'h'
                    ? 'hash'
                    : 'unknown',
            key: String(row.partition_key ?? ''),
            partitionCount: 0,
            totalBytes: 0,
            defaultPartition: null,
            partitions: [],
          } satisfies PartitionEntry)
        if (row.partition_name) {
          const bounds = String(row.bounds ?? '')
          entry.partitions.push({
            name: String(row.partition_name),
            bounds,
            bytes: toNumber(row.bytes),
            estimatedRows: Math.max(0, toNumber(row.est_rows)),
          })
          entry.partitionCount += 1
          entry.totalBytes += toNumber(row.bytes)
          if (/DEFAULT/i.test(bounds)) entry.defaultPartition = String(row.partition_name)
        }
        byParent.set(table, entry)
      }
      return [...byParent.values()].sort((a, b) => b.totalBytes - a.totalBytes)
    },
    [],
  )

  const [triggers, constraintTriggerCounts] = await attempt<
    [TriggerEntry[], Record<string, number>]
  >(
    notes,
    'Triggers',
    async () => {
      const result = await query(
        `
        SELECT c.relname AS table_name,
               tg.tgname AS name,
               tg.tgtype::int AS tgtype,
               tg.tgenabled <> 'D' AS enabled,
               tg.tgisinternal AS is_internal,
               tg.tgconstraint <> 0 AS is_constraint,
               pn.nspname || '.' || p.proname AS function_name
        FROM pg_trigger tg
        JOIN pg_class c ON c.oid = tg.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = tg.tgfoid
        JOIN pg_namespace pn ON pn.oid = p.pronamespace
        WHERE n.nspname = $1
        ORDER BY c.relname, tg.tgname
      `,
        [schema],
      )
      const entries: TriggerEntry[] = []
      const counts: Record<string, number> = {}
      for (const row of result.rows) {
        const table = String(row.table_name)
        const isConstraint = row.is_constraint === true || row.is_internal === true
        if (isConstraint) {
          counts[table] = (counts[table] ?? 0) + 1
          continue
        }
        entries.push({
          table,
          name: String(row.name),
          timing: triggerTiming(toNumber(row.tgtype)),
          functionName: String(row.function_name),
          enabled: row.enabled === true,
          isConstraint: false,
        })
      }
      return [entries, counts]
    },
    [[], {}],
  )

  const policies = await attempt<PolicyEntry[]>(
    notes,
    'Row-level security',
    async () => {
      const result = await query(
        `
        SELECT c.relname AS table_name,
               pol.polname AS name,
               pol.polcmd::text AS command,
               pol.polpermissive AS permissive,
               ARRAY(
                 SELECT pg_get_userbyid(role_oid) FROM unnest(pol.polroles) AS role_oid
               )::text[] AS roles,
               pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
               pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
               c.relrowsecurity AS row_security,
               c.relforcerowsecurity AS force_row_security
        FROM pg_policy pol
        JOIN pg_class c ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
        ORDER BY c.relname, pol.polname
      `,
        [schema],
      )
      return result.rows.map((row) => ({
        table: String(row.table_name),
        name: String(row.name),
        command:
          { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' }[
            String(row.command)
          ] ?? String(row.command),
        permissive: row.permissive === true,
        roles: toNameArray(row.roles),
        using: toText(row.using_expr),
        withCheck: toText(row.check_expr),
        rowSecurityEnabled: row.row_security === true,
        rowSecurityForced: row.force_row_security === true,
      }))
    },
    [],
  )

  const extendedStats = await attempt<ExtendedStatsEntry[]>(
    notes,
    'Extended statistics',
    async () => {
      if (version < 100_000) return []
      const result = await query(
        `
        SELECT c.relname AS table_name,
               st.stxname AS name,
               ARRAY(
                 SELECT a.attname FROM unnest(st.stxkeys) AS k(attnum)
                 JOIN pg_attribute a ON a.attrelid = st.stxrelid AND a.attnum = k.attnum
               )::text[] AS columns,
               st.stxkind::text[] AS kinds
        FROM pg_statistic_ext st
        JOIN pg_class c ON c.oid = st.stxrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
      `,
        [schema],
      )
      return result.rows.map((row) => ({
        table: String(row.table_name),
        name: String(row.name),
        columns: toNameArray(row.columns),
        kinds: toNameArray(row.kinds),
      }))
    },
    [],
  )

  const statsCandidates = await attempt<StatsCandidate[]>(
    notes,
    'Correlated column candidates',
    async () => {
      const result = await query(
        `
        SELECT c.relname AS table_name,
               i.relname AS source,
               'multicolumn-index' AS reason,
               ARRAY(
                 SELECT a.attname FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
                 WHERE k.attnum > 0
                 ORDER BY k.ord
               )::text[] AS columns
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_class c ON c.oid = x.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r' AND x.indnatts > 1 AND x.indexprs IS NULL

        UNION ALL

        SELECT c.relname,
               con.conname,
               CASE con.contype WHEN 'f' THEN 'composite-foreign-key' ELSE 'primary-key' END,
               ARRAY(
                 SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
                 ORDER BY k.ord
               )::text[]
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND con.contype IN ('f', 'p')
          AND array_length(con.conkey, 1) > 1
      `,
        [schema],
      )
      return result.rows.map((row) => ({
        table: String(row.table_name),
        columns: toNameArray(row.columns),
        reason: String(row.reason) as StatsCandidate['reason'],
        source: String(row.source),
      }))
    },
    [],
  )

  return {
    schema,
    serverVersionNum: version,
    layouts,
    freeze,
    cache,
    partitions,
    triggers,
    constraintTriggerCounts,
    policies,
    extendedStats,
    statsCandidates,
    notes,
  }
}
