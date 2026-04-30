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
 * Append one query log entry to perf-log.jsonl. Fire-and-forget for
 * the caller — errors writing the log must never block or fail a query.
 */
export async function appendPerfEntry(entry: PerfLogEntry): Promise<void> {
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
