/**
 * What the console can tell about the text in the editor without parsing SQL.
 *
 * Everything the console does beyond typing into a box needs to know where one
 * statement stops and the next starts — running the statement at the cursor,
 * placing a Postgres error at the character it names, offering the columns of
 * the tables already in the query. None of that needs a parse tree; all of it
 * needs to know where the strings and the comments are, because a `;` inside
 * one is not a boundary and a `FROM` inside one is not a table.
 *
 * So this is a lexer with four questions asked of it, and the split is
 * deliberate: it has to be exactly right about quoting, and it is allowed to be
 * approximately right about everything else. The worst a wrong table name can
 * do is order a completion list badly; a wrong string boundary would cut a
 * statement in half.
 */

/** One statement's span in the buffer it came from, semicolon excluded. */
export interface Statement {
  from: number
  to: number
  text: string
}

/** A table a statement names, and what the rest of the statement calls it. */
export interface TableRef {
  schema: string | null
  table: string
  alias: string | null
}

/**
 * Where the next token starts, having stepped over whitespace, comments, and
 * any string or quoted identifier beginning at `i`.
 *
 * The one function that has to be right. Everything else in this file walks the
 * buffer through it, so a construct handled here is handled everywhere: a `;`,
 * a `FROM` or a `$1` inside a literal is never seen by anything downstream.
 *
 * Returns the index just past the construct at `i`, or `i` itself when there is
 * no construct there — which is the caller's signal to advance by one.
 */
export function skipLiteral(sql: string, i: number): number {
  const c = sql[i]

  // -- to the end of the line.
  if (c === '-' && sql[i + 1] === '-') {
    const nl = sql.indexOf('\n', i)
    return nl === -1 ? sql.length : nl
  }

  // Block comments nest in Postgres, unlike C's: /* a /* b */ c */ is one.
  if (c === '/' && sql[i + 1] === '*') {
    let depth = 1
    let j = i + 2
    while (j < sql.length && depth > 0) {
      if (sql[j] === '/' && sql[j + 1] === '*') {
        depth++
        j += 2
      } else if (sql[j] === '*' && sql[j + 1] === '/') {
        depth--
        j += 2
      } else j++
    }
    return j
  }

  // '...' — a doubled quote is a quote, not a close. E'...' additionally takes
  // backslash escapes, which is the only thing the prefix changes here.
  if (c === "'" || ((c === 'E' || c === 'e') && sql[i + 1] === "'")) {
    const escapes = c !== "'"
    let j = (escapes ? i + 1 : i) + 1
    while (j < sql.length) {
      if (escapes && sql[j] === '\\') j += 2
      else if (sql[j] === "'") {
        if (sql[j + 1] === "'") j += 2
        else return j + 1
      } else j++
    }
    return sql.length
  }

  // "..." is an identifier rather than a string, and quotes the same way.
  if (c === '"') {
    let j = i + 1
    while (j < sql.length) {
      if (sql[j] === '"') {
        if (sql[j + 1] === '"') j += 2
        else return j + 1
      } else j++
    }
    return sql.length
  }

  // $tag$ ... $tag$, whose whole point is to hold text that would otherwise
  // need escaping — semicolons very much included. `$1` is not one of these:
  // the tag has to be empty or an identifier, never a number.
  if (c === '$') {
    const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
    if (tag) {
      const close = sql.indexOf(tag[0], i + tag[0].length)
      return close === -1 ? sql.length : close + tag[0].length
    }
  }

  return i
}

/**
 * The statements in a buffer, in order, with the offsets they occupy in it.
 *
 * Empty ones are dropped rather than reported: `;;` is a typo, not two
 * statements, and a caller asking "what would I run here" should never be
 * handed a blank to run.
 */
