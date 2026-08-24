/**
 * Fuzzy text matching, deliberately free of any caller's data shape.
 *
 * One thing knows how to match — `fuzzyMatch` — and one thing lifts it over a
 * list through a text accessor. Anything with a name (values, tables, columns,
 * groups, indexes) can be searched by handing over that accessor, so a second
 * consumer never has to re-derive the scoring or the highlight spans.
 */

/** Half-open `[start, end)` character span of the text that matched. */
export type MatchRange = readonly [number, number]

export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches of the same query. */
  score: number
  /** Merged spans of matched characters, for highlighting. */
  ranges: MatchRange[]
}

export interface FuzzyHit<T> extends FuzzyMatch {
  item: T
}

/** Characters after which a match reads as the start of a word. */
const BOUNDARIES = new Set([' ', '_', '-', '.', '/', ':', ',', '(', '[', '@'])

const ADJACENT_BONUS = 8
const BOUNDARY_BONUS = 6
const CHAR_SCORE = 1
/** Tie-break only: of two texts matched the same way, the tighter one wins. */
const LENGTH_PENALTY = 0.05

/**
 * Whether `query`'s characters appear in `text` in order — as a run, or spread
 * out with anything in between — and how well.
 *
 * Matching is greedy from the left, which always finds a match when one exists
 * but does not hunt for the highest-scoring arrangement of it. That is the trade
 * for staying linear: an interactive picker re-runs this on every keystroke.
 *
 * Returns `null` when the query does not match at all. An empty query matches
 * everything with nothing highlighted, so it can drive an unfiltered list.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return { score: 0, ranges: [] }

  const haystack = text.toLowerCase()
  const ranges: MatchRange[] = []
  let score = 0
  let at = 0
  let previous = -2

  for (const char of needle) {
    const found = haystack.indexOf(char, at)
    if (found === -1) return null

    const adjacent = found === previous + 1
    score += adjacent ? ADJACENT_BONUS : CHAR_SCORE
    if (found === 0 || BOUNDARIES.has(haystack[found - 1])) score += BOUNDARY_BONUS

    if (adjacent) {
      const last = ranges[ranges.length - 1]
      ranges[ranges.length - 1] = [last[0], found + 1]
    } else {
      ranges.push([found, found + 1])
    }

    previous = found
    at = found + 1
  }

  // Earlier matches read as more relevant, and so do tighter texts — but both
  // are tie-breaks, never enough to outrank a genuinely better arrangement.
  score -= ranges[0][0]
  score -= (text.length - needle.length) * LENGTH_PENALTY
  return { score, ranges }
}

/**
 * The items whose text matches, best first.
 *
 * `textOf` is the whole seam: pass one for any shape. Ties keep the caller's
 * order, so an empty query hands the list back untouched.
 */
export function fuzzySearch<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
): FuzzyHit<T>[] {
  const hits: FuzzyHit<T>[] = []
  for (const item of items) {
    const match = fuzzyMatch(textOf(item), query)
    if (match) hits.push({ item, ...match })
  }
  return hits.sort((a, b) => b.score - a.score)
}
