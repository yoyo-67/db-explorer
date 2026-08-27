import { kindForType, type ColumnKind } from '#/lib/filter-model'
import type { ColumnInfo, JsonValue } from '#/lib/types'

/**
 * The model behind editing one row — client-safe, so the editor and the server
 * agree on what an edit *is* without either owning it.
 *
 * The whole design turns on one decision: a field is edited as **the text
 * Postgres will read**, not as a typed JavaScript value. A number is the string
 * `1e6`, an array is the literal `{a,b}`, a json document is its own text. That
 * keeps three things honest at once — what the box shows is what gets sent, the
 * diff compares like with like, and nothing has to guess a type well enough to
 * serialize it back. An untyped literal is cast by Postgres against the column
 * it lands in, which is the one type resolution that cannot be wrong.
 *
 * The SQL half lives in `#/server/row-update` (`pg-format` is Node-only, same
 * split as `#/lib/filter-model` and `#/server/filter-sql`).
 */

/** One field's value: the text as Postgres will read it, or SQL NULL. */
export type FieldText = string | null

/** What the inputs hold. Only columns the user touched appear. */
export type EditDraft = Record<string, FieldText>

/** One field that moved, and what it moved from — the `from` half is what makes
 *  the stale check possible without re-reading the page. */
export interface FieldChange {
  column: string
  from: FieldText
  to: FieldText
}

/** One row's pending update, everything the server needs to run and guard it. */
export interface RowEdit {
  schema: string
  table: string
  pkColumn: string
  pkValue: string
  changes: FieldChange[]
}

/** Why a whole row is not editable. */
export type RowBlock = 'view' | 'no-pk' | 'null-pk'

/** Why one column is not editable. */
export type FieldBlock = 'primary-key' | 'generated' | 'nested' | 'compressed'

export function describeRowBlock(block: RowBlock): string {
  switch (block) {
    case 'view':
      return 'A view has no rows of its own — an update would have to go to the tables behind it, which is a different question than the one this screen can answer.'
    case 'no-pk':
      return 'No primary key, and no single-column unique index standing in for one: nothing here identifies exactly one row, so an update could not promise to touch only this one.'
    case 'null-pk':
      return 'This row’s key is NULL, and no equality matches NULL — there is no WHERE clause that would find this row again.'
  }
}

export function describeFieldBlock(block: FieldBlock): string {
  switch (block) {
    case 'primary-key':
      return 'The key this update is addressed to. Changing identity is a different act from changing a value, and doing both in one statement is how a row goes missing.'
    case 'generated':
      return 'The database computes this column; it takes no value from a client.'
    case 'nested':
      return 'This value nests — an array of arrays or of documents. A text box cannot round-trip it back to the same literal, so it is shown and left alone.'
    case 'compressed':
      return 'These bytes are a compressed document, shown decoded. A box holding the decoded text would write that text back as the bytes, replacing the original with a rendering of it.'
  }
}

/**
 * Whether the row can be edited at all. Every reason is a fact about the row or
 * the relation, never a guess: a view, no usable key, or a key that is NULL.
 */
export function rowBlock(ctx: {
  tableKind: 'table' | 'view'
  pkColumn: string | null
  pkValue: FieldText
}): RowBlock | null {
  if (ctx.tableKind === 'view') return 'view'
  if (!ctx.pkColumn) return 'no-pk'
  if (ctx.pkValue === null) return 'null-pk'
  return null
}

/** Whether one column of the row can be edited. Value-aware: the same `ARRAY`
 *  column is editable holding `{a,b}` and not holding `{{a},{b}}`. */
export function fieldBlock(
  col: ColumnInfo,
  value: JsonValue,
  pkColumn: string | null,
): FieldBlock | null {
  if (col.name === pkColumn) return 'primary-key'
  if (col.isGenerated) return 'generated'
  if (col.compression) return 'compressed'
  if (!isRoundTrippable(value)) return 'nested'
  return null
}

/** Whether `fieldText` can turn this value into text that reads back as itself. */
function isRoundTrippable(value: JsonValue): boolean {
  if (Array.isArray(value)) return pgArrayLiteral(value) !== null
  return true
}

/** What input a column gets, and whether it needs more than one line. */
export function fieldShape(col: ColumnInfo): { kind: ColumnKind; multiline: boolean } {
  const kind = kindForType(col.dataType)
  const type = (col.dataType ?? '').toLowerCase()
  // `text` is unbounded and `json` is a document; both are routinely long enough
  // that a single-line box would be editing through a keyhole.
  const multiline = kind === 'json' || type === 'text' || type === 'ARRAY'.toLowerCase()
  return { kind, multiline }
}

/**
 * The value as the input holds it — and as Postgres will read it back.
 *
 * A string is never reformatted, not even one that happens to be JSON: the
 * `text` column holding a document was written by something else, and pretty-
 * printing it on the way in would rewrite data as a side effect of looking at it.
 */
export function fieldText(value: JsonValue): FieldText {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return pgArrayLiteral(value) ?? JSON.stringify(value)
  return JSON.stringify(value, null, 2)
}

/** Elements a bare (unquoted) array literal cannot carry. `{` and `}` bound the
 *  literal, `,` separates it, `"` and `\` are its escapes, whitespace is trimmed
 *  off a bare element, and a bare `NULL` is the NULL element. */
