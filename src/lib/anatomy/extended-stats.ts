import { quoteIdent } from '#/lib/inspect/ddl'
import type { ExtendedStatsEntry, StatsCandidate } from '#/lib/anatomy/types'

/**
 * Where the planner is multiplying probabilities it should not.
 *
 * Postgres estimates a two-column filter by multiplying the selectivity of each
 * column, as if they were independent. For `(city, postcode)` they are not, and
 * the estimate comes out orders of magnitude low — which is how a nested loop
 * gets chosen for a million rows. `CREATE STATISTICS` fixes it, and nothing
 * creates one automatically.
 *
 * Which column pairs are actually correlated cannot be known without reading the
 * data. What can be known from the catalog is which sets somebody has already
 * declared belong together — a multicolumn index, a composite key — and whether
 * extended statistics exist for them. Absence is the finding.
 */

function key(table: string, columns: string[]): string {
  return `${table}::${[...columns].sort().join(',')}`
}

/** Extended statistics whose column set covers this candidate exactly. */
function covered(candidate: StatsCandidate, stats: ExtendedStatsEntry[]): boolean {
  const wanted = key(candidate.table, candidate.columns)
  return stats.some((entry) => key(entry.table, entry.columns) === wanted)
}

/**
 * Candidates with no matching statistics object, deduplicated: a composite
 * primary key usually has an index of the same columns, and reporting both
 * would be reporting the same gap twice.
 */
export function statsGaps(
  candidates: StatsCandidate[],
  stats: ExtendedStatsEntry[],
): StatsCandidate[] {
  const seen = new Set<string>()
  const gaps: StatsCandidate[] = []
  const ranked = [...candidates].sort(
    (a, b) => reasonRank(a.reason) - reasonRank(b.reason) || b.columns.length - a.columns.length,
  )
  for (const candidate of ranked) {
    if (candidate.columns.length < 2) continue
    const id = key(candidate.table, candidate.columns)
    if (seen.has(id)) continue
    seen.add(id)
    if (!covered(candidate, stats)) gaps.push(candidate)
  }
  return gaps
}

function reasonRank(reason: StatsCandidate['reason']): number {
  return { 'multicolumn-index': 0, 'composite-foreign-key': 1, 'primary-key': 2 }[reason]
}

export const REASON_TEXT: Record<StatsCandidate['reason'], string> = {
  'multicolumn-index':
    'a multicolumn index says these are filtered together, and the planner still estimates them as independent',
  'composite-foreign-key':
    'a composite foreign key means these columns travel as one value, so their combinations are far from every combination',
  'primary-key': 'a composite key: the pair is unique, which no per-column statistic can express',
}

/** The statement that closes the gap. */
export function createStatisticsDdl(schema: string, candidate: StatsCandidate): string {
  const columns = candidate.columns.map(quoteIdent).join(', ')
  const name = `${candidate.table}_${candidate.columns.join('_')}_stx`.slice(0, 63)
  return (
    `CREATE STATISTICS ${quoteIdent(schema)}.${quoteIdent(name)} (ndistinct, dependencies) ` +
    `ON ${columns} FROM ${quoteIdent(schema)}.${quoteIdent(candidate.table)};`
  )
}