export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = []
  let start = 0
  let i = 0

  const push = (from: number, to: number) => {
    const text = sql.slice(from, to)
    const lead = text.length - text.trimStart().length
    const trimmed = text.trim()
    if (trimmed) out.push({ from: from + lead, to: from + lead + trimmed.length, text: trimmed })
  }

  while (i < sql.length) {
    const skipped = skipLiteral(sql, i)
    if (skipped > i) {
      i = skipped
      continue
    }
    if (sql[i] === ';') {
      push(start, i)
      start = i + 1
    }
    i++
  }
  push(start, sql.length)
  return out
}

/**
 * The statement a cursor is in — what ⌘↵ runs.
 *
 * A cursor sitting in the whitespace after a statement takes that statement
 * rather than nothing: pressing Return and then ⌘↵ is how everybody re-runs
 * what they just wrote, and answering "no statement here" to that is answering
 * the wrong question.
 */
export function statementAt(sql: string, cursor: number): Statement | null {
  const parts = splitStatements(sql)
  if (parts.length === 0) return null
  for (const part of parts) {
    if (cursor >= part.from && cursor <= part.to) return part
  }
  // Between two statements, or past the last: the one most recently closed.
  let best: Statement | null = null
  for (const part of parts) {
    if (part.to < cursor) best = part
  }
  return best ?? parts[0]
}

/** The words that end a table reference — anything here is the next clause, not
 *  an alias, and anything here right after FROM means there is no table yet. */
const CLAUSE_WORDS = new Set([
  'select', 'from', 'where', 'group', 'order', 'having', 'limit', 'offset',
  'join', 'inner', 'left', 'right', 'full', 'cross', 'lateral', 'natural',
  'on', 'using', 'set', 'values', 'returning', 'union', 'intersect', 'except',
  'as', 'and', 'or', 'not', 'window', 'fetch', 'for', 'into', 'with',
])

/** Reads one identifier at `i` — quoted or bare — and where it ended. */
function readIdent(sql: string, i: number): { name: string; end: number } | null {
  if (sql[i] === '"') {
    const end = skipLiteral(sql, i)
    return { name: sql.slice(i + 1, end - 1).replace(/""/g, '"'), end }
  }
  const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i))
  return m ? { name: m[0], end: i + m[0].length } : null
}

/** Steps over whitespace and comments to the next real character. */
function nextToken(sql: string, i: number): number {
  while (i < sql.length) {
    if (/\s/.test(sql[i])) {
      i++
      continue
    }
    const skipped = skipLiteral(sql, i)
    // A string or an identifier is a token; only a comment is skippable here.
    if (skipped > i && (sql[i] === '-' || sql[i] === '/')) {
      i = skipped
      continue
    }
    return i
  }
  return i
}

/**
 * The tables a statement names, with their aliases — what completion needs to
 * answer `o.` with `orders`' columns, and what a join suggestion needs to know
 * which side it is joining from.
 *
 * Shallow on purpose. A derived table (`FROM (SELECT ...) t`) contributes
 * nothing, because there is nothing in the schema to look its columns up in,
 * and pretending otherwise would offer a list that is confidently wrong.
 */
export function tableRefs(sql: string): TableRef[] {
  const refs: TableRef[] = []
  let i = 0

  while (i < sql.length) {
    const skipped = skipLiteral(sql, i)
    if (skipped > i) {
      i = skipped
      continue
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i))
    if (!word) {
      i++
      continue
    }
    const kw = word[0].toLowerCase()
    i += word[0].length
    // FROM and JOIN introduce one; UPDATE and INTO name their target directly.
    if (kw !== 'from' && kw !== 'join' && kw !== 'update' && kw !== 'into') continue

    // `FROM a, b, c` is one clause naming three tables, so a comma keeps
    // reading — an implicit join is still a join, and a query written that way
    // needs its aliases resolved like any other.
    for (;;) {
      const read = readTableRef(sql, nextToken(sql, i))
      if (!read) break
      refs.push(read.ref)
      i = read.end
      const after = nextToken(sql, i)
      if (sql[after] !== ',') break
      i = after + 1
    }
  }

  return refs
}