const ARRAY_NEEDS_QUOTES = /[{},"\\\s]/

/**
 * A Postgres array literal — `{a,b}` — for a flat array of scalars, or `null`
 * when the array nests and no literal would read back as itself.
 *
 * Rendered as the literal rather than as JSON because the literal is what the
 * column accepts: `'{a,b}'` casts to `text[]`, `'["a","b"]'` does not.
 */
export function pgArrayLiteral(values: JsonValue[]): string | null {
  const parts: string[] = []
  for (const value of values) {
    if (value === null || value === undefined) {
      parts.push('NULL')
      continue
    }
    if (typeof value === 'object') return null
    const text = String(value)
    const bare = text.length > 0 && !ARRAY_NEEDS_QUOTES.test(text) && text.toUpperCase() !== 'NULL'
    parts.push(bare ? text : `"${text.replace(/([\\"])/g, '\\$1')}"`)
  }
  return `{${parts.join(',')}}`
}

/**
 * Whether two field texts are the same value.
 *
 * Exact text everywhere except json, where the same document has many spellings
 * — an editor that called re-indentation a change would offer to write a row
 * back unchanged, which is the fastest way to teach someone to ignore the diff.
 */
export function sameFieldText(a: FieldText, b: FieldText, kind: ColumnKind): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (kind === 'json') {
    const left = canonicalJson(a)
    const right = canonicalJson(b)
    if (left !== null && right !== null) return left === right
  }
  return false
}

function canonicalJson(text: string): string | null {
  try {
    return JSON.stringify(sortKeys(JSON.parse(text) as JsonValue))
  } catch {
    return null
  }
}

/** Key order is not part of what a json document means, so it is not part of the
 *  comparison either. */
function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, JsonValue> = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key])
    return out
  }
  return value
}

/**
 * The diff between the row on screen and the draft in the inputs, in table
 * column order — the order the row is read in, so the review list reads like the
 * row it is about rather than like a keystroke log.
 */
export function rowChanges(args: {
  row: Record<string, JsonValue>
  draft: EditDraft
  columns: ColumnInfo[]
  pkColumn: string | null
}): FieldChange[] {
  const changes: FieldChange[] = []
  for (const col of args.columns) {
    if (!(col.name in args.draft)) continue
    const original = fieldText(args.row[col.name] ?? null)
    if (fieldBlock(col, args.row[col.name] ?? null, args.pkColumn)) continue
    const next = args.draft[col.name]
    if (sameFieldText(original, next, fieldShape(col).kind)) continue
    changes.push({ column: col.name, from: original, to: next })
  }
  return changes
}

/** The pending update, or `null` when there is nothing to run. */
export function buildRowEdit(args: {
  schema: string
  table: string
  row: Record<string, JsonValue>
  draft: EditDraft
  columns: ColumnInfo[]
  tableKind: 'table' | 'view'
  pkColumn: string | null
}): RowEdit | null {
  const pkValue = args.pkColumn ? fieldText(args.row[args.pkColumn] ?? null) : null
  if (rowBlock({ tableKind: args.tableKind, pkColumn: args.pkColumn, pkValue })) return null
  const changes = rowChanges(args)
  if (changes.length === 0) return null
  return {
    schema: args.schema,
    table: args.table,
    pkColumn: args.pkColumn!,
    pkValue: pkValue!,
    changes,
  }
}

/** Numbers Postgres reads, including the three floats that are not digits. */
const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/
const NUMERIC_WORDS = new Set(['nan', 'infinity', '-infinity', '+infinity', 'inf', '-inf'])

/**
 * What the client can rule out before spending a round trip: a NOT NULL column
 * being cleared, a number that is not one, json that will not parse, a column
 * the table does not have.
 *
 * Deliberately not exhaustive. Type checking belongs to Postgres, which will do
 * it properly against the real column; this only catches the mistakes worth
 * catching in the box the user is still looking at.
 */
export function validateRowEdit(edit: RowEdit, columns: ColumnInfo[]): string[] {
  if (edit.changes.length === 0) return ['Nothing changed.']
  const byName = new Map(columns.map((col) => [col.name, col]))
  const errors: string[] = []
  for (const change of edit.changes) {
    const col = byName.get(change.column)
    if (!col) {
      errors.push(`${change.column} is not a column of ${edit.table}.`)
      continue
    }
    if (change.to === null) {
      if (!col.isNullable) errors.push(`${col.name} is NOT NULL — it cannot be cleared.`)
      continue
    }
    const { kind } = fieldShape(col)
    if (kind === 'numeric' && !isNumericText(change.to)) {
      errors.push(`${col.name} takes a number; “${change.to}” is not one.`)
    }
    if (kind === 'boolean' && !isBooleanText(change.to)) {
      errors.push(`${col.name} takes true or false; “${change.to}” is neither.`)
    }
    if (kind === 'json' && canonicalJson(change.to) === null) {
      errors.push(`${col.name} takes a JSON document, and this one does not parse.`)
    }
  }
  return errors
}

function isNumericText(text: string): boolean {
  const trimmed = text.trim()
  return NUMERIC.test(trimmed) || NUMERIC_WORDS.has(trimmed.toLowerCase())
}

/** The spellings Postgres accepts for a boolean. */
const BOOLEAN_WORDS = new Set(['true', 'false', 't', 'f', 'yes', 'no', 'y', 'n', '1', '0', 'on', 'off'])

function isBooleanText(text: string): boolean {
  return BOOLEAN_WORDS.has(text.trim().toLowerCase())
}

/** One line of the review list: `email: 'a@b.c' → 'z@b.c'`. */
export function describeChange(change: FieldChange): string {
  return `${change.column}: ${quoteForReview(change.from)} → ${quoteForReview(change.to)}`
}

function quoteForReview(value: FieldText): string {
  if (value === null) return 'NULL'
  const oneLine = value.replace(/\s+/g, ' ').trim()
  const clipped = oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine
  return `‘${clipped}’`
}
