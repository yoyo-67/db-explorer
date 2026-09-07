/**
 * What a pasted value could be, and which primary keys are worth asking about.
 *
 * Find starts from a value and nothing else, so the first decision is how wide
 * to cast: a UUID is unique across the whole database and can be asked of every
 * table that could hold one, while `4271` is the primary key of a row in nearly
 * every table in the schema. Answering the second by probing all of them would
 * return three hundred true-but-useless owners, so a value whose shape cannot
 * single anything out is **gated** — Find says what it needs instead of
 * guessing.
 *
 * Pure on purpose: the SQL lives in `#/server/find-value`, and every rule about
 * what is distinctive enough is decided (and tested) here.
 */

/** The shapes Find can tell apart from the text alone. */
export type FindShape = 'uuid' | 'integer' | 'text'

/** Why a value cannot be searched without being told where to look. */
export type FindGateReason = 'ambiguous-integer' | 'too-short'

export interface ValuePlan {
  /** The value as it will be compared, whitespace and wrapping quotes gone. */
  value: string
  shape: FindShape
  /** Set when the shape cannot single a row out on its own. */
  gateReason: FindGateReason | null
}

/**
 * Below this, a bare string is a word rather than an identifier: `bob` matches
 * a name column in half the schema. Twelve is the shortest length at which the
 * external ids that arrive in logs (`cus_9s8Xk2QpLm`) clear the bar.
 */
export const MIN_DISTINCTIVE_LENGTH = 12

/**
 * Characters that make a short string an identifier rather than a word — the
 * punctuation of emails, slugs, prefixed keys and paths. One is enough:
 * `a@b.co` is a lookup, `alice` is a guess.
 */
const STRUCTURAL = new Set(['@', '-', '_', ':', '.', '/', '+'])

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BARE_UUID = /^[0-9a-f]{32}$/i
const INTEGER = /^-?\d+$/

/** Trim, and drop one layer of wrapping quotes — values arrive pasted out of
 *  JSON logs as often as out of a cell. */
function normalize(raw: string): string {
  const trimmed = raw.trim()
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  return quoted && trimmed.length >= 2 ? trimmed.slice(1, -1).trim() : trimmed
}

export function isUuid(value: string): boolean {
  return CANONICAL_UUID.test(value) || BARE_UUID.test(value)
}

/** Whether a string carries enough shape to be looked up on its own. */
export function isDistinctive(value: string): boolean {
  if (value.length >= MIN_DISTINCTIVE_LENGTH) return true
  return [...value].some((char) => STRUCTURAL.has(char))
}

/**
 * Read a pasted value. Never throws and never rejects: an empty or undecidable
 * value comes back gated, which is a page that says what it needs rather than
 * an error.
 */
export function planValue(raw: string): ValuePlan {
  const value = normalize(raw)
  if (isUuid(value)) return { value, shape: 'uuid', gateReason: null }
  if (INTEGER.test(value)) {
    // Not "we cannot": we can, and the answer is worthless. The owner has to
    // come from somewhere else — the FK cell that was clicked, or a pick list.
    return { value, shape: 'integer', gateReason: 'ambiguous-integer' }
  }
  return {
    value,
    shape: 'text',
    gateReason: isDistinctive(value) ? null : 'too-short',
  }
}

/**
 * Whether a primary key of this declared type could hold the value at all.
 *
 * `information_schema.columns.data_type` spellings, because that is what the
 * schema read hands over. Comparing a uuid column against a non-uuid literal is
 * an error rather than a miss in Postgres, so this is what keeps the probe from
 * failing on the first candidate — it is a correctness filter, not a heuristic.
 */
export function canHold(shape: FindShape, dataType: string): boolean {
  // `format_type` is what the schema read hands over, so the length modifier
  // rides along: `character varying(50)` is the same key as `character varying`.
  const type = dataType.toLowerCase().replace(/\(.*$/, '').trim()
  const textual =
    type === 'text' ||
    type === 'citext' ||
    type === 'character varying' ||
    type === 'character'
  switch (shape) {
    case 'uuid':
      return type === 'uuid' || textual
    case 'integer':
      return (
        type === 'integer' || type === 'bigint' || type === 'smallint' || type === 'numeric'
      )
    // A text value in an integer key cannot match, and a uuid column asked for
    // `alice@example.com` raises `invalid input syntax`, so both stay out.
    case 'text':
      return textual
  }
}

/** The message the gate stands behind, so route and panel word it the same. */
export function gateExplanation(reason: FindGateReason): string {
  switch (reason) {
    case 'ambiguous-integer':
      return 'Nearly every table has a row with this id, so an unaided search would return all of them. Pick the table it belongs to.'
    case 'too-short':
      return `Values under ${MIN_DISTINCTIVE_LENGTH} characters with no @, -, _, : or . in them match too much to search blind. Pick the table it belongs to, or paste more of the value.`
  }
}
