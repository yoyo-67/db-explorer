import type pg from 'pg'
import { sanitizeRows } from '#/server/json-row'
import { appendPerfEntry } from '#/server/perf-log'
import { getPresetName } from '#/server/db'
import type { ColumnInfo, ConsoleResult, QueryFailure } from '#/lib/types'

/**
 * The console's execution path, and the one exception to this app's read-only
 * stance.
 *
 * Read-only is defended in three layers and this module keeps all three:
 * every physical connection is created under `SET SESSION CHARACTERISTICS AS
 * TRANSACTION READ ONLY` (`#/server/db`); each console statement runs inside an
 * explicit `BEGIN READ ONLY`, which Postgres will not let a statement escape
 * mid-transaction; and the SQL travels through the extended query protocol,
 * which rejects multi-statement input, so one statement cannot smuggle a
 * second.
 *
 * Write mode is a fourth, deliberate layer rather than a hole in the first
 * three. It is off unless the browser holding the preference has told the
 * server otherwise — a page cannot enforce anything, so the server is where
 * the flag has to live — and even then a write does not become durable on its
 * own: the transaction stays open and someone has to say COMMIT. An explorer
 * whose whole design is about looking before touching should not have its one
 * write surface be a button that means "already happened".
 */

/** More than this and the browser is being asked to render a data dump. */
const ROW_CAP = 500

/** An open write transaction holds a pool client and can hold locks. A tab left
 *  on the console overnight must not be why a migration blocks in the morning. */
const IDLE_ROLLBACK_MS = 5 * 60_000

export interface ConsoleRunInput {
  sql: string
  /** `$n` values, passed as values — never interpolated into the text. */
  params?: string[]
  /** Ask for the write path. Refused unless {@link setWriteModeAllowed}. */
  write?: boolean
}

interface OpenTransaction {
  client: pg.PoolClient
  startedAt: number
  statements: number
  timer: ReturnType<typeof setTimeout>
}

let open: OpenTransaction | null = null
let writeAllowed = false

/**
 * Whether the console may write, as told to the server by the browser that
 * holds the setting — the same mirroring that carries `statement_timeout`.
 *
 * Turning it off abandons any transaction still open. Someone who has just
 * decided this connection should be read-only did not mean "read-only after I
 * finish the writes I have pending".
 */
export function setWriteModeAllowed(allowed: boolean): void {
  writeAllowed = allowed
  if (!allowed && open) void rollbackConsoleTransaction()
}

/** What the run bar needs to draw the open-transaction state, or null. */
export function consoleTransaction(): { startedAt: number; statements: number } | null {
  return open ? { startedAt: open.startedAt, statements: open.statements } : null
}

function armIdleRollback(): void {
  if (!open) return
  clearTimeout(open.timer)
  open.timer = setTimeout(() => {
    void rollbackConsoleTransaction()
  }, IDLE_ROLLBACK_MS)
  // A pending rollback is not a reason to hold the process open.
  open.timer.unref?.()
}

async function endTransaction(how: 'COMMIT' | 'ROLLBACK'): Promise<{ ok: boolean; error?: string }> {
  const current = open
  if (!current) return { ok: false, error: 'No open transaction' }
  open = null
  clearTimeout(current.timer)
  try {
    await current.client.query(how)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    current.client.release()
  }
}

export function commitConsoleTransaction(): Promise<{ ok: boolean; error?: string }> {
  return endTransaction('COMMIT')
}

export function rollbackConsoleTransaction(): Promise<{ ok: boolean; error?: string }> {
  return endTransaction('ROLLBACK')
}

/**
 * A `pg` error's structured fields, which the old console threw away.
 *
 * `position` is the one that matters: a 1-based character offset into the
 * statement, which the editor turns into an underline under the exact token.
 * `hint` is usually the actual answer — "Perhaps you meant to reference the
 * column o.customer_id" — and nobody has ever seen one in this app.
 */
function describeFailure(err: unknown): QueryFailure {
  const e = err as { message?: string; position?: string; hint?: string; detail?: string; code?: string }
  const position = e?.position == null ? undefined : Number(e.position)
  return {
    message: err instanceof Error ? err.message : String(err),
    position: position !== undefined && Number.isFinite(position) ? position : undefined,
    hint: e?.hint || undefined,
    detail: e?.detail || undefined,
    code: e?.code || undefined,
  }
}

