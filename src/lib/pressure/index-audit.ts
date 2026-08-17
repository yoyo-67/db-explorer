import type { ForeignKeyColumns, IndexEntry } from '#/lib/types'

/**
 * Findings derived from the index catalog. Deliberately conservative: every rule
 * here has to survive "would I actually run this DROP?", so anything that also
 * enforces a constraint, covers only part of a table, or indexes an expression
 * is reported as *kept* rather than as waste.
 */

/** `a` is a leading prefix of `b` — same columns, same order, from the front. */
export function isLeadingPrefix(a: string[], b: string[]): boolean {
  if (a.length === 0 || a.length > b.length) return false
  return a.every((column, i) => column === b[i])
}

/** An index nothing has read since the counters were reset. Primary keys are
 *  excluded: they exist to enforce, not to be scanned. */
export function unusedIndexes(indexes: IndexEntry[]): IndexEntry[] {
  return indexes
    .filter((index) => index.scans === 0 && !index.isPrimary)
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
}

/** Whether dropping this index would take a constraint with it — the difference
 *  between "unused" and "droppable". */
export function enforcesConstraint(index: IndexEntry): boolean {
  return index.constraintBacked || index.isUnique || index.isPrimary
}

export interface RedundantIndex {
  index: IndexEntry
  /** The longer index whose leading columns already answer everything this one does. */
  coveredBy: IndexEntry
}

/**
 * An index whose key columns are a leading prefix of another index on the same
 * table: any lookup it serves, the longer one serves too.
 *
 * Excluded from being *called* redundant: unique and constraint-backed indexes
 * (they enforce something), partial indexes (they cover different rows), and
 * expression indexes (matching them by column name would be a guess). Duplicates
 * — identical column lists — are broken deterministically so exactly one of the
 * pair is reported.
 */
export function redundantIndexes(indexes: IndexEntry[]): RedundantIndex[] {
  const findings: RedundantIndex[] = []

  for (const candidate of indexes) {
    if (candidate.isPartial || candidate.hasExpression) continue
    if (enforcesConstraint(candidate)) continue

    const coveredBy = indexes.find((other) => {
      if (other === candidate) return false
      if (other.table !== candidate.table || other.method !== candidate.method) return false
      if (other.isPartial || other.hasExpression) return false
      if (!isLeadingPrefix(candidate.keyColumns, other.keyColumns)) return false
      // Same columns on both sides: keep the one that enforces something, else
      // the first by name, so a duplicate pair yields one finding rather than two.
      if (candidate.keyColumns.length === other.keyColumns.length) {
        return enforcesConstraint(other) || other.name.localeCompare(candidate.name) < 0
      }
      return true
    })

    if (coveredBy) findings.push({ index: candidate, coveredBy })
  }

  return findings.sort((a, b) => b.index.bytes - a.index.bytes)
}

/**
 * Foreign keys no index leads with. Postgres indexes the *referenced* side
 * automatically and the referencing side never — so these are the keys where a
 * join or a parent delete scans the whole child table.
 *
 * Partial and expression indexes do not count as cover: a cascade has to find
 * every child row, not the subset a `WHERE` clause kept.
 */
export function unindexedForeignKeys(
  foreignKeys: ForeignKeyColumns[],
  indexes: IndexEntry[],
): ForeignKeyColumns[] {
  return foreignKeys.filter((fk) => {
    const covered = indexes.some(
      (index) =>
        index.table === fk.table &&
        !index.isPartial &&
        !index.hasExpression &&
        isLeadingPrefix(fk.columns, index.keyColumns),
    )
    return !covered
  })
}

export interface IndexAuditTotals {
  indexCount: number
  /** Bytes held by indexes nothing reads — the number that makes the case. */
  unusedBytes: number
  unusedCount: number
  /** Of the unused ones, how many can actually be dropped without losing a constraint. */
  droppableCount: number
  redundantCount: number
  unindexedForeignKeyCount: number
}

export function indexAuditTotals(
  indexes: IndexEntry[],
  foreignKeys: ForeignKeyColumns[],
): IndexAuditTotals {
  const unused = unusedIndexes(indexes)
  return {
    indexCount: indexes.length,
    unusedBytes: unused.reduce((sum, index) => sum + index.bytes, 0),
    unusedCount: unused.length,
    droppableCount: unused.filter((index) => !enforcesConstraint(index)).length,
    redundantCount: redundantIndexes(indexes).length,
    unindexedForeignKeyCount: unindexedForeignKeys(foreignKeys, indexes).length,
  }
}

/** The `DROP INDEX` for a finding, so the page hands over something runnable
 *  rather than a name to retype. Concurrent, because the alternative locks. */
export function dropIndexSql(schema: string, index: IndexEntry): string {
  return `DROP INDEX CONCURRENTLY ${schema}.${index.name};`
}

/** The index a missing foreign-key index would need. */
export function createFkIndexSql(schema: string, fk: ForeignKeyColumns): string {
  const columns = fk.columns.join(', ')
  const name = `${fk.table}_${fk.columns.join('_')}_idx`
  return `CREATE INDEX CONCURRENTLY ${name} ON ${schema}.${fk.table} (${columns});`
}
