/**
 * "Which tables changed recently", as honestly as Postgres can answer it.
 *
 * There is no per-table write clock: `pg_stat_all_tables` counts writes but does
 * not timestamp them, and the only timestamps it keeps belong to vacuum and
 * analyze — maintenance, which lags a write by minutes to hours and also fires
 * on tables nobody wrote to. So two different facts are reported side by side
 * rather than blended into one invented "last changed":
 *
 *   modsSinceAnalyze  rows inserted, updated or deleted since the last ANALYZE.
 *                     Nonzero means the table HAS changed since then — a real
 *                     claim, with no clock attached.
 *   lastAnalyzed      when that reference point was. The change happened after
 *                     it, which is as close to a time as this data gets.
 *
 * Ranking is by `modsSinceAnalyze`: on a server where autoanalyze runs, the
 * tables carrying the most unanalyzed change are the ones being written now.
 */

export interface TableActivityEntry {
  table: string
  /** Rows changed since the last ANALYZE — the "has changed" signal. */
  modsSinceAnalyze: number
  /** Insert + update + delete counters, cumulative since the stats reset. */
  writes: number
  /** Latest of `last_analyze` / `last_autoanalyze`, ISO. */
  lastAnalyzed: string | null
  /** Latest of `last_vacuum` / `last_autovacuum`, ISO. */
  lastVacuumed: string | null
}

export interface TableActivity {
  /** When the cumulative counters were last zeroed — `writes` means nothing
   *  without it. */
  statsReset: string | null
  tables: TableActivityEntry[]
}

/**
 * Tables with unanalyzed change, most first.
 *
 * A table with no mods is dropped rather than ranked last: "nothing since the
 * last ANALYZE" is not a small change, it is the absence of evidence of one,
 * and a list of those is a list of nothing.
 */
export function rankByRecentChange(entries: TableActivityEntry[]): TableActivityEntry[] {
  return entries
    .filter((entry) => entry.modsSinceAnalyze > 0)
    .sort(
      (a, b) => b.modsSinceAnalyze - a.modsSinceAnalyze || a.table.localeCompare(b.table),
    )
}

/** Compact count for a sidebar slot: `8.5k`, `1.2M`. */
export function formatMods(mods: number): string {
  if (mods < 1000) return String(mods)
  if (mods < 1_000_000) return `${(mods / 1000).toFixed(mods < 10_000 ? 1 : 0)}k`
  return `${(mods / 1_000_000).toFixed(1)}M`
}

/**
 * How long ago, coarsely. Minutes below an hour, hours below a day, then days —
 * a maintenance timestamp is not precise enough to deserve seconds.
 */
export function formatAge(iso: string | null, now: number): string | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * What the sidebar row says under a table name. Never a bare time: the time is
 * the analyze, and the change came after it.
 */
export function describeChange(entry: TableActivityEntry, now: number): string {
  const rows = `${formatMods(entry.modsSinceAnalyze)} rows changed`
  const age = formatAge(entry.lastAnalyzed, now)
  return age ? `${rows} since ANALYZE ${age}` : `${rows} since the last ANALYZE`
}
