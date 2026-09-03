import { classifyAccess, type AccessPattern } from '#/lib/indexes/shape'
import { indexTrend } from '#/lib/indexes/trend'
import { indexedWrites, writeTax } from '#/lib/indexes/write-tax'
import { redundantIndexes, unindexedForeignKeys } from '#/lib/pressure/index-audit'
import { matchesTableName, tableWithModel } from '#/lib/table-label'
import type {
  ForeignKeyColumns,
  IndexEntry,
  IndexTableEntry,
  IndexUsageEntry,
  SchemaIndexUsage,
} from '#/lib/types'

/**
 * The left rail's rows: every index in the schema, plus the foreign keys that
 * have none, in one list — a gap and a sprawl are the same kind of decision, and
 * splitting them across two panes hides one of them.
 *
 * The verdicts are not decided here. `lib/pressure/index-audit.ts` already owns
 * "redundant" and "uncovered foreign key", and this file adapts to its type
 * rather than restating its rules.
 */

export type IndexFlag =
  | 'invalid'
  | 'never-scanned'
  | 'redundant'
  | 'unique'
  | 'partial'
  | 'non-btree'
  | 'missing-fk'

export type IndexSort = 'scans-per-day' | 'size' | 'tuples-per-scan' | 'write-tax' | 'name'

export const INDEX_FLAGS = [
  'invalid',
  'never-scanned',
  'redundant',
  'unique',
  'partial',
  'non-btree',
  'missing-fk',
] as const satisfies readonly IndexFlag[]

export const INDEX_SORTS = [
  'scans-per-day',
  'size',
  'tuples-per-scan',
  'write-tax',
  'name',
] as const satisfies readonly IndexSort[]

/**
 * The URL is typed by whoever holds the address bar, so what comes back out of
 * it is a string and nothing more. Both readers drop what they do not
 * recognise rather than passing it on: an unknown sort would silently mean
 * "unsorted", and an unknown flag would filter every row away, which reads as
 * an empty schema rather than as a bad link.
 */
export function parseIndexSort(value: string | undefined): IndexSort | undefined {
  return INDEX_SORTS.find((sort) => sort === value)
}

/** Comma-separated flags from `?only=`, de-duplicated and in the order given. */
export function parseIndexFlags(value: string | undefined): IndexFlag[] {
  if (!value) return []
  const seen = new Set<IndexFlag>()
  for (const part of value.split(',')) {
    const flag = INDEX_FLAGS.find((entry) => entry === part.trim())
    if (flag) seen.add(flag)
  }
  return [...seen]
}

export interface IndexListRow {
  kind: 'index' | 'missing-fk'
  /** Stable, unique, and what the page puts in `?index=`. */
  key: string
  table: string
  /** The index name, or the constraint name for a gap. */
  label: string
  columns: string[]
  bytes: number | null
  scansPerDay: number | null
  tuplesPerScan: number | null
  /** Writes on this table that every one of its indexes pays for. */
  indexedWrites: number | null
  pattern: AccessPattern | null
  flags: IndexFlag[]
}

export interface RowCriteria {
  text: string
  flags: IndexFlag[]
  /**
   * One table, or every table.
   *
   * Separate from `text` on purpose: typing a table name into the search box
   * also matches indexes on other tables whose own name contains it, which on a
   * schema where `data_element` and `data_elementstatus` both exist is the
   * wrong list. This one is exact.
   */
  table: string | null
}

/** The audit's type, from ours. Its rules only read these fields. */
function toAuditEntry(index: IndexUsageEntry): IndexEntry {
  return {
    table: index.table,
    name: index.name,
    method: index.method,
    keyColumns: index.keyColumns.map((column) => column.name),
    isUnique: index.isUnique,
    isPrimary: index.isPrimary,
    isPartial: index.isPartial,
    hasExpression: index.hasExpression,
    constraintBacked: index.constraintBacked,
    scans: index.scans,
    bytes: index.bytes,
  }
}

function flagsFor(index: IndexUsageEntry, redundant: Set<string>): IndexFlag[] {
  const flags: IndexFlag[] = []
  if (!index.isValid) flags.push('invalid')
  if (index.scans === 0) flags.push('never-scanned')
  if (redundant.has(index.name)) flags.push('redundant')
  if (index.isUnique) flags.push('unique')
  if (index.isPartial) flags.push('partial')
  if (index.method !== 'btree') flags.push('non-btree')
  return flags
}

