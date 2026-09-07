/**
 * Table names surfaced on the palette's root page as you type.
 *
 * Deliberately not the fuzzy matcher the Tables page uses. On the root, table
 * rows sit next to commands and a pasted id, so a loose match is noise that
 * pushes the row you wanted off the list: `find` should not drag in
 * `data_frameinfo` because the letters happen to appear in order. The rule here
 * is contiguous — the query is a real run of characters in the name — which is
 * how people half-remember a table.
 *
 * Both names are matched: the Postgres identifier and the model behind it, since
 * the sidebar prints whichever the reader asked for and they will type the one
 * they see.
 */

export interface TableCandidate {
  name: string
  /** Model name from `schema-map.json`, when there is one. */
  model?: string | null
  rowCount?: number | null
}

/** Below this, a query matches too much to be worth showing next to commands. */
export const MIN_QUERY = 2

/** How many table rows the root will show, at most. */
export const MAX_MATCHES = 5

/**
 * Rank of a name against the query. Lower is better, `null` is not a match.
 *
 * The tiers are what "high confidence" means: the whole name, then the start of
 * it, then the start of a word inside it (`user` in `data_bduserroleassignment`
 * reads as a word because `_` and case changes mark one), then anywhere.
 */
export function matchRank(name: string, query: string): number | null {
  const haystack = name.toLowerCase()
  const needle = query.toLowerCase()
  if (haystack === needle) return 0
  if (haystack.startsWith(needle)) return 1
  const index = haystack.indexOf(needle)
  if (index === -1) return null
  const before = name[index - 1]
  const atWordStart =
    before === '_' ||
    before === '.' ||
    // `BDUserRoleAssignment` — a capital starts a word wherever it sits, which
    // is how the model names the sidebar prints are spelled.
    /[A-Z]/.test(name[index] ?? '')
  return atWordStart ? 2 : 3
}

/**
 * The tables worth showing for what has been typed, best first.
 *
 * Anything-anywhere matches (rank 3) are kept only when nothing better exists,
 * so a query that has a real prefix hit never shows a mid-word coincidence
 * underneath it.
 */
export function confidentTableMatches<T extends TableCandidate>(
  tables: readonly T[],
  query: string,
  limit: number = MAX_MATCHES,
): T[] {
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY) return []

  const ranked: { table: T; rank: number }[] = []
  for (const table of tables) {
    const byName = matchRank(table.name, trimmed)
    const byModel = table.model ? matchRank(table.model, trimmed) : null
    const rank =
      byName === null ? byModel : byModel === null ? byName : Math.min(byName, byModel)
    if (rank !== null) ranked.push({ table, rank })
  }
  if (ranked.length === 0) return []

  const best = Math.min(...ranked.map((hit) => hit.rank))
  // One tier only when the best tier is a real one: a prefix hit and a mid-word
  // coincidence are not the same kind of answer, and mixing them is the noise.
  const tier = best < 3 ? ranked.filter((hit) => hit.rank < 3) : ranked

  return tier
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank
      // Then the bigger table: of two plausible names, the one with rows in it
      // is the one being looked for.
      const rows = (right.table.rowCount ?? 0) - (left.table.rowCount ?? 0)
      if (rows !== 0) return rows
      return left.table.name.localeCompare(right.table.name)
    })
    .slice(0, limit)
    .map((hit) => hit.table)
}
