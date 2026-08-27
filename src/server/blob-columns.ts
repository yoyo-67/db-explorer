import { tryDecode } from '#/server/blob-decode'
import { sanitizeRows } from '#/server/json-row'
import type { ColumnInfo, JsonValue } from '#/lib/types'

/**
 * A page of rows, with any compressed `bytea` column decoded and labelled.
 *
 * The cost of detection is what shapes this: brotli has no header, so ruling a
 * column in or out means actually decompressing a value (`#/server/blob-decode`).
 * One value per column decides it — the probe. A column ruled in then decodes
 * cell by cell; a column ruled out is hex, and never asked again. So a table
 * with a thumbnail column pays one failed attempt per page, not fifty.
 *
 * The trade this makes: a column that is compressed in some rows and raw binary
 * in others is judged by its first non-null value. That is the honest reading of
 * a column as a column, and the alternative — deciding per cell — is the
 * per-cell cost the probe exists to avoid.
 */
export function sanitizeRowsWithBlobs(
  columns: ColumnInfo[],
  rows: Record<string, unknown>[],
): { columns: ColumnInfo[]; rows: Record<string, JsonValue>[] } {
  const candidates = columns.filter((col) => isByteaColumn(col))
  if (candidates.length === 0 || rows.length === 0) {
    return { columns, rows: sanitizeRows(rows) }
  }

  const compression = new Map<string, NonNullable<ColumnInfo['compression']>>()
  for (const col of candidates) {
    const probe = firstBuffer(rows, col.name)
    const decoded = probe ? tryDecode(probe) : null
    if (decoded) compression.set(col.name, { codec: decoded.codec, encoding: decoded.encoding })
  }
  if (compression.size === 0) {
    return { columns, rows: sanitizeRows(rows) }
  }

  const sanitized = sanitizeRows(rows)
  for (const [name] of compression) {
    rows.forEach((raw, i) => {
      const value = raw[name]
      if (!Buffer.isBuffer(value)) return
      const decoded = tryDecode(value)
      // A cell that will not decode keeps the hex `sanitizeRows` already gave it:
      // the column is compressed, this value is not, and saying so beats showing
      // an empty cell.
      if (decoded) sanitized[i][name] = decoded.text
    })
  }

  return {
    columns: columns.map((col) => {
      const found = compression.get(col.name)
      return found ? { ...col, compression: found } : col
    }),
    rows: sanitized,
  }
}

/** `information_schema.columns.data_type` says `bytea`; a `bytea[]` says ARRAY,
 *  and an array of blobs is not a document to show. */
function isByteaColumn(col: ColumnInfo): boolean {
  return col.dataType.toLowerCase() === 'bytea'
}

function firstBuffer(rows: Record<string, unknown>[], column: string): Buffer | null {
  for (const row of rows) {
    const value = row[column]
    if (Buffer.isBuffer(value)) return value
  }
  return null
}
