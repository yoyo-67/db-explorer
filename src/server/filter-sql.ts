import format from 'pg-format'
import type { Condition } from '#/lib/filter-model'
import { arityForOp, hasChain, isConditionComplete, kindForType } from '#/lib/filter-model'
import type { TableSort } from '#/lib/types'

/**
 * The SQL half of the filter model. Split from `#/lib/filter-model` because
 * `pg-format` is Node-only (it reads `__dirname`), and the model is imported by
 * the filter panel in the browser.
 *
 * Every fragment here is quoted through `pg-format`, so the result is safe to
 * splice into a statement. The bias throughout is the index: cast only where a
 * type has no other option, anchor prefix matches, and emit one `IN` rather
 * than a chain of `OR`s.
 */

/**
 * Types that have no equality or pattern match against a bare literal, so they
 * have to be rendered to text first. Unknown counts: a cast always works, and
 * only the index pays for it. These are reachable mostly in system schemas
 * (`aclitem[]`, `pg_node_tree`) — and enums, where `= 'x'` would fail to parse.
 */
function needsTextCast(dataType?: string): boolean {
  if (!dataType) return true
  const t = dataType.toLowerCase()
  return t === 'array' || t === 'user-defined'
}

/** Whether `ILIKE`/`~` can be applied to the column as it stands. */
function isTextual(dataType?: string): boolean {
  return kindForType(dataType) === 'text' && !needsTextCast(dataType)
}

/** `qualifier` prefixes the column with a table alias — needed inside a chain's
 *  subquery, where two tables can carry the same column name. */
function columnRef(
  columnName: string,
  dataType: string | undefined,
  forPattern: boolean,
  qualifier?: string,
): string {
  const cast = forPattern ? !isTextual(dataType) : needsTextCast(dataType)
  const ref = qualifier
    ? `${format('%I', qualifier)}.${format('%I', columnName)}`
    : format('%I', columnName)
  return cast ? `${ref}::text` : ref
}

/**
 * `%` and `_` are LIKE's own wildcards. A value carrying one means the
 * character, not the wildcard — a search for `50%` that also matched `500`
 * would be lying about what it filtered on.
 */
function escapeLikeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&')
}