/** One `schema.table AS alias` at `i`, and where it ended. Null when what is
 *  there is a keyword or a parenthesis — a derived table has no schema entry to
 *  look columns up in, and guessing at one would be confidently wrong. */
function readTableRef(sql: string, j: number): { ref: TableRef; end: number } | null {
  const first = readIdent(sql, j)
  if (!first || (sql[j] !== '"' && CLAUSE_WORDS.has(first.name.toLowerCase()))) return null

  let schema: string | null = null
  let table = first.name
  let end = first.end
  if (sql[end] === '.') {
    const second = readIdent(sql, end + 1)
    if (second) {
      schema = table
      table = second.name
      end = second.end
    }
  }

  // An alias, if the next word is one — `AS x`, or a bare `x` that is not the
  // start of the next clause.
  let alias: string | null = null
  let k = nextToken(sql, end)
  const maybeAs = readIdent(sql, k)
  if (maybeAs && sql[k] !== '"' && maybeAs.name.toLowerCase() === 'as') {
    k = nextToken(sql, maybeAs.end)
    const named = readIdent(sql, k)
    if (named) {
      alias = named.name
      k = named.end
    }
  } else if (maybeAs && (sql[k] === '"' || !CLAUSE_WORDS.has(maybeAs.name.toLowerCase()))) {
    alias = maybeAs.name
    k = maybeAs.end
  }

  return { ref: { schema, table, alias }, end: k }
}

/**
 * The `$n` parameters a statement uses, once each and in numeric order — the
 * inputs the run bar has to grow before this statement can be run at all.
 */
export function placeholders(sql: string): number[] {
  const found = new Set<number>()
  let i = 0
  while (i < sql.length) {
    const skipped = skipLiteral(sql, i)
    if (skipped > i) {
      i = skipped
      continue
    }
    if (sql[i] === '$') {
      const m = /^\$(\d+)/.exec(sql.slice(i))
      if (m) {
        found.add(Number(m[1]))
        i += m[0].length
        continue
      }
    }
    i++
  }
  return [...found].sort((a, b) => a - b)
}

/** Statements that only read. Everything not here is treated as a write, which
 *  is the safe direction to be wrong in: the cost of a needless transaction is
 *  a commit prompt, the cost of the reverse is a rejected statement. */
const READ_ONLY_LEADERS = new Set([
  'select', 'explain', 'show', 'table', 'values', 'analyze', 'analyse',
])

/** Keywords that make a statement a write wherever they appear at the top
 *  level — `WITH deleted AS (DELETE ... RETURNING *) SELECT * FROM deleted`
 *  reads like a SELECT and is not one. */
const WRITE_WORDS = new Set([
  'insert', 'update', 'delete', 'merge', 'create', 'drop', 'alter', 'truncate',
  'grant', 'revoke', 'comment', 'refresh', 'reindex', 'vacuum', 'call', 'do',
  'copy', 'import', 'cluster',
])

/**
 * Does this statement need the write path?
 *
 * Asked before every run, because write mode being on is not a reason to open a
 * write transaction for a `SELECT`. Somebody who armed the setting this morning
 * is still mostly reading, and a commit prompt after every query would train
 * them to click through it — which is the one habit this design exists to
 * prevent.
 *
 * The leading keyword decides it, with one exception: a `WITH` statement is
 * whatever its body does, and its body can be a DELETE.
 */
export function isWriteStatement(sql: string): boolean {
  const words: string[] = []
  let i = 0
  while (i < sql.length && words.length < 60) {
    const skipped = skipLiteral(sql, i)
    if (skipped > i) {
      i = skipped
      continue
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i))
    if (word) {
      words.push(word[0].toLowerCase())
      i += word[0].length
      continue
    }
    i++
  }
  const leader = words[0]
  if (!leader) return false
  if (leader === 'with') return words.some((w) => WRITE_WORDS.has(w))
  return !READ_ONLY_LEADERS.has(leader)
}
