/**
 * The filter a table page carries: a flat list of conditions, all AND-ed.
 *
 * Browser-safe by design — the SQL half lives in `#/server/filter-sql`, since
 * `pg-format` is Node-only. What both halves share is the type table below:
 * the operators a column may take follow from its Postgres `data_type`, and
 * the panel must offer exactly what the compiler can emit.
 */

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'notIn'
  | 'startsWith'
  | 'contains'
  | 'endsWith'
  | 'regex'
  | 'isNull'
  | 'notNull'

export interface Condition {
  /** Stable across edits, so React keys and the URL agree on identity. */
  id: string
  column: string
  op: FilterOp
  /** Arity follows the operator — see {@link arityForOp}. */
  values: string[]
  /** `in`/`notIn` only: whether the null member is part of the set. */
  includeNull?: boolean
}

/** What kind of column this is, as far as filtering cares. */
export type ColumnKind = 'text' | 'numeric' | 'temporal' | 'boolean' | 'uuid' | 'json'

/**
 * Map `information_schema.columns.data_type` onto a filter kind. Unknown types
 * read as text: substring search always compiles (via a cast), where a range
 * on an unknown type would not.
 */
export function kindForType(dataType?: string): ColumnKind {
  if (!dataType) return 'text'
  const t = dataType.toLowerCase()
  if (t === 'boolean') return 'boolean'
  if (t === 'uuid') return 'uuid'
  if (t === 'json' || t === 'jsonb') return 'json'
  if (
    t.includes('int') ||
    t === 'numeric' ||
    t === 'decimal' ||
    t === 'real' ||
    t === 'money' ||
    t.startsWith('double')
  ) {
    return 'numeric'
  }
  if (t.startsWith('date') || t.startsWith('time') || t === 'interval') return 'temporal'
  return 'text'
}

const OPS_BY_KIND: Record<ColumnKind, FilterOp[]> = {
  text: [
    'contains',
    'startsWith',
    'endsWith',
    'eq',
    'ne',
    'in',
    'notIn',
    'regex',
    'isNull',
    'notNull',
  ],
  numeric: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn', 'isNull', 'notNull'],
  temporal: ['between', 'gte', 'lte', 'gt', 'lt', 'eq', 'ne', 'in', 'notIn', 'isNull', 'notNull'],
  boolean: ['eq', 'ne', 'isNull', 'notNull'],
  uuid: ['eq', 'ne', 'in', 'notIn', 'isNull', 'notNull'],
  json: ['isNull', 'notNull', 'regex', 'contains'],
}

/** The operators offered for a column, most useful first. */
export function operatorsForType(dataType?: string): FilterOp[] {
  return OPS_BY_KIND[kindForType(dataType)]
}

/** The operator a fresh condition on this column starts with. */
export function defaultOpForType(dataType?: string): FilterOp {
  return operatorsForType(dataType)[0]
}

export type Arity = 0 | 1 | 2 | 'many'

export function arityForOp(op: FilterOp): Arity {
  switch (op) {
    case 'isNull':
    case 'notNull':
      return 0
    case 'between':
      return 2
    case 'in':
    case 'notIn':
      return 'many'
    default:
      return 1
  }
}

/** Whether a condition says anything — an incomplete one is skipped, not an error. */
export function isConditionComplete(condition: Condition): boolean {
  if (!condition.column) return false
  const arity = arityForOp(condition.op)
  if (arity === 'many') return condition.values.length > 0 || condition.includeNull === true
  const filled = condition.values.filter((v) => v.trim().length > 0)
  return filled.length >= arity
}

/**
 * Wire form: one condition per string, `column~op~value~value`, so a URL stays
 * readable and one edited condition rewrites one entry. `~` and `\` inside a
 * value are backslash-escaped; the bare token `\N` is the null member of a set
 * (Postgres COPY's convention, as the old DSL used).
 */
const SEP = '~'
const NULL_TOKEN = '\\N'

function escapeSegment(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/~/g, '\\~')
}

function unescapeSegment(segment: string): string {
  return segment.replace(/\\(.)/g, '$1')
}

function splitEscaped(encoded: string): string[] {
  const segments: string[] = []
  let current = ''
  for (let i = 0; i < encoded.length; i++) {
    const c = encoded[i]
    if (c === '\\' && i + 1 < encoded.length) {
      current += c + encoded[i + 1]
      i++
    } else if (c === SEP) {
      segments.push(current)
      current = ''
    } else {
      current += c
    }
  }
  segments.push(current)
  return segments
}

export function encodeConditions(conditions: Condition[]): string[] {
  return conditions.map((c) => {
    const values = c.values.map(escapeSegment)
    if (c.includeNull) values.push(NULL_TOKEN)
    return [escapeSegment(c.column), c.op, ...values].join(SEP)
  })
}

const KNOWN_OPS = new Set<string>(Object.values(OPS_BY_KIND).flat())

