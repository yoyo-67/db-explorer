import type { TablePhysical } from '#/lib/physical/types'

/**
 * The two deadlines Postgres keeps per table.
 *
 * Freeze age is a countdown nobody starts and nobody can stop: every
 * transaction ages every unfrozen table by one, and at
 * `autovacuum_freeze_max_age` an anti-wraparound vacuum fires whether the
 * table wanted one or not — on a table large enough, that is the outage.
 *
 * Visibility-map coverage is the quieter one. An index-only scan may skip the
 * heap only for pages the map marks all-visible; on a table where that share is
 * low, an "index-only" plan reads the heap anyway and the planner's estimate was
 * a fiction.
 */

export type FreezeLevel = 'ok' | 'watch' | 'urgent' | 'unknown'

/** Anti-wraparound is close enough to plan around. */
export const FREEZE_WATCH_SHARE = 0.5
export const FREEZE_URGENT_SHARE = 0.85

export function freezeShare(age: number | null, maxAge: number): number | null {
  if (age === null || !Number.isFinite(age) || !Number.isFinite(maxAge) || maxAge <= 0) return null
  return age / maxAge
}

export function freezeLevel(age: number | null, maxAge: number): FreezeLevel {
  const share = freezeShare(age, maxAge)
  if (share === null) return 'unknown'
  if (share >= FREEZE_URGENT_SHARE) return 'urgent'
  if (share >= FREEZE_WATCH_SHARE) return 'watch'
  return 'ok'
}

/** The worse of the two clocks — a table freezes on whichever runs out first. */
export function worstFreezeLevel(physical: Pick<TablePhysical, 'frozenAge' | 'freezeMaxAge' | 'multixactAge' | 'multixactFreezeMaxAge'>): FreezeLevel {
  const rank: Record<FreezeLevel, number> = { urgent: 0, watch: 1, unknown: 2, ok: 3 }
  const xid = freezeLevel(physical.frozenAge, physical.freezeMaxAge)
  const mxid = freezeLevel(physical.multixactAge, physical.multixactFreezeMaxAge)
  return rank[xid] <= rank[mxid] ? xid : mxid
}

/** Transactions left before autovacuum fires the anti-wraparound pass. */
export function transactionsUntilFreeze(age: number | null, maxAge: number): number | null {
  if (age === null || !Number.isFinite(age)) return null
  return Math.max(0, maxAge - age)
}

export type VisibilityLevel = 'ok' | 'partial' | 'poor' | 'unknown'

export const VISIBILITY_OK_SHARE = 0.9
export const VISIBILITY_PARTIAL_SHARE = 0.5

/** Share of pages an index-only scan may skip the heap for. */
export function visibilityShare(physical: Pick<TablePhysical, 'relpages' | 'relallvisible'>): number | null {
  if (!Number.isFinite(physical.relpages) || physical.relpages <= 0) return null
  return Math.min(1, physical.relallvisible / physical.relpages)
}

export function visibilityLevel(physical: Pick<TablePhysical, 'relpages' | 'relallvisible'>): VisibilityLevel {
  const share = visibilityShare(physical)
  if (share === null) return 'unknown'
  if (share >= VISIBILITY_OK_SHARE) return 'ok'
  if (share >= VISIBILITY_PARTIAL_SHARE) return 'partial'
  return 'poor'
}

/** One sentence a reader can act on, per clock. */
export function freezeSentence(level: FreezeLevel): string {
  switch (level) {
    case 'urgent':
      return 'An anti-wraparound vacuum is close. It cannot be cancelled and it will read the whole table.'
    case 'watch':
      return 'Past half its freeze budget. Worth vacuuming on your schedule rather than on autovacuum’s.'
    case 'ok':
      return 'Comfortably inside its freeze budget.'
    default:
      return 'No freeze age recorded for this relation.'
  }
}

export function visibilitySentence(level: VisibilityLevel): string {
  switch (level) {
    case 'poor':
      return 'Most pages are not marked all-visible, so index-only scans fall through to the heap.'
    case 'partial':
      return 'Half the pages can be skipped; an index-only plan will still touch the heap for the rest.'
    case 'ok':
      return 'Index-only scans can skip the heap for nearly every page.'
    default:
      return 'No pages recorded yet — the table has never been vacuumed or analyzed.'
  }
}