const COMPARISONS: Partial<Record<Condition['op'], string>> = {
  eq: '=',
  ne: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

/**
 * Compile one condition into a SQL boolean expression scoped to its column.
 *
 * `dataType` is the column's `information_schema.columns.data_type`. It decides
 * whether the comparison is native (index-usable) or goes through `::text`.
 */
export function compileCondition(
  condition: Condition,
  dataType?: string,
  qualifier?: string,
): string {
  const { column, op, values } = condition
  const plain = columnRef(column, dataType, false, qualifier)
  const pattern = columnRef(column, dataType, true, qualifier)

  switch (op) {
    case 'isNull':
      return `${plain} IS NULL`
    case 'notNull':
      return `${plain} IS NOT NULL`
    case 'between':
      // Half-open: the natural reading of a date range, and the only one where
      // two adjacent ranges neither overlap nor leave a gap.
      return `(${plain} >= ${format('%L', values[0])} AND ${plain} < ${format('%L', values[1])})`
    case 'startsWith':
      // LIKE, not ILIKE: an anchored case-sensitive match is the one form a
      // btree index on the column can serve.
      return `${pattern} LIKE ${format('%L', `${escapeLikeValue(values[0])}%`)}`
    case 'contains':
      return `${pattern} ILIKE ${format('%L', `%${escapeLikeValue(values[0])}%`)}`
    case 'endsWith':
      return `${pattern} ILIKE ${format('%L', `%${escapeLikeValue(values[0])}`)}`
    case 'regex':
      return `${pattern} ~ ${format('%L', values[0])}`
    case 'in':
    case 'notIn': {
      const negated = op === 'notIn'
      if (values.length === 0) return `${plain} IS ${negated ? 'NOT ' : ''}NULL`
      const list = values.map((v) => format('%L', v)).join(', ')
      const membership = `${plain} ${negated ? 'NOT IN' : 'IN'} (${list})`
      // `NOT IN` drops null rows on its own — unticking a value must not also
      // hide the rows that have none, unless the null member says so.
      if (!condition.includeNull) return membership
      return `(${membership} OR ${plain} IS NULL)`
    }
    default:
      return `${plain} ${COMPARISONS[op]} ${format('%L', values[0])}`
  }
}

/**
 * A chained condition: the column is not compared to anything, it is matched
 * against the keys of rows found by walking its foreign key.
 *
 *   preset_id IN (SELECT t1.id FROM public.data_preset t1
 *                 JOIN public.data_constructionproject t2 ON t2.id = t1.project_id
 *                 WHERE t2.company_id IN ('…'))
 *
 * A semi-join, so it stays true as rows are added — the alternative, resolving
 * the far end to a list of keys once, is a snapshot that quietly goes stale.
 *
 * The last step is where the values live, and it is reached without a join: the
 * step before it already holds the key column to compare, so a two-step chain
 * emits no join at all and every further step adds exactly one.
 */
/**
 * What the far end of a chain is compared as. The column there is always a key —
 * uuid, integer, or text — so equality and `IN` must stay native or the FK index
 * goes unused, while a pattern match still has to reach text. `uuid` is the type
 * that decides both of those the right way; the chain does not carry the real
 * one, and paying a `::text` cast on every key comparison to learn it would cost
 * more than it tells.
 */
const KEY_TYPE = 'uuid'

function compileChained(condition: Condition, schema: string): string {
  const chain = condition.chain!
  const alias = (i: number) => `t${i + 1}`
  const joined = chain.slice(1, -1)
  const joins = joined.map((step, i) =>
    format(
      ' JOIN %I.%I %s ON %s.%I = %s.%I',
      schema,
      step.table,
      alias(i + 1),
      alias(i + 1),
      step.keyColumn,
      alias(i),
      chain[i].viaColumn!,
    ),
  )
  // The comparison happens on the second-to-last step's own FK column, which is
  // the last step's key by definition — one join lighter, same rows.
  const lastJoinIndex = chain.length - 2
  const inner: Condition = { ...condition, column: chain[lastJoinIndex].viaColumn!, chain: undefined }
  const where = compileCondition(inner, KEY_TYPE, alias(lastJoinIndex))
  const head = format(
    '%I IN (SELECT %s.%I FROM %I.%I %s',
    condition.column,
    alias(0),
    chain[0].keyColumn,
    schema,
    chain[0].table,
    alias(0),
  )
  return `${head}${joins.join('')} WHERE ${where})`
}

/**
 * Compile a condition list into a WHERE clause body (without the leading
 * `WHERE`), AND-ing every complete condition. Incomplete ones — a range with
 * one bound typed, a value box still empty — are skipped rather than rejected:
 * the panel edits in place, and a half-typed row is a normal intermediate state.
 */
export function compileConditionList(
  conditions: Condition[],
  columnTypes: Record<string, string> = {},
  schema?: string,
): string[] {
  const fragments: string[] = []
  for (const condition of conditions) {
    if (!isConditionComplete(condition)) continue
    const arity = arityForOp(condition.op)
    if (arity !== 'many' && condition.values.length < arity) continue
    if (hasChain(condition)) {
      // A chain names tables, so it cannot be written without a schema to name
      // them in. Every caller that builds a statement has one; one that does not
      // is asking for a fragment a chain has no place in.
      if (schema) fragments.push(compileChained(condition, schema))
      continue
    }
    fragments.push(compileCondition(condition, columnTypes[condition.column]))
  }
  return fragments
}

export function compileConditions(
  conditions: Condition[],
  columnTypes: Record<string, string> = {},
  schema?: string,
): string {
  return compileConditionList(conditions, columnTypes, schema).join(' AND ')
}

/**
 * The WHERE clause as its own lines: the first condition sits on `WHERE`, each
 * further one on an indented `AND`. Postgres does not care, and the panel shows
 * the statement it runs — so the statement is the thing that has to be legible.
 */
function whereLines(
  conditions: Condition[],
  columnTypes: Record<string, string> | undefined,
  schema: string,
): string[] {
  const fragments = compileConditionList(conditions, columnTypes, schema)
  if (fragments.length === 0) return []
  const [first, ...rest] = fragments
  return [`WHERE ${first}`, ...rest.map((fragment) => `  AND ${fragment}`)]
}

export interface TableQueryArgs {
  schema: string
  table: string
  conditions: Condition[]
  columnTypes?: Record<string, string>
  sort?: TableSort | null
}

/**
 * The one place a filtered table query is written. The page, the count, the
 * plan estimate and the SQL the panel shows all come from here, so the preview
 * is the statement that runs rather than a rendering of it.
 */
export function buildTableQuery(args: TableQueryArgs & { limit: number; offset: number }): string {
  const lines = ['SELECT *', format('FROM %I.%I', args.schema, args.table)]
  lines.push(...whereLines(args.conditions, args.columnTypes, args.schema))
  if (args.sort) {
    lines.push(
      format('ORDER BY %I %s', args.sort.column, args.sort.direction === 'desc' ? 'DESC' : 'ASC'),
    )
  }
  lines.push(`LIMIT ${Math.floor(args.limit)} OFFSET ${Math.floor(args.offset)}`)
  return lines.join('\n')
}

/**
 * The same filter with no page window and no sort — what the planner is asked
 * about, so its row estimate is of matching rows rather than of one page.
 */
export function buildMatchQuery(args: TableQueryArgs): string {
  return ['SELECT *', format('FROM %I.%I', args.schema, args.table), ...whereLines(args.conditions, args.columnTypes, args.schema)].join('\n')
}

export function buildCountQuery(args: TableQueryArgs): string {
  return [
    'SELECT COUNT(*)::bigint AS c',
    format('FROM %I.%I', args.schema, args.table),
    ...whereLines(args.conditions, args.columnTypes, args.schema),
  ].join('\n')
}
