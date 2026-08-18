export type CmpOp = '>' | '<' | '>=' | '<=' | '='

export type Predicate =
  | { kind: 'cmp'; op: CmpOp; value: string }
  | { kind: 'null'; negated: boolean }
  | { kind: 'regex'; pattern: string }
  | { kind: 'ilike'; pattern: string }
  /** A set filter: the column matches any of `values`, or is null when
   *  `hasNull`. Written by the column's value picker, not typed by hand. */
  | { kind: 'in'; values: string[]; hasNull: boolean }

const CMP_RE = /^(>=|<=|=|>|<)\s*(.*)$/

/** Wire form of a set filter, so one column still means one string in the URL:
 *  `in:` then values joined by `|`, with `\` and `|` backslash-escaped and the
 *  null member written as the bare token `\N` (Postgres COPY's convention). */
const IN_PREFIX = 'in:'
const NULL_TOKEN = '\\N'

/** Split on `|` that is not escaped, keeping every segment still escaped. */
function splitEscaped(body: string): string[] {
  const segments: string[] = []
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\\' && i + 1 < body.length) {
      current += c + body[i + 1]
      i++
    } else if (c === '|') {
      segments.push(current)
      current = ''
    } else {
      current += c
    }
  }
  segments.push(current)
  return segments
}

function unescapeSegment(segment: string): string {
  return segment.replace(/\\(.)/g, '$1')
}

/**
 * Encode a picked set of values into the filter input a column carries.
 * `null` in the list means the null member. An empty selection encodes to the
 * empty string, which clears the column's filter rather than matching nothing.
 *
 * The empty string is not encodable — `parsePredicate` drops empty segments —
 * the same gap {@link isFilterableValue} already documents for the exact form.
 */
export function encodeInFilter(values: (string | null)[]): string {
  if (values.length === 0) return ''
  const segments = values.map((v) =>
    v === null ? NULL_TOKEN : v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|'),
  )
  return IN_PREFIX + segments.join('|')
}

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

  if (lower.startsWith(IN_PREFIX)) {
    const segments = splitEscaped(s.slice(IN_PREFIX.length)).filter((seg) => seg.length > 0)
    const hasNull = segments.includes(NULL_TOKEN)
    const values = segments.filter((seg) => seg !== NULL_TOKEN).map(unescapeSegment)
    if (!hasNull && values.length === 0) return null
    return { kind: 'in', values, hasNull }
  }

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
