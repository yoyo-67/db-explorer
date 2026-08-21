import format from 'pg-format'
import { query, withWriteTransaction } from '#/server/db'
import { sanitizeRow } from '#/server/json-row'
import {
  fieldShape,
  fieldText,
  sameFieldText,
  validateRowEdit,
  type FieldText,
  type RowEdit,
} from '#/lib/row-edit'
import type { ColumnInfo, JsonValue } from '#/lib/types'

/**
 * The SQL half of editing a row: build the statement, guard it, run it.
 *
 * Three promises, in the order they are kept:
 *
 * 1. **It is the row you were looking at.** The statement is keyed on the
 *    primary key, and the transaction re-reads the columns about to change
 *    under `FOR UPDATE` before writing. A value that has moved since the page
 *    loaded stops the update and is reported column by column, rather than
 *    quietly overwriting whoever got there first.
 * 2. **It is one row.** The lock refuses a key that matches more than one row,
 *    and the update refuses to commit unless it touched exactly one.
 * 3. **It is the statement you were shown.** The preview and the write build
 *    their SQL from the same function, so the text on screen is the text that
 *    runs — including `RETURNING *`.
 *
 * Identifiers go through `%I` and values through `%L`, the same way the read
 * side builds its queries (`#/server/filter-sql`). Values are sent as untyped
 * literals with no cast: Postgres resolves them against the column they land
 * in, which is the one type decision that cannot be got wrong from here.
 */

/** One column that changed in the database since the page read it. */
export interface RowUpdateConflict {
  column: string
  /** What the page had. */
  expected: FieldText
  /** What the row holds now. */
  actual: FieldText
}

export type RowUpdateResult =
  | { ok: true; sql: string; row: Record<string, JsonValue> }
  | { ok: false; error: string; conflicts?: RowUpdateConflict[] }

/** The statement that would run, or why it will not. */
export type RowUpdatePreview = { ok: true; sql: string } | { ok: false; error: string }

/** `UPDATE ... RETURNING *` for one row: only the columns that changed, keyed on
 *  the primary key. */
export function buildUpdateSql(edit: RowEdit): string {
  const assignments = edit.changes
    .map((change) => `${format('%I', change.column)} = ${literal(change.to)}`)
    .join(', ')
  return (
    `UPDATE ${format('%I.%I', edit.schema, edit.table)} SET ${assignments} ` +
    `WHERE ${format('%I', edit.pkColumn)} = ${format('%L', edit.pkValue)} RETURNING *`
  )
}

/**
 * The read that makes the write safe: the columns about to change, as they are
 * right now, with the row held until the transaction ends.
 *
 * `FOR UPDATE` rather than a plain `SELECT` because the check and the write are
 * two statements — without the lock, a row could change in the gap between
 * being approved and being written, which is precisely the race the check is
 * there to close.
 */
export function buildLockSql(edit: RowEdit): string {
  const columns = edit.changes.map((change) => format('%I', change.column)).join(', ')
  return (
    `SELECT ${columns} FROM ${format('%I.%I', edit.schema, edit.table)} ` +
    `WHERE ${format('%I', edit.pkColumn)} = ${format('%L', edit.pkValue)} FOR UPDATE`
  )
}

/** `%L` renders `null` as the keyword; spelled out because the difference
 *  between `NULL` and `'NULL'` is a whole afternoon. */
function literal(value: FieldText): string {
  return value === null ? 'NULL' : format('%L', value)
}

export async function previewRowUpdate(edit: RowEdit): Promise<RowUpdatePreview> {
  const target = await resolveEditTarget(edit)
  if (!target.ok) return target
  return { ok: true, sql: buildUpdateSql(edit) }
}

