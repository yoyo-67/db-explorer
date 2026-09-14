/**
 * Table names surfaced on the palette's root page as you type.
 *
 * A contiguous run of the name wins — that is how people half-remember a table —
 * but a query typed as pieces of it (`constpro` for `ConstructionProject`) is
 * the same act of remembering, so a spread-out match is offered underneath.
 *
 * What keeps the root from filling with coincidences is the share of the query
 * that lands in real runs ({@link MIN_RUN_SHARE}), not the shape of the match:
 * `constpro` is two runs covering every character typed, where `find` scattered
 * one letter at a time across `data_frameinfo` covers almost none. The Tables
 * page has no such gate — nothing but tables is on it — which is why the same
 * query can find more there than here.
 *
 * Both names are matched: the Postgres identifier and the model behind it, since
 * the sidebar prints whichever the reader asked for and they will type the one
 * they see.
 */

import { fuzzyMatch } from '#/lib/fuzzy'

export interface TableCandidate {
  name: string
  /** Model name from `schema-map.json`, when there is one. */
  model?: string | null
  rowCount?: number | null
}

/**
 * How much of the query a spread-out match must cover in runs of two or more
 * characters before it is offered.
 *
 * Two thirds, because that is the line between typing a name in pieces and the
 * letters merely being present: `cproj` in `data_constructionproject` is `c`
 * plus `proj` — four fifths — where `find` in `data_frameinfo` is single letters
 * hunted down one at a time.
 */
export const MIN_RUN_SHARE = 0.6

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
 * Rank of a name whose characters appear in order but not as one run — the tier
 * under every contiguous match. `null` when it does not match at all, or when
 * too little of the query landed in runs to be worth offering.
 */
export function looseRank(name: string, query: string): number | null {
  const needle = query.trim()
  if (needle.length === 0) return null
  const match = fuzzyMatch(name, needle)
  if (!match) return null
  const inRuns = match.ranges.reduce(
    (total, [start, end]) => (end - start >= 2 ? total + (end - start) : total),
    0,
  )
  return inRuns / needle.length >= MIN_RUN_SHARE ? 4 : null
}

/**
 * The best rank either of a table's two names earns, and how tightly the query
 * sat in it. The score orders the pieced tier, where every row matched the same
 * way and only the arrangement separates them — `constpro` sits tighter in
 * `constructionproject` than in `constructionerrorprioritychangelog`.
 */
function rankFor(
  candidate: TableCandidate,
  query: string,
): { rank: number; score: number } | null {
  const ranks = [
    matchRank(candidate.name, query),
    candidate.model ? matchRank(candidate.model, query) : null,
    looseRank(candidate.name, query),
    candidate.model ? looseRank(candidate.model, query) : null,
  ].filter((rank): rank is number => rank !== null)
  if (ranks.length === 0) return null
  const scores = [
    fuzzyMatch(candidate.name, query)?.score,
    candidate.model ? fuzzyMatch(candidate.model, query)?.score : undefined,
  ].filter((score): score is number => score !== undefined)
  return { rank: Math.min(...ranks), score: scores.length === 0 ? 0 : Math.max(...scores) }
}

/**
 * The tables worth showing for what has been typed, best first.
 *
 * One tier at a time: the weaker kinds of match — a mid-word substring, a name
 * typed in pieces — are shown only when nothing better matched, so a query with
 * a real prefix hit never has coincidences stacked under it.
 */
export function confidentTableMatches<T extends TableCandidate>(
  tables: readonly T[],
  query: string,
  limit: number = MAX_MATCHES,
): T[] {
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY) return []

  const ranked: { table: T; rank: number; score: number }[] = []
  for (const table of tables) {
    const hit = rankFor(table, trimmed)
    if (hit !== null) ranked.push({ table, ...hit })
  }
  if (ranked.length === 0) return []

  const best = Math.min(...ranked.map((hit) => hit.rank))
  // One tier only when the best tier is a real one: a prefix hit, a mid-word
  // coincidence and a name typed in pieces are not the same kind of answer, and
  // mixing them is the noise.
  const tier =
    best < 3 ? ranked.filter((hit) => hit.rank < 3) : ranked.filter((hit) => hit.rank === best)

  return tier
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank
      // Inside the pieced tier, the tighter arrangement of the same letters.
      // The contiguous tiers are left alone: there the match is the same shape
      // in every row, and row count is the more useful thing to sort by.
      if (left.rank === 4 && left.score !== right.score) return right.score - left.score
      // Then the bigger table: of two plausible names, the one with rows in it
      // is the one being looked for.
      const rows = (right.table.rowCount ?? 0) - (left.table.rowCount ?? 0)
      if (rows !== 0) return rows
      return left.table.name.localeCompare(right.table.name)
    })
    .slice(0, limit)
    .map((hit) => hit.table)
}
