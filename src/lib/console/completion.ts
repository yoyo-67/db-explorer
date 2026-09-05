import { fuzzyMatch } from '#/lib/fuzzy'
import {
  placeholders as _placeholders,
  skipLiteral,
  statementAt,
  tableRefs,
  type TableRef,
} from '#/lib/console/statements'
import type { ForeignKey, TableInfo } from '#/lib/types'

/**
 * What the console offers you as you type, and why it can offer more than a SQL
 * client normally does.
 *
 * A generic editor completes from a dictionary of keywords. This one has the
 * schema the connection is actually pointed at — every table, every column and
 * every type from `$introspect` — plus two things that are this application's
 * own: the Django model behind each flat `data_`-prefixed table name, and a
 * foreign-key map that already merges declared constraints with the
 * hand-written `fk-overrides.json`. So it can complete the name you were
 * reading into the name Postgres answers to, and it can write a join clause
 * rather than making you look one up.
 *
 * The whole engine is a pure function of (schema, buffer, cursor). It does its
 * own filtering and ranking and hands back an ordered list, which is what lets
 * a model name match a table it shares no characters with — an editor filtering
 * on the inserted text could never do that.
 */

export interface ConsoleSchema {
  schema: string
  tables: TableInfo[]
  fks: ForeignKey[]
  /** Table → Django model, from `schema-map.json`. Missing is normal. */
  models: Record<string, string | null>
}

export type CandidateKind = 'table' | 'column' | 'keyword'

export interface Candidate {
  /** What the row reads as, and what is inserted unless `insert` says otherwise. */
  label: string
  /** The fuller text to insert — a join's whole `table alias ON ...` clause. */
  insert?: string
  /** The right-hand note: a column's type, a table's model, a link's basis. */
  detail?: string
  kind: CandidateKind
}

export interface Completion {
  /** Where the replaced word starts, so the editor overwrites rather than appends. */
  from: number
  options: Candidate[]
}

/** Offered where a clause can start. Deliberately short: a keyword list long
 *  enough to be exhaustive is one that buries the schema names under it. */
const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT',
  'OFFSET', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'AS', 'AND', 'OR',
  'NOT', 'IN', 'IS NULL', 'IS NOT NULL', 'DISTINCT', 'COUNT(*)', 'WITH',
  'UNION', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC',
]

/** The keywords after which only a table name makes sense. */
const TABLE_POSITION = new Set(['from', 'join', 'update', 'into'])

const WORD_CHAR = /[A-Za-z0-9_$]/

/** How much of the identifier under the cursor has been typed so far. */
function wordStart(sql: string, cursor: number): number {
  let i = cursor
  while (i > 0 && WORD_CHAR.test(sql[i - 1])) i--
  return i
}

/**
 * Whether the cursor sits inside a string, a comment or a dollar-quoted body —
 * the one condition under which the right number of suggestions is none.
 *
 * Walked rather than pattern-matched, using the same lexer the rest of the
 * console splits statements with, so "inside a literal" means the same thing
 * everywhere.
 */
function insideLiteral(sql: string, cursor: number): boolean {
  let i = 0
  while (i < cursor) {
    const skipped = skipLiteral(sql, i)
    if (skipped > i) {
      if (skipped >= cursor) return true
      i = skipped
    } else i++
  }
  return false
}

/** The last significant word before the cursor — what decides which of the
 *  positions below the cursor is in. Skips the partial word being typed. */
function precedingWord(sql: string, from: number): string {
  let i = from
  while (i > 0 && /\s/.test(sql[i - 1])) i--
  const end = i
  while (i > 0 && /[A-Za-z_]/.test(sql[i - 1])) i--
  return sql.slice(i, end).toLowerCase()
}

/** `orders` → `o`, `data_recordingpipeline` → `dr`: the initials of the name's
 *  segments, which is how people alias tables by hand. */
