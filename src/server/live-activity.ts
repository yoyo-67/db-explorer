import { query } from '#/server/db'
import type {
  BackendEntry,
  DatabaseCounters,
  LiveActivity,
  LockSummaryEntry,
  PreparedTransactionEntry,
  ProgressEntry,
  ReplicaEntry,
  ReplicationSlotEntry,
} from '#/lib/live/types'

/**
 * What the server is doing at the moment of the read.
 *
 * Unlike every other read in this tool, none of this is stable: a lock is gone
 * before the page renders, a slot fills over days, a vacuum finishes. So it is
 * stamped with `takenAt`, never cached as catalog, and fetched only while
 * something is actually looking at it.
 *
 * Managed Postgres refuses several of these views to an ordinary role. Each read
 * is allowed to fail alone and leave a note; a panel that renders empty where it
 * was refused would be a panel that lies.
 */

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNullableNumber(value: unknown): number | null {
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

function toPidArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((item) => Number(item)).filter(Number.isFinite)
  if (typeof value !== 'string') return []
  return value
    .replace(/^\{/, '')
    .replace(/\}$/, '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((pid) => Number.isFinite(pid) && pid > 0)
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

/** A ratio only where the view reports both halves of it. */
function fraction(done: unknown, total: unknown): number | null {
  const a = toNullableNumber(done)
  const b = toNullableNumber(total)
  if (a === null || b === null || b <= 0) return null
  return Math.min(1, Math.max(0, a / b))
}

export async function getLiveActivity(): Promise<LiveActivity> {
  const notes: string[] = []
  const takenAt = new Date().toISOString()

  const identity = await query(`
    SELECT current_setting('server_version_num') AS version_num,
           pg_is_in_recovery() AS in_recovery,
           current_setting('max_connections') AS max_connections
  `)
  const version = toNumber(identity.rows[0]?.version_num)
  const isInRecovery = identity.rows[0]?.in_recovery === true

  const backends = await attempt<BackendEntry[]>(
    notes,
    'Backends',
    async () => {
      // pg_blocking_pids arrived in 9.6. Without it there is no cheap way to ask
      // who blocks whom, and inventing one from pg_locks would be a guess.
      const blocking = version >= 90_600 ? 'pg_blocking_pids(a.pid)' : `'{}'::int[]`
      const result = await query(`
        SELECT a.pid,
               a.usename                AS username,
               a.application_name,
               host(a.client_addr)      AS client_addr,
               a.backend_type,
               a.state,
               a.wait_event_type,
               a.wait_event,
               a.backend_start,
               a.xact_start,
               a.query_start,
               a.state_change,
               left(a.query, 600)       AS query,
               ${blocking}              AS blocked_by,
               age(a.backend_xmin)      AS backend_xmin_age
        FROM pg_stat_activity a
        WHERE a.pid <> pg_backend_pid()
        ORDER BY a.xact_start NULLS LAST
      `)
      return result.rows.map((row) => ({
        pid: toNumber(row.pid),
        user: toText(row.username),
        applicationName: toText(row.application_name),
        clientAddr: toText(row.client_addr),
        backendType: String(row.backend_type ?? 'client backend'),
        state: toText(row.state),
        waitEventType: toText(row.wait_event_type),
        waitEvent: toText(row.wait_event),
        backendStart: toIso(row.backend_start),
        xactStart: toIso(row.xact_start),
        queryStart: toIso(row.query_start),
        stateChange: toIso(row.state_change),
        query: toText(row.query),
        blockedBy: toPidArray(row.blocked_by),
        backendXminAge: toNullableNumber(row.backend_xmin_age),
      }))
    },
    [],
  )

  const locks = await attempt<LockSummaryEntry[]>(
    notes,
    'Locks',
    async () => {
      const result = await query(`
        SELECT locktype, mode, granted, count(*)::bigint AS count
        FROM pg_locks
        GROUP BY locktype, mode, granted
        ORDER BY granted, count DESC
      `)
      return result.rows.map((row) => ({
        lockType: String(row.locktype),
        mode: String(row.mode),
        granted: row.granted === true,
        count: toNumber(row.count),
      }))
    },
    [],
  )

  const slots = await attempt<ReplicationSlotEntry[]>(
    notes,
    'Replication slots',
    async () => {
      // wal_status and safe_wal_size arrived in 13; before that a slot could only
      // be measured by how far its restart_lsn had fallen behind.
      const walStatus = version >= 130_000 ? 's.wal_status' : 'NULL::text'
      const safeWal = version >= 130_000 ? 's.safe_wal_size' : 'NULL::bigint'
      // pg_current_wal_lsn() raises on a standby; the received position is the
      // right reference point there.
      const currentLsn = isInRecovery ? 'pg_last_wal_receive_lsn()' : 'pg_current_wal_lsn()'
      const result = await query(`
        SELECT s.slot_name, s.plugin, s.slot_type, s.active,
               pg_wal_lsn_diff(${currentLsn}, s.restart_lsn)::bigint AS retained_bytes,
               ${walStatus} AS wal_status,
               ${safeWal}   AS safe_wal_size
        FROM pg_replication_slots s
      `)
      return result.rows.map((row) => ({
        name: String(row.slot_name),
        plugin: toText(row.plugin),
        slotType: String(row.slot_type),
        active: row.active === true,
        retainedBytes: toNullableNumber(row.retained_bytes),
        walStatus: toText(row.wal_status),
        safeWalSize: toNullableNumber(row.safe_wal_size),
      }))
    },
    [],
  )

  const replicas = await attempt<ReplicaEntry[]>(
    notes,
    'Replicas',
    async () => {
      const result = await query(`
        SELECT application_name,
               host(client_addr) AS client_addr,
               state, sync_state,
               pg_wal_lsn_diff(sent_lsn, replay_lsn)::bigint AS replay_lag_bytes,
               write_lag::text, flush_lag::text, replay_lag::text
        FROM pg_stat_replication
      `)
      return result.rows.map((row) => ({
        applicationName: toText(row.application_name),
        clientAddr: toText(row.client_addr),
        state: toText(row.state),
        syncState: toText(row.sync_state),
        replayLagBytes: toNullableNumber(row.replay_lag_bytes),
        writeLag: toText(row.write_lag),
        flushLag: toText(row.flush_lag),
        replayLag: toText(row.replay_lag),
      }))
    },
    [],
  )

  const preparedTransactions = await attempt<PreparedTransactionEntry[]>(
    notes,
    'Prepared transactions',
    async () => {
      const result = await query(`
        SELECT gid, prepared, owner::text, database FROM pg_prepared_xacts ORDER BY prepared
      `)
      return result.rows.map((row) => ({
        gid: String(row.gid),
        prepared: toIso(row.prepared) ?? String(row.prepared),
        owner: toText(row.owner),
        database: toText(row.database),
      }))
    },
    [],
  )

  const progress = await attempt<ProgressEntry[]>(
    notes,
    'Progress',
    async () => {
      const entries: ProgressEntry[] = []
      const relation = `(SELECT n.nspname || '.' || c.relname FROM pg_class c
                          JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = p.relid)`

      if (version >= 90_600) {
        const vacuum = await query(`
          SELECT p.pid, ${relation} AS relation, p.phase,
                 p.heap_blks_scanned, p.heap_blks_total, p.heap_blks_vacuumed
          FROM pg_stat_progress_vacuum p
        `)
        for (const row of vacuum.rows) {
          entries.push({
            kind: 'vacuum',
            pid: toNumber(row.pid),
            relation: toText(row.relation),
            phase: toText(row.phase),
            fraction: fraction(row.heap_blks_scanned, row.heap_blks_total),
            detail: `${toNumber(row.heap_blks_vacuumed)} of ${toNumber(row.heap_blks_total)} pages vacuumed`,
          })
        }
      }
      if (version >= 120_000) {
        const createIndex = await query(`
          SELECT p.pid, ${relation} AS relation, p.phase, p.blocks_done, p.blocks_total,
                 p.tuples_done, p.tuples_total
          FROM pg_stat_progress_create_index p
        `)
        for (const row of createIndex.rows) {
          entries.push({
            kind: 'create index',
            pid: toNumber(row.pid),
            relation: toText(row.relation),
            phase: toText(row.phase),
            fraction:
              fraction(row.blocks_done, row.blocks_total) ??
              fraction(row.tuples_done, row.tuples_total),
            detail: null,
          })
        }
      }
      if (version >= 130_000) {
        const analyze = await query(`
          SELECT p.pid, ${relation} AS relation, p.phase,
                 p.sample_blks_scanned, p.sample_blks_total
          FROM pg_stat_progress_analyze p
        `)
        for (const row of analyze.rows) {
          entries.push({
            kind: 'analyze',
            pid: toNumber(row.pid),
            relation: toText(row.relation),
            phase: toText(row.phase),
            fraction: fraction(row.sample_blks_scanned, row.sample_blks_total),
            detail: null,
          })
        }
      }
      if (version >= 140_000) {
        const copy = await query(`
          SELECT p.pid, ${relation} AS relation, p.command AS phase,
                 p.bytes_processed, p.bytes_total, p.tuples_processed
          FROM pg_stat_progress_copy p
        `)
        for (const row of copy.rows) {
          entries.push({
            kind: 'copy',
            pid: toNumber(row.pid),
            relation: toText(row.relation),
            phase: toText(row.phase),
            fraction: fraction(row.bytes_processed, row.bytes_total),
            detail: `${toNumber(row.tuples_processed)} rows`,
          })
        }
      }
      return entries
    },
    [],
  )

  const counters = await attempt<DatabaseCounters | null>(
    notes,
    'Database counters',
    async () => {
      const result = await query(`
        SELECT datname, xact_commit, xact_rollback, blks_read, blks_hit,
               deadlocks, temp_files, temp_bytes, stats_reset
        FROM pg_stat_database
        WHERE datname = current_database()
      `)
      const row = result.rows[0]
      if (!row) return null
      return {
        database: String(row.datname),
        commits: toNumber(row.xact_commit),
        rollbacks: toNumber(row.xact_rollback),
        blocksRead: toNumber(row.blks_read),
        blocksHit: toNumber(row.blks_hit),
        deadlocks: toNumber(row.deadlocks),
        tempFiles: toNumber(row.temp_files),
        tempBytes: toNumber(row.temp_bytes),
        statsReset: toIso(row.stats_reset),
      }
    },
    null,
  )

  return {
    takenAt,
    serverVersionNum: version,
    isInRecovery,
    backends,
    locks,
    slots,
    replicas,
    preparedTransactions,
    progress,
    counters,
    maxConnections: toNullableNumber(identity.rows[0]?.max_connections),
    notes,
  }
}
