/**
 * References that leave the database.
 *
 * Postgres cannot declare one: a foreign key is a constraint inside a single
 * database, so a column holding the id of a row in a *different* database on the
 * same server is, to the server, just a value. Nothing in the catalog can be
 * asked about it — the knowledge lives with whoever built the two schemas, so it
 * is written down by hand, per connection, in
 *
 *   local/<connection>/cross-db-refs.json
 *
 * Per connection and not per database on purpose: the fact spans two databases,
 * and filing it under either one would hide it from the other.
 */

export interface CrossDbTarget {
  database: string
  schema: string
  table: string
  column: string
}

export interface CrossDbRef {
  from: {
    database: string
    schema: string
    /** Omit to match the column in every table of that schema. */
    table?: string
    column: string
  }
  to: CrossDbTarget
  /** Why the link exists, shown on the value. */
  note?: string
}

export interface CrossDbRefFile {
  source?: string
  refs: CrossDbRef[]
}

export interface ColumnLocation {
  database: string
  schema: string
  table: string
  column: string
}

/**
 * The target for one column, or null.
 *
 * A rule naming a table beats a rule that matches every table: `celery_task_id`
 * can mean the same thing schema-wide and still need one table pointed
 * elsewhere, and the specific statement is the one someone wrote deliberately.
 */
export function resolveCrossDbRef(refs: CrossDbRef[], at: ColumnLocation): CrossDbRef | null {
  const applicable = refs.filter(
    (ref) =>
      ref.from.database === at.database &&
      ref.from.schema === at.schema &&
      ref.from.column === at.column &&
      (ref.from.table === undefined || ref.from.table === at.table),
  )
  return (
    applicable.find((ref) => ref.from.table === at.table) ?? applicable[0] ?? null
  )
}

/** Every cross-database column of one table, keyed by column name. */
export function crossDbRefsForTable(
  refs: CrossDbRef[],
  at: Omit<ColumnLocation, 'column'>,
  columns: string[],
): Record<string, CrossDbRef> {
  const found: Record<string, CrossDbRef> = {}
  for (const column of columns) {
    const ref = resolveCrossDbRef(refs, { ...at, column })
    if (ref) found[column] = ref
  }
  return found
}

/**
 * Attach the hand-written targets to a table's columns, the way
 * `enrichColumnsWithFks` attaches the declared ones. Columns no rule mentions
 * come back untouched.
 */
export function enrichColumnsWithCrossDbRefs<T extends { name: string }>(
  columns: T[],
  refs: CrossDbRef[],
  at: Omit<ColumnLocation, 'column'>,
): (T & { crossRef?: CrossDbTarget & { note?: string } })[] {
  if (refs.length === 0) return columns
  return columns.map((col) => {
    const ref = resolveCrossDbRef(refs, { ...at, column: col.name })
    if (!ref) return col
    return { ...col, crossRef: { ...ref.to, note: ref.note } }
  })
}

/** `celery_results.django_celery_results_taskresult.task_id` — for a title. */
export function describeCrossDbTarget(target: CrossDbTarget): string {
  const relation =
    target.schema === 'public' ? target.table : `${target.schema}.${target.table}`
  return `${target.database}.${relation}.${target.column}`
}