export function buildIndexRows(usage: SchemaIndexUsage): IndexListRow[] {
  const auditEntries = usage.indexes.map(toAuditEntry)
  const redundant = new Set(redundantIndexes(auditEntries).map((finding) => finding.index.name))
  const tables = new Map<string, IndexTableEntry>(
    usage.tables.map((table) => [table.table, table]),
  )
  const indexesPerTable = new Map<string, number>()
  for (const index of usage.indexes) {
    indexesPerTable.set(index.table, (indexesPerTable.get(index.table) ?? 0) + 1)
  }

  const indexRows: IndexListRow[] = usage.indexes.map((index) => {
    const table = tables.get(index.table) ?? null
    const shape = classifyAccess(index, table)
    const tax = writeTax(index, table, indexesPerTable.get(index.table) ?? 1)
    return {
      kind: 'index',
      key: `${index.table}.${index.name}`,
      table: index.table,
      label: index.name,
      columns: index.keyColumns.map((column) => column.name),
      bytes: index.bytes,
      scansPerDay: indexTrend(usage.history, index.name).scansPerDay,
      tuplesPerScan: shape.tuplesPerScan,
      indexedWrites: tax.indexedWrites,
      pattern: shape.pattern,
      flags: flagsFor(index, redundant),
    }
  })

  const gaps: ForeignKeyColumns[] = unindexedForeignKeys(usage.foreignKeys, auditEntries)
  const gapRows: IndexListRow[] = gaps.map((fk) => ({
    kind: 'missing-fk',
    key: `${fk.table}.${fk.constraint}`,
    table: fk.table,
    label: fk.constraint,
    columns: fk.columns,
    bytes: null,
    scansPerDay: null,
    tuplesPerScan: null,
    // There is no index here to price, but the table's write volume is still the
    // number that decides whether adding one is cheap.
    indexedWrites: indexedWrites(tables.get(fk.table) ?? null),
    pattern: null,
    flags: ['missing-fk'],
  }))

  return [...indexRows, ...gapRows]
}

/**
 * `models` is the table → Django model map the rest of the app prints names
 * with. A search box that only knew the identifier would answer "no such index"
 * to someone who typed the model name they read one row above.
 */
export function filterRows(
  rows: IndexListRow[],
  criteria: RowCriteria,
  models: Readonly<Record<string, string>> = {},
): IndexListRow[] {
  const needle = criteria.text.trim().toLowerCase()
  return rows.filter((row) => {
    if (criteria.table !== null && row.table !== criteria.table) return false
    if (criteria.flags.some((flag) => !row.flags.includes(flag))) return false
    if (needle === '') return true
    const haystack = [row.label, tableWithModel(row.table, models[row.table]), ...row.columns]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
}

export interface TableChoice {
  table: string
  /** Rows this table contributes — indexes plus any unindexed foreign key. */
  count: number
  bytes: number
}

/**
 * The tables the picker can offer, counted.
 *
 * Built from the rows rather than from the schema's table list, because a table
 * with no index and no missing foreign key has nothing on this page to show —
 * offering it would be offering an empty list.
 */
export function tableChoices(rows: IndexListRow[]): TableChoice[] {
  const byTable = new Map<string, TableChoice>()
  for (const row of rows) {
    const entry = byTable.get(row.table) ?? { table: row.table, count: 0, bytes: 0 }
    entry.count += 1
    entry.bytes += row.bytes ?? 0
    byTable.set(row.table, entry)
  }
  return [...byTable.values()].sort((a, b) => a.table.localeCompare(b.table))
}

/**
 * The choices a typed query leaves, in the order they were offered.
 *
 * Both names are matched whatever the reader chose to display, which is
 * `matchesTableName`'s rule rather than a second one written here. Ranking is
 * deliberately absent: the list is alphabetical and short once narrowed, and a
 * picker whose rows reorder as you type is harder to hit than one that shrinks.
 */
export function searchTableChoices(
  choices: readonly TableChoice[],
  query: string,
  models: Readonly<Record<string, string>> = {},
): TableChoice[] {
  return choices.filter((choice) => matchesTableName(choice.table, models[choice.table], query))
}

/** A row with no number to sort by goes last, whichever direction is chosen: a
 *  missing measurement is not a small one. */
function byDescending(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

export function sortRows(rows: IndexListRow[], sort: IndexSort): IndexListRow[] {
  const sorted = [...rows]
  sorted.sort((a, b) => {
    const primary =
      sort === 'size'
        ? byDescending(a.bytes, b.bytes)
        : sort === 'scans-per-day'
          ? byDescending(a.scansPerDay, b.scansPerDay)
          : sort === 'tuples-per-scan'
            ? byDescending(a.tuplesPerScan, b.tuplesPerScan)
            : sort === 'write-tax'
              ? byDescending(a.indexedWrites, b.indexedWrites)
              : 0
    return primary !== 0 ? primary : a.label.localeCompare(b.label)
  })
  return sorted
}
