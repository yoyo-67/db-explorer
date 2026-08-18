import format from 'pg-format'
import type { Predicate } from '#/lib/filter-dsl'
import { parsePredicate } from '#/lib/filter-dsl'

/**
 * The SQL half of the column filter DSL. Split from `#/lib/filter-dsl` because
 * `pg-format` is Node-only (it reads `__dirname`), and the parse/encode half is
 * imported by the filter panel in the browser.
 */

/**
 * Postgres `data_type` (information_schema) values that behave as free text,
 * where substring ILIKE is the sensible default. Everything else (uuid,
 * numeric, date/time, bool, enum, json…) gets native equality so the column
 * index can be used instead of a `::text` cast that forces a seq scan.
 */
function isTextType(dataType?: string): boolean {
  if (!dataType) return true // unknown → keep legacy substring behaviour
  const t = dataType.toLowerCase()
  return (
    t.includes('char') ||
    t === 'text' ||
    t === 'citext' ||
    t === 'name' ||
    // Types with no equality against a bare literal — an array column compared
    // to `x` fails as "malformed array literal", which reads as a broken app
    // rather than as a filter that cannot mean anything. Rendering them to text
    // and matching on that always works, at the price of the index. These are
    // Postgres's own column types (`aclitem[]`, `oidvector`, `pg_node_tree`),
    // reachable only by browsing a system schema.
    t === 'array' ||
    t === 'user-defined'
  )
}

/**
 * Types that have no equality against a bare literal, so a set filter has to
 * render them to text first. Unknown counts: a cast always works, and only the
 * index pays for it.
 */
function needsTextCast(dataType?: string): boolean {
  if (!dataType) return true
  const t = dataType.toLowerCase()
  return t === 'array' || t === 'user-defined'
}

/**
 * Compile a Predicate into a SQL fragment scoped to a column. Identifiers
 * and values are quoted via `pg-format`, so the result is safe to splice
 * directly into a WHERE clause.
 *
 * `dataType` is the column's `information_schema.columns.data_type`. When the
 * column is non-text, equality and comparison are emitted natively (no
 * `::text` cast), letting Postgres coerce the literal and use the index.
 */
export function compilePredicate(
  predicate: Predicate,
  columnName: string,
  dataType?: string,
): string {
  const textCol = isTextType(dataType)
  switch (predicate.kind) {
    case 'null':
      return predicate.negated
        ? format('%I IS NOT NULL', columnName)
        : format('%I IS NULL', columnName)
    case 'cmp': {
      const num = Number(predicate.value)
      const isNumeric =
        predicate.value.trim() !== '' && Number.isFinite(num) && /^[-+0-9.eE]+$/.test(predicate.value.trim())
      if (isNumeric) {
        return format('%I %s %L', columnName, predicate.op, num)
      }
      // Non-text columns compare natively (index-friendly); text keeps cast.
      if (!textCol) {
        return format('%I %s %L', columnName, predicate.op, predicate.value)
      }
      return format('%I::text %s %L', columnName, predicate.op, predicate.value)
    }
    case 'in': {
      const col = needsTextCast(dataType) ? format('%I::text', columnName) : format('%I', columnName)
      const list = predicate.values.map((v) => format('%L', v)).join(', ')
      if (predicate.values.length === 0) return `${col} IS NULL`
      if (!predicate.hasNull) return `${col} IN (${list})`
      return `(${col} IN (${list}) OR ${col} IS NULL)`
    }
    case 'regex':
      return format('%I::text ~ %L', columnName, predicate.pattern)
    case 'ilike':
      // Bare value on a non-text column → exact equality (uses index).
      // Text columns keep substring search.
      if (!textCol) {
        return format('%I = %L', columnName, predicate.pattern)
      }
      return format('%I::text ILIKE %L', columnName, `%${predicate.pattern}%`)
  }
}

/**
 * Compile a `Record<columnName, freeFormInput>` into a single WHERE
 * clause body (without the leading `WHERE`). Empty inputs are skipped.
 * Returns an empty string when no predicates apply.
 */
export function compileFilters(
  filters: Record<string, string>,
  columnTypes: Record<string, string> = {},
): string {
  const fragments: string[] = []
  for (const [column, input] of Object.entries(filters)) {
    const predicate = parsePredicate(input)
    if (!predicate) continue
    fragments.push(compilePredicate(predicate, column, columnTypes[column]))
  }
  return fragments.join(' AND ')
}
