import type { ColumnInfo, ForeignKey } from '#/lib/types'

export interface FkTarget {
  table: string
  column: string
}

/** Look up the FK target for a (table, column) pair. Returns undefined when no FK matches. */
export function resolveFk(
  fks: ForeignKey[],
  table: string,
  columnName: string,
): FkTarget | undefined {
  const fk = fks.find((f) => f.fromTable === table && f.fromColumn === columnName)
  if (!fk) return undefined
  return { table: fk.toTable, column: fk.toColumn }
}

/** Build an FkTarget index keyed by `${fromTable}.${fromColumn}` for O(1) lookups during render. */
export function buildFkIndex(fks: ForeignKey[]): Map<string, FkTarget> {
  const index = new Map<string, FkTarget>()
  for (const fk of fks) {
    index.set(`${fk.fromTable}.${fk.fromColumn}`, { table: fk.toTable, column: fk.toColumn })
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
