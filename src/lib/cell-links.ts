/**
 * Links out of the database, decided by what a cell holds.
 *
 * A foreign key says which row a value names; it cannot say that the same value
 * is also a page in some other tool — an account's id in an operations
 * dashboard, a step key in the app that shows it. That knowledge belongs to
 * whoever runs both, so it is written by hand, per connection, in
 *
 *   local/<connection>/cell-links.json   { "links": [CellLinkRule, ...] }
 *
 * A rule names a column (and, optionally, the database, schema and table it must
 * be in), an optional pattern the value has to match, and a URL template:
 * `{value}` is the cell, `{$1}`.. the pattern's groups, `{row.<column>}` another
 * cell of the same row. Every substitution is URL-encoded, and only http(s) URLs
 * are ever produced, so a rule cannot turn a cell into a script.
 */

export interface CellLinkRule {
  database?: string
  schema?: string
  table?: string
  column: string
  /** A regular expression the value must match; its groups are `{$1}`, `{$2}`.. */
  match?: string
  url: string
  /** What the link reads as. Defaults to the URL's host. */
  label?: string
}

export interface CellLinkFile {
  links: CellLinkRule[]
}

export interface CellLink {
  href: string
  label: string
}

export interface CellLocation {
  database: string
  schema: string
  table: string
  column: string
}

const PLACEHOLDER = /\{(value|\$\d+|row\.[^}]+)\}/g

/** Every link the rules give one cell, in the order the rules are written. */
export function cellLinksFor(
  rules: CellLinkRule[],
  at: CellLocation,
  value: unknown,
  row: Record<string, unknown>,
): CellLink[] {
  if (value === null || value === undefined) return []
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const links: CellLink[] = []
  for (const rule of rules) {
    if (rule.column !== at.column) continue
    if (rule.database !== undefined && rule.database !== at.database) continue
    if (rule.schema !== undefined && rule.schema !== at.schema) continue
    if (rule.table !== undefined && rule.table !== at.table) continue
    const groups = matchGroups(rule.match, text)
    if (!groups) continue
    const href = fill(rule.url, text, groups, row)
    if (!href) continue
    links.push({ href, label: rule.label ?? new URL(href).host })
  }
  return links
}

/** The pattern's groups (`[whole, $1, ...]`), `[text]` for no pattern, or null. */
function matchGroups(pattern: string | undefined, text: string): string[] | null {
  if (pattern === undefined) return [text]
  let re: RegExp
  try {
    re = new RegExp(pattern)
  } catch {
    return null
  }
  const found = re.exec(text)
  return found ? found.map((group) => group ?? '') : null
}

/** The URL with every placeholder filled, or null when one cannot be or it is not http(s). */
function fill(
  template: string,
  text: string,
  groups: string[],
  row: Record<string, unknown>,
): string | null {
  let missing = false
  const href = template.replace(PLACEHOLDER, (_, name: string) => {
    let raw: unknown
    if (name === 'value') raw = text
    else if (name.startsWith('$')) raw = groups[Number(name.slice(1))]
    else raw = row[name.slice('row.'.length)]
    if (raw === null || raw === undefined) {
      missing = true
      return ''
    }
    return encodeURIComponent(typeof raw === 'object' ? JSON.stringify(raw) : String(raw))
  })
  if (missing) return null
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
