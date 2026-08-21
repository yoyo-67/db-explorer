import type { JsonValue } from '#/lib/types'

/**
 * Driver values, made safe to send to a browser.
 *
 * `pg` hands back `Date`, `Buffer`, `bigint` and composite objects, none of
 * which survive JSON — a `Date` becomes a string with a different meaning in
 * every locale, a `Buffer` becomes `{"0":31,...}`. Converting once, here, is
 * what lets every row in the app be the same shape whether it came from a page
 * query, a row detail, or an update's `RETURNING *`.
 */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    const obj: Record<string, JsonValue> = {}
    for (const [k, v] of Object.entries(value)) {
      obj[k] = toJsonValue(v)
    }
    return obj
  }
  return String(value)
}

export function sanitizeRow(row: Record<string, unknown>): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(row)) {
    result[key] = toJsonValue(value)
  }
  return result
}

export function sanitizeRows(rows: Record<string, unknown>[]): Record<string, JsonValue>[] {
  return rows.map(sanitizeRow)
}
