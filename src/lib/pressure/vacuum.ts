import type { TableVacuumEntry } from '#/lib/types'

/**
 * Vacuum debt. Dead tuples are the rows updates and deletes left behind: they
 * cost disk, they cost every scan that walks past them, and only vacuum returns
 * the space. The question this answers is not "are there dead rows" — there
 * always are — but "is autovacuum keeping up on this table".
 */

/** Dead as a share of all tuples; `null` when the table holds nothing. */
export function deadRatio(entry: Pick<TableVacuumEntry, 'liveTuples' | 'deadTuples'>): number | null {
  const total = entry.liveTuples + entry.deadTuples
  if (!Number.isFinite(total) || total <= 0) return null
  return entry.deadTuples / total
}

/** What autovacuum will wait for: `threshold + scale_factor × rows`. */
export function autovacuumTrigger(
  estimatedRows: number,
  threshold: number,
  scaleFactor: number,
): number {
  const rows = Number.isFinite(estimatedRows) && estimatedRows > 0 ? estimatedRows : 0
  return threshold + scaleFactor * rows
}

export const DEAD_RATIO_WATCH = 0.1

export type VacuumLevel = 'ok' | 'watch' | 'overdue' | 'unknown'

/**
 * `overdue` means the table is already past its own autovacuum trigger and
 * still holds the dead rows — autovacuum is either disabled, starved, or
 * blocked. `watch` is a tenth of the table being dead without having crossed
 * the trigger yet.
 */
export function vacuumLevel(entry: TableVacuumEntry): VacuumLevel {
  const ratio = deadRatio(entry)
  if (entry.vacuumThreshold !== null && entry.deadTuples > entry.vacuumThreshold) return 'overdue'
  if (ratio === null) return 'unknown'
  if (ratio >= DEAD_RATIO_WATCH) return 'watch'
  return 'ok'
}

/** The most recent vacuum of either kind — manual and automatic both count. */
export function lastVacuumedAt(entry: TableVacuumEntry): string | null {
  const candidates = [entry.lastVacuum, entry.lastAutovacuum].filter(
    (value): value is string => typeof value === 'string',
  )
  if (candidates.length === 0) return null
  return candidates.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest))
}

export function lastAnalyzedAt(entry: TableVacuumEntry): string | null {
  const candidates = [entry.lastAnalyze, entry.lastAutoanalyze].filter(
    (value): value is string => typeof value === 'string',
  )
  if (candidates.length === 0) return null
  return candidates.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest))
}

/** Worst first: overdue before watch, then by how many dead tuples are held. */
export function byVacuumPressure(a: TableVacuumEntry, b: TableVacuumEntry): number {
  const rank: Record<VacuumLevel, number> = { overdue: 0, watch: 1, unknown: 2, ok: 3 }
  const byLevel = rank[vacuumLevel(a)] - rank[vacuumLevel(b)]
  return byLevel !== 0 ? byLevel : b.deadTuples - a.deadTuples
}
