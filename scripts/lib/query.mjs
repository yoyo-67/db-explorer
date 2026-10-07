/**
 * The query CLI's parts: its arguments, the read-only session, and how a result
 * is printed. `scripts/query.mjs` wires them to a connection.
 *
 * Read-only is held the way the console holds it (`src/server/console.ts`), in
 * three layers: the session is opened with `default_transaction_read_only`, the
 * statement runs inside `BEGIN READ ONLY` and is rolled back whatever it did,
 * and it travels by the extended protocol, which refuses a second statement
 * after the first.
 */

const DEFAULTS = { preset: null, database: null, format: 'table', limit: 200, timeoutMs: 30_000 }

function positiveNumber(flag, value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} wants a positive number, got "${value}"`)
  return n
}

/** `[--preset NAME] [--database NAME] [--json|--csv] [--limit N] [--timeout SECONDS] SQL|-` */
export function parseQueryArgs(argv) {
  const out = { ...DEFAULTS, sql: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const next = argv[i + 1]
      if (next === undefined) throw new Error(`${arg} wants a value`)
      i += 1
      return next
    }
    if (arg === '--preset') out.preset = value()
    else if (arg === '--database') out.database = value()
    else if (arg === '--json') out.format = 'json'
    else if (arg === '--csv') out.format = 'csv'
    else if (arg === '--limit') out.limit = Math.floor(positiveNumber(arg, value()))
    else if (arg === '--timeout') out.timeoutMs = Math.round(positiveNumber(arg, value()) * 1000)
    else if (arg.startsWith('--')) throw new Error(`Unknown flag ${arg}`)
    else if (out.sql !== null) throw new Error('Pass one SQL statement (quote it), or - to read it from stdin')
    else out.sql = arg
  }
  if (out.sql === null) throw new Error('Pass the SQL to run, or - to read it from stdin')
  return { sql: out.sql, preset: out.preset, database: out.database, format: out.format, limit: out.limit, timeoutMs: out.timeoutMs }
}

/** The `options` startup parameter: every transaction read-only, every statement bounded. */
export function readOnlySessionOptions(timeoutMs) {
  return `-c default_transaction_read_only=on -c statement_timeout=${timeoutMs}`
}

/** One statement, read-only, rolled back whether it answered or failed. */
export async function runReadOnly(client, sql) {
  await client.query('BEGIN READ ONLY')
  try {
    // `queryMode`, not an empty `values`: pg sends that by the simple protocol, which runs `a; b` as two.
    return await client.query({ text: sql, values: [], queryMode: 'extended' })
  } finally {
    await client.query('ROLLBACK').catch(() => {})
  }
}

function cellText(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function csvCell(value) {
  const text = cellText(value)
  if (text === null) return ''
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** A result as a table (for reading), JSON (for programs) or CSV, cut at `limit` rows. */
export function formatResult(result, { format, limit }) {
  const fields = (result.fields ?? []).map((f) => f.name)
  const all = result.rows ?? []
  const rows = all.slice(0, limit)
  const truncated = all.length > rows.length

  if (format === 'json') {
    return JSON.stringify({ rowCount: all.length, truncated, rows }, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2)
  }
  if (fields.length === 0) return result.rowCount ? `${result.command} ${result.rowCount}` : (result.command ?? 'OK')
  if (format === 'csv') {
    return [fields.map(csvCell).join(','), ...rows.map((row) => fields.map((f) => csvCell(row[f])).join(','))].join('\n')
  }

  const cells = rows.map((row) => fields.map((f) => cellText(row[f]) ?? 'NULL'))
  const widths = fields.map((name, i) => Math.max(name.length, ...cells.map((row) => row[i].length)))
  const line = (values) => values.map((v, i) => v.padEnd(widths[i])).join(' | ').trimEnd()
  const footer = truncated
    ? `(${all.length} rows, first ${rows.length} shown; --limit to see more)`
    : `(${all.length} ${all.length === 1 ? 'row' : 'rows'})`
  return [line(fields), widths.map((w) => '-'.repeat(w)).join('-+-'), ...cells.map(line), footer].join('\n')
}
