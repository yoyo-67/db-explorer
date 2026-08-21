import type { Condition } from '#/lib/filter-model'

/**
 * Turn a value the profile is showing into a filter condition, so clicking a
 * common value narrows the rows to it.
 *
 * Always equality, never a substring match: a facet click that also matched
 * `foo_bar` when you clicked `foo` would be lying about the share it showed.
 *
 * The id is the column, not a fresh one per click — clicking a second value in
 * the same column replaces that column's condition rather than stacking a
 * second one that can match nothing.
 */
export function conditionForValue(column: string, value: string | null): Condition {
  const id = `inspect-${column}`
  if (value === null) return { id, column, op: 'isNull', values: [] }
  return { id, column, op: 'eq', values: [value] }
}

/** Whether clicking this value can produce a filter at all — an empty string is
 *  indistinguishable from an unset value box, so it stays unclickable. */
export function isFilterableValue(value: string | null): boolean {
  return value === null || value.trim().length > 0
}
