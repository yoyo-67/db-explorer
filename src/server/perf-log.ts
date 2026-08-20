import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface PerfLogEntry {
  ts: number
  preset: string
  sql: string
  ms: number
  ok: boolean
  error?: string
  rowCount?: number
}

const LOG_FILENAME = 'perf-log.jsonl'
const SQL_TRUNCATE = 2000

function logPath(): string {
  return resolve(process.cwd(), LOG_FILENAME)
}

function truncate(sql: string): string {
  if (sql.length <= SQL_TRUNCATE) return sql
  return sql.slice(0, SQL_TRUNCATE) + `... [+${sql.length - SQL_TRUNCATE} chars]`
}

/**
 * Whether queries are being written down at all.
 *
 * The log exists to feed the ⚡ HUD, and the HUD is off by default — so with no
 * gate every query in every session pays an append, and `perf-log.jsonl` grows
 * for a reader nobody turned on. The switch lives in the server process rather
 * than in a file because the setting it follows is a browser preference
 * (`db-explorer.settings`); the client mirrors its value over on load and on
 * every change.
 *
 * Off until a client says otherwise, a server restart included. Nothing but the
 * HUD reads the log, so the queries that ran before the first mirror are not
 * worth keeping.
 */
let logging = false

/** Follow the browser's HUD preference. Called by `$setPerfLogging`. */
export function setPerfLogging(enabled: boolean): void {
  logging = enabled
}

export function isPerfLogging(): boolean {
  return logging
}

/**
 * Append one query log entry to perf-log.jsonl, if logging is on. Fire-and-forget
 * for the caller — errors writing the log must never block or fail a query.
 *
 * The gate is here rather than at the call sites: `query()` logs from four
 * places and two more modules, and a check each of them has to remember is a
 * check one of them will not.
 */
export async function appendPerfEntry(entry: PerfLogEntry): Promise<void> {
  if (!logging) return
  try {
    const line = JSON.stringify({ ...entry, sql: truncate(entry.sql) }) + '\n'
    await appendFile(logPath(), line, 'utf-8')
  } catch {
    /* best effort */
  }
}

/** Read the log file and return up to {@link limit} most-recent entries. */
export async function readPerfLog(limit: number = 200): Promise<PerfLogEntry[]> {
  let raw: string
  try {
    raw = await readFile(logPath(), 'utf-8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter((l) => l.length > 0)
  const tail = lines.slice(-limit)
  const out: PerfLogEntry[] = []
  for (const line of tail) {
    try {
      out.push(JSON.parse(line) as PerfLogEntry)
    } catch {
      /* skip malformed line */
    }
  }
  return out
}