export function decodeConditions(encoded: string[] | undefined): Condition[] {
  if (!encoded) return []
  const conditions: Condition[] = []
  encoded.forEach((entry, index) => {
    const segments = splitEscaped(entry)
    const [rawColumn, op, ...rawValues] = segments
    if (!rawColumn || !op || !KNOWN_OPS.has(op)) return
    const includeNull = rawValues.includes(NULL_TOKEN)
    const values = rawValues.filter((v) => v !== NULL_TOKEN).map(unescapeSegment)
    const condition: Condition = {
      id: `${index}-${unescapeSegment(rawColumn)}-${op}`,
      column: unescapeSegment(rawColumn),
      op: op as FilterOp,
      values,
      ...(includeNull ? { includeNull: true } : {}),
    }
    if (!isConditionComplete(condition)) return
    const arity = arityForOp(condition.op)
    if (arity !== 'many' && values.length !== arity) return
    conditions.push(condition)
  })
  return conditions
}

/**
 * The checkbox side of a set condition. Unlike the old picker, ticks are the
 * whole truth: an `in` with nothing ticked is incomplete and filters nothing,
 * so the first tick means "only this" rather than "all but this".
 */
export function isValueTicked(condition: Condition, value: string | null): boolean {
  if (value === null) return condition.includeNull === true
  return condition.values.includes(value)
}

export function toggleSetValue(condition: Condition, value: string | null): Condition {
  if (value === null) {
    const { includeNull: _was, ...rest } = condition
    return condition.includeNull ? rest : { ...condition, includeNull: true }
  }
  const values = condition.values.includes(value)
    ? condition.values.filter((v) => v !== value)
    : [...condition.values, value]
  return { ...condition, values }
}

/**
 * Whether an index can serve this operator at all. Drives the warning the panel
 * shows next to a condition — an unanchored match reads every row no matter
 * what indexes exist, and that is worth knowing before running it.
 */
export function isSargable(op: FilterOp): boolean {
  return op !== 'contains' && op !== 'endsWith' && op !== 'regex' && op !== 'ne' && op !== 'notIn'
}

/** Whether two conditions say the same thing, ignoring their id. */
export function sameCondition(a: Condition, b: Condition): boolean {
  return (
    a.column === b.column &&
    a.op === b.op &&
    a.values.length === b.values.length &&
    a.values.every((v, i) => v === b.values[i]) &&
    (a.includeNull ?? false) === (b.includeNull ?? false)
  )
}

/** Whether this filter already says what the candidate condition says. Drives
 *  the pressed state of a chip that sets it. */
export function hasCondition(conditions: Condition[], candidate: Condition): boolean {
  return conditions.some((c) => sameCondition(c, candidate))
}

/** Replace the condition with this id, or append it when the id is new. */
export function upsertCondition(conditions: Condition[], condition: Condition): Condition[] {
  const index = conditions.findIndex((c) => c.id === condition.id)
  if (index === -1) return [...conditions, condition]
  const next = [...conditions]
  next[index] = condition
  return next
}

export function removeCondition(conditions: Condition[], id: string): Condition[] {
  return conditions.filter((c) => c.id !== id)
}

/**
 * What a chip click means: setting the same condition again clears it, and
 * setting a different one under the same id replaces it. This is what makes a
 * clicked facet value in the inspector a toggle rather than a stack of
 * conditions that together match nothing.
 */
export function toggleCondition(conditions: Condition[], condition: Condition): Condition[] {
  const existing = conditions.find((c) => c.id === condition.id)
  if (existing && sameCondition(existing, condition)) return removeCondition(conditions, condition.id)
  return upsertCondition(conditions, condition)
}

/**
 * A fresh condition for a column, on the operator that column is usually
 * filtered by. `seed` only has to be unique within the panel — the id is React's
 * key and the handle every edit goes through, never anything the URL carries.
 */
export function newCondition(column: string, dataType: string | undefined, seed: number | string): Condition {
  const op = defaultOpForType(dataType)
  const arity = arityForOp(op)
  return {
    id: `c${seed}-${column}`,
    column,
    op,
    values: arity === 'many' || arity === 0 ? [] : Array.from({ length: arity }, () => ''),
  }
}

/**
 * Switch a condition's operator, keeping as much of what was typed as the new
 * operator can hold. Changing `>= x` to a range should not make you retype `x`.
 */
export function changeOp(condition: Condition, op: FilterOp): Condition {
  const arity = arityForOp(op)
  if (arity === 'many') {
    return { ...condition, op, values: condition.values.filter((v) => v.length > 0) }
  }
  const { includeNull: _dropped, ...rest } = condition
  const values = Array.from({ length: arity }, (_, i) => condition.values[i] ?? '')
  return { ...rest, op, values }
}

/**
 * Whether two condition lists filter the same way — what the Apply button reads
 * to know whether anything is pending. Ids and half-written rows are not part
 * of it; order is, because the panel shows it.
 */
export function conditionsEqual(a: Condition[], b: Condition[]): boolean {
  const left = a.filter(isConditionComplete)
  const right = b.filter(isConditionComplete)
  if (left.length !== right.length) return false
  return left.every((condition, i) => sameCondition(condition, right[i]))
}
