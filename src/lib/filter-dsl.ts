import format from 'pg-format'

export type CmpOp = '>' | '<' | '>=' | '<=' | '='

export type Predicate =
  | { kind: 'cmp'; op: CmpOp; value: string }
  | { kind: 'null'; negated: boolean }
  | { kind: 'regex'; pattern: string }
  | { kind: 'ilike'; pattern: string }

const CMP_RE = /^(>=|<=|=|>|<)\s*(.*)$/

/**
 * Parse a free-form per-column filter input into a {@link Predicate}.
 * Returns `null` for empty input. Malformed inputs degrade to ILIKE
 * rather than throwing — by design.
 */
export function parsePredicate(input: string): Predicate | null {
  const s = input.trim()
  if (!s) return null

  const lower = s.toLowerCase()
  if (lower === 'null') return { kind: 'null', negated: false }
  if (lower === '!null' || lower === 'not null') return { kind: 'null', negated: true }

  if (s.startsWith('~')) {
    const pattern = s.slice(1).trim()
    if (!pattern) return { kind: 'ilike', pattern: '~' }
    return { kind: 'regex', pattern }
  }

  const m = s.match(CMP_RE)
  if (m) {
    const op = m[1] as CmpOp
    const value = m[2].trim()
    if (value) return { kind: 'cmp', op, value }
  }

  return { kind: 'ilike', pattern: s }
}

/**
 * Compile a Predicate into a SQL fragment scoped to a column. Identifiers
 * and values are quoted via `pg-format`, so the result is safe to splice
 * directly into a WHERE clause.
 */
export function compilePredicate(predicate: Predicate, columnName: string): string {
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
      return format('%I::text %s %L', columnName, predicate.op, predicate.value)
    }
    case 'regex':
      return format('%I::text ~ %L', columnName, predicate.pattern)
    case 'ilike':
      return format('%I::text ILIKE %L', columnName, `%${predicate.pattern}%`)
  }
}

/**
 * Compile a `Record<columnName, freeFormInput>` into a single WHERE
 * clause body (without the leading `WHERE`). Empty inputs are skipped.
 * Returns an empty string when no predicates apply.
 */
export function compileFilters(filters: Record<string, string>): string {
  const fragments: string[] = []
  for (const [column, input] of Object.entries(filters)) {
    const predicate = parsePredicate(input)
    if (!predicate) continue
    fragments.push(compilePredicate(predicate, column))
  }
  return fragments.join(' AND ')
}
