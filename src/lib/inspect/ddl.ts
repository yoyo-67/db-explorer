import type { DdlColumn, DdlConstraint, DdlIndex } from '#/lib/types'

const BARE_IDENT = /^[a-z_][a-z0-9_$]*$/

/** Reserved enough that pg_dump would quote it; a short list beats none. */
const RESERVED = new Set([
  'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'authorization',
  'between', 'both', 'case', 'cast', 'check', 'collate', 'column', 'constraint',
  'create', 'cross', 'current_date', 'default', 'desc', 'distinct', 'do', 'else',
  'end', 'except', 'false', 'for', 'foreign', 'from', 'full', 'grant', 'group',
  'having', 'in', 'initially', 'inner', 'intersect', 'into', 'is', 'join', 'left',
  'like', 'limit', 'natural', 'not', 'null', 'offset', 'on', 'only', 'or', 'order',
  'outer', 'overlaps', 'primary', 'references', 'right', 'select', 'session_user',
  'similar', 'some', 'table', 'then', 'to', 'trailing', 'true', 'union', 'unique',
  'user', 'using', 'values', 'when', 'where', 'window', 'with',
])

export function quoteIdent(name: string): string {
  if (BARE_IDENT.test(name) && !RESERVED.has(name)) return name
  return `"${name.replace(/"/g, '""')}"`
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * One column as pg_dump writes it: type, then generation or default, then
 * `NOT NULL` last. Identity and generated columns carry their own clause and
 * never also carry a default.
 */
export function ddlColumnLine(column: DdlColumn): string {
  const parts = [quoteIdent(column.name), column.type]
  if (column.identity) {
    parts.push(`GENERATED ${column.identity} AS IDENTITY`)
  } else if (column.generated) {
    parts.push(`GENERATED ALWAYS AS (${column.generated}) STORED`)
  } else if (column.default) {
    parts.push(`DEFAULT ${column.default}`)
  }
  if (column.notNull) parts.push('NOT NULL')
  return parts.join(' ')
}

const CONSTRAINT_ORDER: Record<string, number> = { p: 0, u: 1, f: 2, c: 3, x: 4, other: 5 }

function sortedConstraints(constraints: DdlConstraint[]): DdlConstraint[] {
  return [...constraints].sort((a, b) => {
    const byKind = (CONSTRAINT_ORDER[a.kind] ?? 9) - (CONSTRAINT_ORDER[b.kind] ?? 9)
    return byKind !== 0 ? byKind : a.name.localeCompare(b.name)
  })
}

export interface DdlParts {
  schema: string
  table: string
  columns: DdlColumn[]
  constraints: DdlConstraint[]
  indexes: DdlIndex[]
  tableComment: string | null
}

/**
 * Assemble runnable DDL from what the catalog reported. Constraints live inside
 * `CREATE TABLE`, the indexes a constraint already created are dropped (emitting
 * both would fail on replay), and comments come last so the whole block can be
 * pasted into a fresh database in order.
 */
export function buildDdlSql(parts: DdlParts): string {
  const qualified = `${quoteIdent(parts.schema)}.${quoteIdent(parts.table)}`
  const body = [
    ...parts.columns.map(ddlColumnLine),
    ...sortedConstraints(parts.constraints).map(
      (c) => `CONSTRAINT ${quoteIdent(c.name)} ${c.definition}`,
    ),
  ]

  const statements: string[] = []
  statements.push(
    body.length === 0
      ? `CREATE TABLE ${qualified} ();`
      : `CREATE TABLE ${qualified} (\n${body.map((line) => `    ${line}`).join(',\n')}\n);`,
  )

  const standaloneIndexes = parts.indexes.filter((i) => !i.constraintBacked)
  if (standaloneIndexes.length > 0) {
    statements.push(
      standaloneIndexes
        .map((i) => (i.definition.trimEnd().endsWith(';') ? i.definition : `${i.definition};`))
        .join('\n'),
    )
  }

  const comments: string[] = []
  if (parts.tableComment) {
    comments.push(`COMMENT ON TABLE ${qualified} IS ${quoteLiteral(parts.tableComment)};`)
  }
  for (const column of parts.columns) {
    if (!column.comment) continue
    comments.push(
      `COMMENT ON COLUMN ${qualified}.${quoteIdent(column.name)} IS ${quoteLiteral(column.comment)};`,
    )
  }
  if (comments.length > 0) statements.push(comments.join('\n'))

  return `${statements.join('\n\n')}\n`
}