function aliasFor(table: string, taken: Set<string>): string {
  const initials = table.split('_').filter(Boolean).map((p) => p[0]).join('').toLowerCase()
  const base = initials || table[0]?.toLowerCase() || 't'
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Every name the statement already answers to, so a generated alias never
 *  shadows one. */
function takenNames(refs: TableRef[]): Set<string> {
  const taken = new Set<string>()
  for (const ref of refs) {
    if (ref.alias) taken.add(ref.alias.toLowerCase())
    else taken.add(ref.table.toLowerCase())
  }
  return taken
}

/** Resolve `o.` — an alias if the statement bound one, otherwise a table name. */
function tableFor(schema: ConsoleSchema, refs: TableRef[], qualifier: string): TableInfo | null {
  const lower = qualifier.toLowerCase()
  const ref = refs.find((r) => (r.alias ?? r.table).toLowerCase() === lower)
  const name = ref?.table ?? qualifier
  return schema.tables.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null
}

/**
 * Rank by how well the typed text matches, then keep the list short.
 *
 * `boost` is what puts a foreign-key-reachable table above an unrelated one
 * that happens to match a character better. It is added to the fuzzy score
 * rather than sorting before it, so a strong text match can still win — someone
 * who typed the whole name of an unreachable table meant that table.
 */
function rank<T>(
  items: T[],
  query: string,
  text: (item: T) => string[],
  boost: (item: T) => number = () => 0,
): T[] {
  const scored: Array<{ item: T; score: number }> = []
  for (const item of items) {
    let best: number | null = null
    for (const candidate of text(item)) {
      const match = fuzzyMatch(candidate, query)
      if (match && (best === null || match.score > best)) best = match.score
    }
    if (best !== null) scored.push({ item, score: best + boost(item) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.item)
}

/** The join clause accepting a table would write, or null when no key links it
 *  to anything the statement already names. */
function joinClause(
  schema: ConsoleSchema,
  refs: TableRef[],
  target: TableInfo,
): { insert: string; basis: string | null } | null {
  const named = new Map(refs.map((r) => [r.table.toLowerCase(), r.alias ?? r.table]))
  for (const fk of schema.fks) {
    const from = fk.fromTable.toLowerCase()
    const to = fk.toTable.toLowerCase()
    const self = target.name.toLowerCase()
    const alias = aliasFor(target.name, takenNames(refs))
    // The statement has the referencing side; the target is referenced.
    if (to === self && named.has(from)) {
      const other = named.get(from)!
      return {
        insert: `${target.name} ${alias} ON ${alias}.${fk.toColumn} = ${other}.${fk.fromColumn}`,
        basis: fk.basis ?? null,
      }
    }
    // The statement has the referenced side; the target references it.
    if (from === self && named.has(to)) {
      const other = named.get(to)!
      return {
        insert: `${target.name} ${alias} ON ${alias}.${fk.fromColumn} = ${other}.${fk.toColumn}`,
        basis: fk.basis ?? null,
      }
    }
  }
  return null
}

/** A table's completion row: the identifier is what gets inserted, the model is
 *  why it may have matched, so the model is what the detail says. */
function tableCandidate(schema: ConsoleSchema, table: TableInfo): Candidate {
  const model = schema.models[table.name]
  return {
    label: table.name,
    kind: 'table',
    detail: model ?? (table.kind === 'view' ? 'view' : undefined),
  }
}

function columnCandidates(table: TableInfo, query: string): Candidate[] {
  return rank(table.columns, query, (c) => [c.name]).map((c) => ({
    label: c.name,
    kind: 'column' as const,
    detail: c.dataType || undefined,
  }))
}

/**
 * The column whose values are being typed, when that is what is happening.
 *
 * `WHERE status = ` is the position where this application can offer something
 * almost no SQL client can: the values actually in the column. It already knows
 * how to ask — the filter panel's `$getColumnValues` — and the console already
 * knows which table an alias refers to. This function is the missing third
 * thing: recognising the position at all.
 *
 * Everything here is textual and synchronous. The fetch belongs to the caller,
 * because whether a list of live values is worth a round trip is a question
 * about the UI and not about the SQL.
 */
export interface ValueTarget {
  table: string
  column: string
  /** The cursor is already between quotes, so an inserted value must not add more. */
  quoted: boolean
  /** The column is textual: an unquoted value would be a syntax error. */
  needsQuotes: boolean
  /** Where the typed value starts — inside the quote, when there is one. */
  from: number
}

/** Operators with a literal on their right. `in` is here because `IN (` is the
 *  same position repeated, and a value list is where it matters most. */
const COMPARISONS = ['<=', '>=', '<>', '!=', '=', '<', '>']
const COMPARISON_WORDS = new Set(['like', 'ilike', 'in', 'is'])

/** Types whose literals are written bare. Everything else takes quotes — being
 *  wrong in that direction produces a quoted number, which Postgres coerces,
 *  rather than a bare word, which it rejects. */
function isBareType(dataType: string): boolean {
  return /^(small|big)?int|^numeric|^decimal|^real|^double|^float|^money|^bool/i.test(dataType)
}

/**
 * Whether the cursor sits inside a string, and where that string's body began.
 *
 * Unlike {@link insideLiteral}, this reports the position rather than just the
 * fact — completing a value the person has already opened a quote for is the
 * common case, not an edge case, so "inside a string" cannot simply mean "do
 * not complete".
 */
function openString(sql: string, cursor: number): { quoteAt: number; bodyAt: number } | null {
  let i = 0
  while (i < cursor) {
    const skipped = skipLiteral(sql, i)
    if (skipped > i) {
      const isString = sql[i] === "'" || ((sql[i] === 'E' || sql[i] === 'e') && sql[i + 1] === "'")
      if (skipped >= cursor && isString) {
        return { quoteAt: i, bodyAt: sql.indexOf("'", i) + 1 }
      }
      if (skipped >= cursor) return null
      i = skipped
    } else i++
  }
  return null
}

/** Step back over whitespace and comments to the last real character. */
function previousReal(sql: string, i: number): number {
  let at = i - 1
  while (at >= 0 && /\s/.test(sql[at])) at--
  return at
}

/** Read an identifier ending at `end` (inclusive), walking backwards. */
function identBefore(sql: string, end: number): { name: string; start: number } | null {
  let at = end
  while (at >= 0 && /[A-Za-z0-9_$]/.test(sql[at])) at--
  const start = at + 1
  if (start > end) return null
  return { name: sql.slice(start, end + 1), start }
}

export function valueTargetAt(
  schema: ConsoleSchema,
  sql: string,
  cursor: number,
): ValueTarget | null {
  const inString = openString(sql, cursor)
  const valueStart = inString ? inString.quoteAt : wordStart(sql, cursor)

  // Walk back over any list already begun: `IN (\'a\', \'b\'` is the same
  // position as `IN (`, and someone typing the third value wants the same list.
  let at = previousReal(sql, valueStart)
  while (at >= 0 && (sql[at] === ',' || sql[at] === "'")) {
    if (sql[at] === "'") {
      // Step over a complete literal in the list, backwards.
      let j = at - 1
      while (j >= 0 && sql[j] !== "'") j--
      if (j < 0) return null
      at = previousReal(sql, j)
    } else at = previousReal(sql, at)
  }
  if (at >= 0 && sql[at] === '(') at = previousReal(sql, at)
  if (at < 0) return null

  // The operator: either a word (LIKE, IN) or a symbol run.
  let operatorStart: number
  const word = identBefore(sql, at)
  if (word && COMPARISON_WORDS.has(word.name.toLowerCase())) {
    operatorStart = word.start
  } else {
    const twoChar = sql.slice(Math.max(0, at - 1), at + 1)
    const oneChar = sql[at]
    if (COMPARISONS.includes(twoChar)) operatorStart = at - 1
    else if (COMPARISONS.includes(oneChar)) operatorStart = at
    else return null
  }

  // The column on the operator\'s left, optionally qualified.
  const columnEnd = previousReal(sql, operatorStart)
  if (columnEnd < 0) return null
  const columnRef = identBefore(sql, columnEnd)
  if (!columnRef) return null

  const refs = tableRefs(statementAt(sql, cursor)?.text ?? sql)
  let table: TableInfo | null = null
  if (sql[columnRef.start - 1] === '.') {
    const qualifier = identBefore(sql, columnRef.start - 2)
    if (!qualifier) return null
    table = tableFor(schema, refs, qualifier.name)
  } else {
    // A bare column belongs to whichever table in the query has it. Ambiguity
    // is resolved by taking the first, which is the same rule Postgres would
    // reject and the person would then qualify.
    for (const ref of refs) {
      const candidate = schema.tables.find(
        (t) => t.name.toLowerCase() === ref.table.toLowerCase(),
      )
      if (candidate?.columns.some((c) => c.name === columnRef.name)) {
        table = candidate
        break
      }
    }
  }

  const column = table?.columns.find((c) => c.name === columnRef.name)
  if (!table || !column) return null

  return {
    table: table.name,
    column: column.name,
    quoted: Boolean(inString),
    needsQuotes: !isBareType(column.dataType),
    from: inString ? inString.bodyAt : valueStart,
  }
}

/**
 * What to offer at a cursor, or null when the answer is nothing at all.
 *
 * Reads only the statement the cursor is in: the tables of the query above are
 * not in scope for the query being written, and offering them is how a
 * completion list stops being trustworthy.
 */
export function completeAt(
  schema: ConsoleSchema,
  sql: string,
  cursor: number,
): Completion | null {
  if (insideLiteral(sql, cursor)) return null

  const statement = statementAt(sql, cursor)
  const refs = statement ? tableRefs(statement.text) : []

  const from = wordStart(sql, cursor)
  const query = sql.slice(from, cursor)

  // `alias.` — the only position where the answer is exactly one table's columns.
  if (sql[from - 1] === '.') {
    const qualifier = sql.slice(wordStart(sql, from - 1), from - 1)
    if (!qualifier) return null
    const table = tableFor(schema, refs, qualifier)
    return { from, options: table ? columnCandidates(table, query) : [] }
  }

  const preceding = precedingWord(sql, from)

  if (TABLE_POSITION.has(preceding)) {
    const joining = preceding === 'join'
    const ranked = rank(
      schema.tables,
      query,
      (t) => [t.name, schema.models[t.name] ?? ''].filter(Boolean),
      (t) => (joining && joinClause(schema, refs, t) ? 40 : 0),
    )
    return {
      from,
      options: ranked.map((t) => {
        const base = tableCandidate(schema, t)
        if (!joining) return base
        const join = joinClause(schema, refs, t)
        if (!join) return base
        return {
          ...base,
          insert: join.insert,
          detail: [base.detail, join.basis && `via ${join.basis} key`]
            .filter(Boolean)
            .join(' · ') || undefined,
        }
      }),
    }
  }

  // Anywhere else: the columns of the tables this statement names, then the
  // tables themselves, then keywords. Columns lead because a bare name in a
  // SELECT list or a WHERE clause is overwhelmingly a column.
  const inScope = refs
    .map((r) => schema.tables.find((t) => t.name.toLowerCase() === r.table.toLowerCase()))
    .filter((t): t is TableInfo => Boolean(t))

  const columns = inScope.flatMap((t) => columnCandidates(t, query))
  const seen = new Set(columns.map((c) => c.label))
  const tables = rank(
    schema.tables,
    query,
    (t) => [t.name, schema.models[t.name] ?? ''].filter(Boolean),
  ).map((t) => tableCandidate(schema, t))
  const keywords = rank(KEYWORDS, query, (k) => [k]).map((label) => ({
    label,
    kind: 'keyword' as const,
  }))

  return {
    from,
    options: [...columns, ...tables.filter((t) => !seen.has(t.label)), ...keywords],
  }
}

/** Re-exported so a caller needing both reads one module. */
export const placeholders = _placeholders
