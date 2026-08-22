import { classifyAccess, type AccessPattern } from '#/lib/indexes/shape'
import { indexTrend } from '#/lib/indexes/trend'
import { indexedWrites, writeTax } from '#/lib/indexes/write-tax'
import { redundantIndexes, unindexedForeignKeys } from '#/lib/pressure/index-audit'
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

export function filterRows(rows: IndexListRow[], criteria: RowCriteria): IndexListRow[] {
  const needle = criteria.text.trim().toLowerCase()
  return rows.filter((row) => {
    if (criteria.flags.some((flag) => !row.flags.includes(flag))) return false
    if (needle === '') return true
    const haystack = [row.label, row.table, ...row.columns].join(' ').toLowerCase()
    return haystack.includes(needle)
  })
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
