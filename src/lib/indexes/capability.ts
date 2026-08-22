import type { IndexKeyColumn, IndexTableEntry, IndexUsageEntry } from '#/lib/types'

/**
 * What an index can answer, from its shape alone.
 *
 * Usage says what the index *has* served; this says what it *could* — which is
 * the half of the decision the counters cannot supply. Everything here is read
 * off the key columns, the access method and the last ANALYZE, and every claim
 * is deliberately small: an unclaimed capability costs a reader nothing, an
 * invented one costs them a bad decision.
 */

/** Methods whose leading columns take an equality qualifier in key order. */
const PREFIX_EQUALITY_METHODS = new Set(['btree'])
/** Methods that can return rows in index order. */
const SORTING_METHODS = new Set(['btree'])
/** Methods that can bound a range on a key column. */
const RANGE_METHODS = new Set(['btree', 'gist', 'spgist', 'brin'])
/** Methods an index-only scan can be planned on. Kept to the one that always can. */
const INDEX_ONLY_METHODS = new Set(['btree'])
/** Written as `(expr)` by the catalog read: a position with no column name. */
const EXPRESSION_POSITION = '(expr)'

export interface EqualityLookup {
  column: string
  /** Rows a single value is expected to match, from `n_distinct`. */
  estimatedRowsPerValue: number | null
  nullFraction: number | null
}

export interface IndexCapability {
  /** Leading columns that take an equality qualifier, in key order. */
  equalityColumns: EqualityLookup[]
  /** Columns that can carry a range (`>`, `<`, `BETWEEN`) once the columns before them are pinned. */
  rangeCapableColumns: string[]
  /** Orders the index returns rows in, forward and exactly reversed. */
  sortOrders: string[]
  /** Columns readable from the index alone — key plus INCLUDE. */
  coveredColumns: string[]
  /** Whether an index-only scan is possible at all (the visibility map still decides per query). */
  indexOnlyEligible: boolean
  /** The rows a partial index holds; null when it holds all of them. */
  restrictedTo: string | null
  /** Why a claim is missing, in the reader's words. */
  notes: string[]
}

/**
 * Rows one value is expected to match.
 *
 * `pg_stats.n_distinct` is either an absolute count of distinct values or, when
 * negative, minus the *fraction* of rows that are distinct — the form ANALYZE
 * uses when the count scales with the table. `-1` therefore means unique, at any
 * size, and needs no row count at all.
 */
export function rowsPerValue(
  nDistinct: number | null,
  estimatedRows: number | null,
): number | null {
  if (nDistinct === null || nDistinct === 0) return null
  if (nDistinct < 0) return 1 / -nDistinct
  if (estimatedRows === null || estimatedRows <= 0) return null
  return estimatedRows / nDistinct
}

function orderSuffix(column: IndexKeyColumn, reversed: boolean): string {
  const descending = reversed ? !column.descending : column.descending
  const nullsFirst = reversed ? !column.nullsFirst : column.nullsFirst
  const parts: string[] = []
  if (descending) parts.push('DESC')
  // Postgres prints only the non-default: NULLS FIRST goes with DESC, LAST with ASC.
  if (nullsFirst !== descending) parts.push(nullsFirst ? 'NULLS FIRST' : 'NULLS LAST')
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

function sortOrder(columns: IndexKeyColumn[], reversed: boolean): string {
  return columns.map((column) => `${column.name}${orderSuffix(column, reversed)}`).join(', ')
}

export function describeCapability(
  index: IndexUsageEntry,
  table: IndexTableEntry | null,
): IndexCapability {
  const notes: string[] = []
  const estimatedRows = table && table.estimatedRows > 0 ? table.estimatedRows : null
  const named = index.keyColumns.filter((column) => column.name !== EXPRESSION_POSITION)
  const hasExpressionPosition = named.length !== index.keyColumns.length

  if (hasExpressionPosition) {
    notes.push(
      'A key position is an expression, not a column. What it sorts and covers depends on the expression, so nothing is claimed for it here — read the definition.',
    )
  }
  if (!index.isValid) {
    notes.push(
      'This index is not valid: a CREATE INDEX CONCURRENTLY that failed leaves one behind. The planner will not use it, and every write still maintains it.',
    )
  }
  if (!PREFIX_EQUALITY_METHODS.has(index.method) && index.method !== 'hash') {
    notes.push(
      `A ${index.method} index answers the operators its method supports, not equality on a key prefix — no sort order and no index-only scan are claimed for it.`,
    )
  }

  const usable = hasExpressionPosition ? [] : index.keyColumns

  let equalityColumns: EqualityLookup[] = []
  if (index.method === 'hash') {
    equalityColumns = usable.slice(0, 1).map((column) => ({
      column: column.name,
      estimatedRowsPerValue: rowsPerValue(
        index.columnStats.find((stats) => stats.column === column.name)?.nDistinct ?? null,
        estimatedRows,
      ),
      nullFraction:
        index.columnStats.find((stats) => stats.column === column.name)?.nullFraction ?? null,
    }))
    notes.push('A hash index serves equality on one column. It cannot sort, range or cover.')
  } else if (PREFIX_EQUALITY_METHODS.has(index.method)) {
    equalityColumns = usable.map((column) => {
      const stats = index.columnStats.find((entry) => entry.column === column.name)
      return {
        column: column.name,
        estimatedRowsPerValue: rowsPerValue(stats?.nDistinct ?? null, estimatedRows),
        nullFraction: stats?.nullFraction ?? null,
      }
    })
  }

  const rangeCapableColumns = RANGE_METHODS.has(index.method)
    ? usable.map((column) => column.name)
    : []

  const sortOrders =
    SORTING_METHODS.has(index.method) && usable.length > 0
      ? [sortOrder(usable, false), sortOrder(usable, true)]
      : []

  const coveredColumns = hasExpressionPosition
    ? []
    : [...index.keyColumns.map((column) => column.name), ...index.includeColumns]

  const indexOnlyEligible =
    INDEX_ONLY_METHODS.has(index.method) && index.isValid && coveredColumns.length > 0

  if (indexOnlyEligible) {
    notes.push(
      'An index-only scan needs the visibility map to say the page is all-visible, so a table with vacuum debt falls back to heap visits.',
    )
  }
  if (index.isPartial) {
    notes.push(
      'Partial: the planner uses it only for queries whose own WHERE implies this predicate.',
    )
  }

  return {
    equalityColumns,
    rangeCapableColumns,
    sortOrders,
    coveredColumns,
    indexOnlyEligible,
    restrictedTo: index.isPartial ? index.predicate : null,
    notes,
  }
}
