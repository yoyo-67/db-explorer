import { encodeInFilter, parsePredicate } from '#/lib/filter-dsl'

/**
 * The checkbox side of a column filter: turning the one string a column carries
 * (`lib/filter-dsl.ts`) into "is this value ticked?", and a tick into the next
 * string. The list of values itself comes from the server (`getColumnValues`).
 *
 * No filter means every value is ticked, the way a grid with no filter shows
 * every row. So the first uncheck has to name everything else — which is why
 * these take the value list rather than only the current input.
 */

export function isValueSelected(input: string, value: string | null): boolean {
  const predicate = parsePredicate(input)
  // An empty filter selects everything; any other predicate is one the picker
  // cannot render as ticks, so it shows none rather than guessing.
  if (!predicate) return true
  if (predicate.kind !== 'in') return false
  return value === null ? predicate.hasNull : predicate.values.includes(value)
}

/**
 * The filter input after ticking or unticking one value. Returns the empty
 * string — no filter — both when everything ends up selected and when nothing
 * does: the DSL cannot express the empty set, and a grid showing no rows with
 * no way back is worse than one showing all of them.
 */
export function toggleValue(
  input: string,
  allValues: (string | null)[],
  value: string | null,
): string {
  const predicate = parsePredicate(input)
  const selected = new Set<string | null>(
    predicate === null
      ? allValues
      : predicate.kind === 'in'
        ? [...predicate.values, ...(predicate.hasNull ? [null] : [])]
        : // A text filter is not a selection: the click starts one from nothing.
          [],
  )

  if (selected.has(value)) selected.delete(value)
  else selected.add(value)

  if (selected.size === 0) return ''
  if (selected.size === allValues.length && allValues.every((v) => selected.has(v))) return ''
  // Keep the server's ordering, so the same selection always encodes the same way.
  return encodeInFilter(allValues.filter((v) => selected.has(v)))
}

/** Everything ticked is the absence of a filter, not a list of every value. */
export function selectAllInput(): string {
  return ''
}

/** Substring match for the picker's own search box. The null member answers to
 *  "null", which is what it is called on screen. */
export function matchesValueSearch(value: string | null, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  const haystack = value === null ? 'null' : value.toLowerCase()
  return haystack.includes(needle)
}
