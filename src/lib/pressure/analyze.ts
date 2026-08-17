import type { TableVacuumEntry } from '#/lib/types'
import { lastAnalyzedAt } from '#/lib/pressure/vacuum'

/**
 * Where the planner is working blind.
 *
 * A table that has never been analyzed has no statistics at all, so every plan
 * over it is a guess — usually the guess that it holds 1000-odd rows, which is
 * how a join over millions ends up as a nested loop. A table analyzed once and
 * then changed heavily is the softer version of the same problem.
 *
 * Both are read off statistics the pressure page already fetches; nothing here
 * costs another query.
 */

export type AnalyzeState =
  /** No `ANALYZE` has ever run: the planner has nothing but its defaults. */
  | 'never'
  /** More rows have changed since the last analyze than autoanalyze waits for. */
  | 'stale'
  | 'fresh'
  /** Autovacuum is off for the table, so there is no trigger to judge it by. */
  | 'unmanaged'

export function analyzeState(entry: TableVacuumEntry): AnalyzeState {
  const analyzed = lastAnalyzedAt(entry)
  if (analyzed === null) return 'never'
  if (entry.analyzeThreshold === null) return 'unmanaged'
  return entry.modsSinceAnalyze > entry.analyzeThreshold ? 'stale' : 'fresh'
}

/** Tables the planner cannot see properly, never-analyzed first, then by how
 *  many changes are sitting unanalyzed, then by size. */
export function byAnalyzePressure(a: TableVacuumEntry, b: TableVacuumEntry): number {
  const rank: Record<AnalyzeState, number> = { never: 0, stale: 1, unmanaged: 2, fresh: 3 }
  const byState = rank[analyzeState(a)] - rank[analyzeState(b)]
  if (byState !== 0) return byState
  const byMods = b.modsSinceAnalyze - a.modsSinceAnalyze
  return byMods !== 0 ? byMods : b.estimatedRows - a.estimatedRows
}

/** Only the tables worth acting on — a fresh table is not a finding. */
export function analyzeFindings(entries: TableVacuumEntry[]): TableVacuumEntry[] {
  return entries.filter((entry) => analyzeState(entry) !== 'fresh').sort(byAnalyzePressure)
}

/**
 * Whether a never-analyzed table is actually a problem yet. An empty table with
 * no statistics plans fine; a large one does not. `estimatedRows` is itself
 * unreliable here (that is the point), so this leans on whichever count exists.
 */
export function isBlindAndLarge(entry: TableVacuumEntry, rowThreshold = 10_000): boolean {
  if (analyzeState(entry) !== 'never') return false
  const rows = Math.max(entry.liveTuples, entry.estimatedRows > 0 ? entry.estimatedRows : 0)
  return rows >= rowThreshold
}

/** The statement that fixes it. */
export function analyzeSql(schema: string, table: string): string {
  return `ANALYZE ${schema}.${table};`
}