function toResult(result: pg.QueryResult, startedAt: number, transactionOpen: boolean): ConsoleResult {
  const fields = (result.fields ?? []) as Array<{ name: string }>
  const columns: ColumnInfo[] = fields.map((f) => ({
    name: f.name,
    dataType: '',
    isNullable: true,
  }))
  const all = sanitizeRows((result.rows ?? []) as Record<string, unknown>[])
  // A statement that changes rows returns none, and `rowCount` is then how many
  // it touched — the only number worth showing for an UPDATE.
  const affected = all.length === 0 ? (result.rowCount ?? 0) : all.length
  return {
    ok: true,
    columns,
    rows: all.slice(0, ROW_CAP),
    rowCount: affected,
    truncated: all.length > ROW_CAP,
    command: result.command || undefined,
    durationMs: Date.now() - startedAt,
    ...(transactionOpen ? { transaction: 'open' as const } : {}),
  }
}

/**
 * Run one statement.
 *
 * Three paths, and which one is taken is decided before a client is taken from
 * the pool:
 *
 * - A transaction is already open: the statement joins it, whatever it is.
 *   A read has to go through the open transaction rather than around it, or it
 *   would be answered by a second client that cannot see the uncommitted
 *   change — which is the whole reason the transaction is still open.
 * - Write asked for, and allowed: `BEGIN READ WRITE`, and the transaction is
 *   left open for someone to commit or abandon.
 * - Everything else: `BEGIN READ ONLY` on its own client, then `ROLLBACK`.
 */
export async function runConsoleQuery(input: ConsoleRunInput): Promise<ConsoleResult> {
  const sql = input.sql.trim()
  if (!sql) return { ok: false, error: 'Empty query' }
  if (input.write && !writeAllowed && !open) {
    return {
      ok: false,
      error: 'Write mode is off. Turn it on in Settings to run statements that change data.',
    }
  }

  const params = input.params ?? []
  const startedAt = Date.now()

  if (open) return runInOpen(open, sql, params, startedAt)

  const { getConnection } = await import('#/server/db')
  const pool = await getConnection()
  if (!pool) return { ok: false, error: 'Not connected to database' }
  const client = await pool.connect()

  if (input.write) {
    try {
      await client.query('BEGIN READ WRITE')
      await client.query(
        `SET LOCAL idle_in_transaction_session_timeout = ${IDLE_ROLLBACK_MS}`,
      )
    } catch (err) {
      client.release()
      return { ok: false, error: describeFailure(err).message, failure: describeFailure(err) }
    }
    open = {
      client,
      startedAt,
      statements: 0,
      timer: setTimeout(() => {}, 0),
    }
    armIdleRollback()
    return runInOpen(open, sql, params, startedAt)
  }

  try {
    await client.query('BEGIN READ ONLY')
    const result = await execute(client, sql, params, startedAt)
    await client.query('ROLLBACK')
    return toResult(result, startedAt, false)
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* already gone */
    }
    const failure = describeFailure(err)
    return { ok: false, error: failure.message, failure }
  } finally {
    client.release()
  }
}

/**
 * A statement inside the transaction that is already open.
 *
 * A failure here does not end it. Postgres has aborted the transaction and
 * every later statement will refuse until it is rolled back, but throwing away
 * the statements that already succeeded is the caller's decision to make — so
 * the client stays held and the run bar keeps its Commit and Rollback buttons.
 */
async function runInOpen(
  transaction: OpenTransaction,
  sql: string,
  params: string[],
  startedAt: number,
): Promise<ConsoleResult> {
  try {
    const result = await execute(transaction.client, sql, params, startedAt)
    transaction.statements++
    armIdleRollback()
    return toResult(result, startedAt, true)
  } catch (err) {
    transaction.statements++
    armIdleRollback()
    const failure = describeFailure(err)
    return { ok: false, error: failure.message, failure, transaction: 'open' }
  }
}

/** The statement itself, and its line in the perf log either way. */
async function execute(
  client: pg.PoolClient,
  sql: string,
  params: string[],
  startedAt: number,
): Promise<pg.QueryResult> {
  try {
    const result = await client.query({ text: sql, values: params })
    void appendPerfEntry({
      ts: startedAt,
      preset: getPresetName() ?? 'console',
      sql: `[console] ${sql}`,
      ms: Date.now() - startedAt,
      ok: true,
      rowCount: result.rowCount ?? undefined,
    })
    return result
  } catch (err) {
    void appendPerfEntry({
      ts: startedAt,
      preset: getPresetName() ?? 'console',
      sql: `[console] ${sql}`,
      ms: Date.now() - startedAt,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
