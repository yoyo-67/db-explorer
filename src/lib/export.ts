import type { ColumnInfo, JsonValue } from '#/lib/types'

function csvCell(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return ''
  const str =
    typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** Serialize rows to RFC-4180-style CSV using the column header order. */
export function rowsToCsv(
  columns: ColumnInfo[],
  rows: Record<string, JsonValue>[],
): string {
  const header = columns.map((c) => csvCell(c.name)).join(',')
  const body = rows
    .map((row) => columns.map((c) => csvCell(row[c.name])).join(','))
    .join('\r\n')
  return body ? `${header}\r\n${body}\r\n` : `${header}\r\n`
}

/** Build a default filename from the current view: `<schema>.<table>.<page>.csv`. */
export function exportFilename(schema: string, table: string, page: number, ext: string): string {
  return `${schema}.${table}.p${page}.${ext}`
}
