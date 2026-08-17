import { query } from '#/server/db'
import type { QueryStatEntry, QueryStats } from '#/lib/types'

/**
 * The `pg_stat_statements` board.
 *
 * The extension is not installed everywhere and a read-only session cannot
 * install it, so its absence is a reported state rather than an empty table. The
 * view's column names moved twice — `total_time` became `total_exec_time` in 13,
 * `blk_read_time` became `shared_blk_read_time` in 17 — so the query is built
 * against the server's own version instead of assuming one.
 */

/** Statements returned to the client. The view can hold thousands; the board
 *  ranks server-side and ships the head of the list. */
export const QUERY_BOARD_LIMIT = 100

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function serverVersionNum(): Promise<number> {
  const result = await query('SHOW server_version_num')
  const parsed = Number(result.rows[0]?.server_version_num)
  return Number.isFinite(parsed) ? parsed : 0
}

/** A setting the server may not have, read without making that an error. */
async function optionalSetting(name: string): Promise<string | null> {
  try {
    const result = await query('SELECT current_setting($1, true) AS value', [name])
    return (result.rows[0]?.value as string | null) ?? null
  } catch {
    return null
  }
}

function unavailable(
  reason: QueryStats['unavailableReason'],
  error: string | null,
): QueryStats {
  return {
    available: false,
    unavailableReason: reason,
    error,
    statsReset: null,
    ioTiming: false,
    track: null,
    totalMs: 0,
    statementCount: 0,
    entries: [],
  }
}

export async function getQueryStats(): Promise<QueryStats> {
  const installed = await query(
    `SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'pg_stat_statements'`,
  )
  if (toNumber(installed.rows[0]?.n) === 0) {
    return unavailable(
      'not-installed',
      'pg_stat_statements is not installed in this database. It has to be added to shared_preload_libraries and created with CREATE EXTENSION — neither of which a read-only session can do.',
    )
  }

  const version = await serverVersionNum()
  // 13 split planning time out of the totals and renamed the execution columns.
  const exec = version >= 130_000
    ? {
        total: 'total_exec_time',
        mean: 'mean_exec_time',
        min: 'min_exec_time',
        max: 'max_exec_time',
        stddev: 'stddev_exec_time',
      }
    : {
        total: 'total_time',
        mean: 'mean_time',
        min: 'min_time',
        max: 'max_time',
        stddev: 'stddev_time',
      }
  // 17 renamed the block I/O timing columns to say which blocks they mean.
  const io = version >= 170_000
    ? { read: 'shared_blk_read_time', write: 'shared_blk_write_time' }
    : { read: 'blk_read_time', write: 'blk_write_time' }

  const [ioTiming, track] = await Promise.all([
    optionalSetting('track_io_timing'),
    optionalSetting('pg_stat_statements.track'),
  ])

  // `pg_stat_statements_info` arrived in 14; before that nothing records when the
  // counters were last zeroed, and the board says so rather than guessing.
  let statsReset: string | null = null
  if (version >= 140_000) {
    try {
      const result = await query('SELECT stats_reset FROM pg_stat_statements_info')
      const value = result.rows[0]?.stats_reset
      statsReset = value ? new Date(value as string).toISOString() : null
    } catch {
      statsReset = null
    }
  }

  const currentDatabase = `(SELECT oid FROM pg_database WHERE datname = current_database())`

  try {
    const [summaryResult, entriesResult] = await Promise.all([
      query(
        `
        SELECT
          COALESCE(sum(s.${exec.total}), 0) AS total_ms,
          count(*)::int                     AS statement_count
        FROM pg_stat_statements s
        WHERE s.dbid = ${currentDatabase}
      `,
      ),
      query(
        `
        SELECT
          s.queryid::text   AS query_id,
          s.query           AS query,
          s.calls           AS calls,
          s.${exec.total}   AS total_ms,
          s.${exec.mean}    AS mean_ms,
          s.${exec.min}     AS min_ms,
          s.${exec.max}     AS max_ms,
          s.${exec.stddev}  AS stddev_ms,
          s.rows            AS rows,
          s.shared_blks_hit  AS shared_blks_hit,
          s.shared_blks_read AS shared_blks_read,
          s.${io.read}      AS io_read_ms,
          s.${io.write}     AS io_write_ms,
          r.rolname         AS role
        FROM pg_stat_statements s
        LEFT JOIN pg_roles r ON r.oid = s.userid
        WHERE s.dbid = ${currentDatabase}
        ORDER BY s.${exec.total} DESC
        LIMIT ${QUERY_BOARD_LIMIT}
      `,
      ),
    ])

    // I/O columns read as zero when the server never measured them; without
    // `track_io_timing` that zero means "not recorded", not "no wait".
    const measuresIo = ioTiming === 'on'

    const entries: QueryStatEntry[] = entriesResult.rows.map((row) => ({
      queryId: String(row.query_id),
      query: String(row.query ?? ''),
      calls: toNumber(row.calls),
      totalMs: toNumber(row.total_ms),
      meanMs: toNumber(row.mean_ms),
      minMs: toNumber(row.min_ms),
      maxMs: toNumber(row.max_ms),
      stddevMs: toNumber(row.stddev_ms),
      rows: toNumber(row.rows),
      sharedBlksHit: toNumber(row.shared_blks_hit),
      sharedBlksRead: toNumber(row.shared_blks_read),
      ioReadMs: measuresIo ? toNumber(row.io_read_ms) : null,
      ioWriteMs: measuresIo ? toNumber(row.io_write_ms) : null,
      role: (row.role as string | null) ?? null,
    }))

    return {
      available: true,
      unavailableReason: null,
      error: null,
      statsReset,
      ioTiming: measuresIo,
      track,
      totalMs: toNumber(summaryResult.rows[0]?.total_ms),
      statementCount: toNumber(summaryResult.rows[0]?.statement_count),
      entries,
    }
  } catch (err) {
    // The extension exists but this role may not be allowed to read other
    // people's statements — a different problem from it being absent.
    return unavailable('not-readable', err instanceof Error ? err.message : String(err))
  }
}
