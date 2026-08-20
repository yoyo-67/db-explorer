import type { ColumnInfo, EdgeBasis, ForeignKey, JsonValue } from '#/lib/types'

export interface FkTarget {
  table: string
  column: string
  basis?: EdgeBasis
}

/**
 * Whether a cell value names a row worth linking to.
 *
 * `0` is `InvalidOid` in the catalog — Postgres's way of writing "none" in a
 * column that has no null, which `pg_get_catalog_foreign_keys()` reports as
 * `is_opt`. A link on it opens an empty row page. Everywhere else 0 is an
 * ordinary id and stays clickable.
 */
export function isLinkableFkValue(value: JsonValue | undefined, target: FkTarget): boolean {
  if (value === null || value === undefined) return false
  if (target.basis === 'catalog' && (value === 0 || value === '0')) return false
  return true
}

/** Look up the FK target for a (table, column) pair. Returns undefined when no FK matches. */
export function resolveFk(
  fks: ForeignKey[],
  table: string,
  columnName: string,
): FkTarget | undefined {
  const fk = fks.find((f) => f.fromTable === table && f.fromColumn === columnName)
  if (!fk) return undefined
  return { table: fk.toTable, column: fk.toColumn, basis: fk.basis }
}

/** Build an FkTarget index keyed by `${fromTable}.${fromColumn}` for O(1) lookups during render. */
export function buildFkIndex(fks: ForeignKey[]): Map<string, FkTarget> {
  const index = new Map<string, FkTarget>()
  for (const fk of fks) {
    index.set(`${fk.fromTable}.${fk.fromColumn}`, {
      table: fk.toTable,
      column: fk.toColumn,
      basis: fk.basis,
    })
  }
  return index
}

/** Return a copy of the columns with `references` populated where an FK exists. */
export function enrichColumnsWithFks(
  columns: ColumnInfo[],
  fks: ForeignKey[],
  table: string,
): ColumnInfo[] {
  return columns.map((col) => {
    const target = resolveFk(fks, table, col.name)
    if (!target) return col
    return { ...col, references: target }
  })
}
