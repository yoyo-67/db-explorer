import type { ColumnInfo, ForeignKey, JsonValue } from '#/lib/types'

const PRIMARY_FIELDS = ['name', 'title', 'email', 'username', 'label', 'slug'] as const

/**
 * Pick a human-friendly label for a row given its columns and the FK graph.
 * Preference order:
 *   1. A short string in one of the well-known label fields (`name`, `title`, ...)
 *   2. The first non-FK string column under a sane length cap
 *   3. The row's primary-key style id wrapped as `Row #<id>`
 *   4. Literal "Row" if nothing usable is present
 */
export function getRowLabel(
  row: Record<string, JsonValue>,
  columns: ColumnInfo[] = [],
  fks: ForeignKey[] = [],
  tableName?: string,
): string {
  for (const field of PRIMARY_FIELDS) {
    const value = row[field]
    if (typeof value === 'string' && value.length > 0) return value
  }

  const fkColumns = new Set(
    fks
      .filter((fk) => !tableName || fk.fromTable === tableName)
      .map((fk) => fk.fromColumn),
  )

  for (const col of columns) {
    if (fkColumns.has(col.name)) continue
    const value = row[col.name]
    if (typeof value === 'string' && value.length > 0 && value.length < 100) {
      return value
    }
  }

  // Fallback: scan any remaining string field
  for (const value of Object.values(row)) {
    if (typeof value === 'string' && value.length > 0 && value.length < 100) {
      return value
    }
  }

  const id = row['id']
  if (id !== undefined && id !== null) return `Row #${String(id)}`
  return 'Row'
}