export async function updateRow(edit: RowEdit): Promise<RowUpdateResult> {
  const target = await resolveEditTarget(edit)
  if (!target.ok) return target

  const sql = buildUpdateSql(edit)
  try {
    return await withWriteTransaction(async (run) => {
      const locked = await run(buildLockSql(edit))
      const lockedCount = locked.rows.length
      if (lockedCount === 0) throw new RefusedUpdate('That row is no longer there — it was deleted, or its key changed.')
      if (lockedCount > 1) {
        throw new RefusedUpdate(
          `${format('%I', edit.pkColumn)} = ${edit.pkValue} matches ${lockedCount} rows, so this update would not be about one row.`,
        )
      }

      const conflicts = findConflicts(edit, sanitizeRow(locked.rows[0] as Record<string, unknown>), target.columns)
      if (conflicts.length > 0) {
        throw new RefusedUpdate(
          `The row changed since this page read it: ${conflicts.map((c) => c.column).join(', ')}. Nothing was written.`,
          conflicts,
        )
      }

      const written = await run(sql)
      if (written.rows.length !== 1) {
        throw new RefusedUpdate(
          `The update touched ${written.rows.length} rows instead of one; it has been rolled back.`,
        )
      }
      return {
        ok: true as const,
        sql,
        row: sanitizeRow(written.rows[0] as Record<string, unknown>),
      }
    })
  } catch (err) {
    if (err instanceof RefusedUpdate) {
      return { ok: false, error: err.message, conflicts: err.conflicts }
    }
    // Anything else is Postgres speaking: a constraint, a bad cast, a
    // permission. Its own words are more useful than any paraphrase.
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Thrown to roll the transaction back on purpose. A refusal is not a failure —
 * it is the guard doing its job — so it carries the sentence the user should
 * read rather than a stack.
 */
class RefusedUpdate extends Error {
  constructor(
    message: string,
    readonly conflicts?: RowUpdateConflict[],
  ) {
    super(message)
    this.name = 'RefusedUpdate'
  }
}

/** Which columns no longer hold what the page thought they held. */
function findConflicts(
  edit: RowEdit,
  current: Record<string, JsonValue>,
  columns: ColumnInfo[],
): RowUpdateConflict[] {
  const byName = new Map(columns.map((col) => [col.name, col]))
  const conflicts: RowUpdateConflict[] = []
  for (const change of edit.changes) {
    const actual = fieldText(current[change.column] ?? null)
    const col = byName.get(change.column)
    const kind = col ? fieldShape(col).kind : 'text'
    if (!sameFieldText(change.from, actual, kind)) {
      conflicts.push({ column: change.column, expected: change.from, actual })
    }
  }
  return conflicts
}

type EditTarget = { ok: true; columns: ColumnInfo[] } | { ok: false; error: string }

/**
 * The relation this edit claims to be about, as the catalog has it — and every
 * reason it might not be editable.
 *
 * The names are already quoted, so this is not about injection; it is about
 * failing as a lookup rather than as a syntax error, and about failing *before*
 * a transaction is opened. A client is not trusted to have told the truth about
 * which columns are generated or nullable: those facts are re-read here, from
 * the same views the read side uses, so the answer cannot drift from what the
 * page was shown.
 */
async function resolveEditTarget(edit: RowEdit): Promise<EditTarget> {
  const result = await query(
    `
    SELECT
      columns.column_name,
      columns.data_type,
      columns.is_nullable,
      columns.is_generated,
      columns.identity_generation,
      tables.table_type
    FROM information_schema.tables AS tables
    JOIN information_schema.columns AS columns
      ON columns.table_schema = tables.table_schema
      AND columns.table_name = tables.table_name
    WHERE tables.table_schema = $1 AND tables.table_name = $2
    ORDER BY columns.ordinal_position
  `,
    [edit.schema, edit.table],
  )

  const where = `${edit.schema}.${edit.table}`
  if (result.rows.length === 0) {
    return { ok: false, error: `No table ${where} — it may have been dropped, or renamed.` }
  }
  if (result.rows[0].table_type !== 'BASE TABLE') {
    return {
      ok: false,
      error: `${where} is a view: it has no rows of its own to update.`,
    }
  }

  const columns: ColumnInfo[] = result.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    isNullable: row.is_nullable === 'YES',
    isGenerated: row.is_generated === 'ALWAYS' || row.identity_generation != null,
  }))
  const byName = new Map(columns.map((col) => [col.name, col]))

  if (!byName.has(edit.pkColumn)) {
    return { ok: false, error: `${where} has no column ${edit.pkColumn} to key this update on.` }
  }
  for (const change of edit.changes) {
    if (change.column === edit.pkColumn) {
      return {
        ok: false,
        error: `${edit.pkColumn} is the key this update is addressed to; it cannot also be what the update changes.`,
      }
    }
    const col = byName.get(change.column)
    if (!col) return { ok: false, error: `${where} has no column ${change.column}.` }
    if (col.isGenerated) {
      return { ok: false, error: `${change.column} is generated by the database; it takes no value.` }
    }
  }

  const errors = validateRowEdit(edit, columns)
  if (errors.length > 0) return { ok: false, error: errors.join(' ') }

  return { ok: true, columns }
}
