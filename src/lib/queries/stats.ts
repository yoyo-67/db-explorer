import type { QueryStatEntry } from '#/lib/types'

/** Presentation and ranking for the query board. */

/** One decimal below ten, none above, and never a bare `.0`. */
function scaled(value: number): string {
  const text = value < 10 ? value.toFixed(1) : String(Math.round(value))
  return text.replace(/\.0$/, '')
}

/** Durations spanning microseconds to hours, each in the unit a reader expects. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1) return `${ms.toFixed(2)} ms`
  if (ms < 1_000) return `${scaled(ms)} ms`
  const seconds = ms / 1_000
  if (seconds < 60) return `${scaled(seconds)} s`
  const minutes = seconds / 60
  if (minutes < 60) return `${scaled(minutes)} min`
  return `${scaled(minutes / 60)} h`
}

export function shareOfTime(entryMs: number, totalMs: number): number {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0
  return Math.min(1, Math.max(0, entryMs / totalMs))
}

/**
 * Blocks answered from shared buffers. A low ratio on a heavy statement is the
 * one that goes to disk; `null` when the statement touched no blocks at all,
 * which is not the same as missing every time.
 */
export function cacheHitRatio(entry: Pick<QueryStatEntry, 'sharedBlksHit' | 'sharedBlksRead'>): number | null {
  const total = entry.sharedBlksHit + entry.sharedBlksRead
  if (!Number.isFinite(total) || total <= 0) return null
  return entry.sharedBlksHit / total
}

export function rowsPerCall(entry: Pick<QueryStatEntry, 'rows' | 'calls'>): number | null {
  if (!Number.isFinite(entry.calls) || entry.calls <= 0) return null
  return entry.rows / entry.calls
}

/** Leading comments — `/* … *​/` and `-- …` — hide the verb, so strip them first. */
export function stripLeadingComments(sql: string): string {
  let rest = sql.trimStart()
  for (;;) {
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/')
      if (end === -1) return ''
      rest = rest.slice(end + 2).trimStart()
      continue
    }
    if (rest.startsWith('--')) {
      const end = rest.indexOf('\n')
      if (end === -1) return ''
      rest = rest.slice(end + 1).trimStart()
      continue
    }
    return rest
  }
}

export type QueryKind = 'select' | 'insert' | 'update' | 'delete' | 'ddl' | 'utility' | 'other'

const DDL = new Set(['create', 'alter', 'drop', 'truncate', 'comment'])
const UTILITY = new Set([
  'begin', 'commit', 'rollback', 'set', 'show', 'explain', 'analyze', 'vacuum',
  'copy', 'declare', 'fetch', 'close', 'discard', 'reset', 'prepare', 'deallocate',
  'lock', 'listen', 'notify', 'refresh', 'reindex', 'cluster', 'grant', 'revoke',
])

/** What kind of statement this is, from its first real word. */
export function queryKind(sql: string): QueryKind {
  const word = stripLeadingComments(sql).split(/[\s(;]+/)[0]?.toLowerCase() ?? ''
  if (word === 'select' || word === 'with' || word === 'table' || word === 'values') return 'select'
  if (word === 'insert') return 'insert'
  if (word === 'update') return 'update'
  if (word === 'delete') return 'delete'
  if (DDL.has(word)) return 'ddl'
  if (UTILITY.has(word)) return 'utility'
  return 'other'
}

/** Newlines and runs of spaces collapsed, for a one-line preview. */
export function collapseWhitespace(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

export type QuerySortKey = 'total' | 'mean' | 'calls' | 'rows' | 'io'

export const QUERY_SORTS: Record<QuerySortKey, { label: string; hint: string }> = {
  total: { label: 'Total time', hint: 'Where the database actually spends its life' },
  mean: { label: 'Mean time', hint: 'The slow ones, however rarely they run' },
  calls: { label: 'Calls', hint: 'The chatty ones — often cheap individually' },
  rows: { label: 'Rows', hint: 'What moves the most data' },
  io: { label: 'I/O wait', hint: 'Time spent waiting on disk rather than working' },
}

export function isQuerySortKey(value: unknown): value is QuerySortKey {
  return typeof value === 'string' && value in QUERY_SORTS
}

/** Sorts descending, since every column here is "more is more interesting".
 *  Entries with no I/O timing sort last rather than as zero. */
export function sortEntries(entries: QueryStatEntry[], key: QuerySortKey): QueryStatEntry[] {
  const value = (entry: QueryStatEntry): number => {
    switch (key) {
      case 'total':
        return entry.totalMs
      case 'mean':
        return entry.meanMs
      case 'calls':
        return entry.calls
      case 'rows':
        return entry.rows
      case 'io':
        return (entry.ioReadMs ?? -1) + (entry.ioWriteMs ?? 0)
    }
  }
  return [...entries].sort((a, b) => value(b) - value(a) || a.queryId.localeCompare(b.queryId))
}
