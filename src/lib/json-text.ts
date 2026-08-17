import type { JsonValue } from '#/lib/types'

/**
 * JSON hiding inside a text column.
 *
 * Plenty of columns are declared `text` or `varchar` and hold a JSON document
 * anyway — a config blob, a serialized payload. Postgres hands those over as a
 * string, so nothing downstream knows to lay them out. This is display only: the
 * value is never rewritten, only rendered.
 *
 * Deliberately narrow. Only objects and arrays count: a bare `"true"`, `"12"` or
 * `"null"` in a text column is a string that happens to be valid JSON, and
 * reformatting it would be a claim about the data rather than a courtesy.
 */

/** Past this, the string is left alone — a multi-megabyte cell is not something
 *  to reformat on every render. */
export const MAX_JSON_TEXT_CHARS = 2_000_000

export function parseJsonText(value: unknown): JsonValue | null {
  if (typeof value !== 'string') return null
  if (value.length > MAX_JSON_TEXT_CHARS) return null

  const trimmed = value.trim()
  if (trimmed.length < 2) return null

  const opens = trimmed.startsWith('{') || trimmed.startsWith('[')
  const closes = trimmed.endsWith('}') || trimmed.endsWith(']')
  if (!opens || !closes) return null

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed === null || typeof parsed !== 'object') return null
    return parsed as JsonValue
  } catch {
    return null
  }
}

/**
 * The value to lay out as JSON, or `null` when there is nothing to lay out —
 * an already-parsed `json`/`jsonb` column comes through as an object, a `text`
 * column carrying JSON comes through as a string, and both should render the same.
 */
export function jsonForDisplay(value: unknown): JsonValue | null {
  if (value !== null && typeof value === 'object') return value as JsonValue
  return parseJsonText(value)
}

/** Indented JSON for a `<pre>`, or `null` when the value is not JSON. */
export function formatJsonText(value: unknown, indent = 2): string | null {
  const target = jsonForDisplay(value)
  if (target === null) return null
  try {
    return JSON.stringify(target, null, indent)
  } catch {
    // Circular structures cannot come out of the driver, but a stringify that
    // throws must not take the cell down with it.
    return null
  }
}
