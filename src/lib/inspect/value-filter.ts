/**
 * Turn a value the profile is showing into an input for the table page's filter
 * DSL (`lib/filter-dsl.ts`), so clicking a common value narrows the rows to it.
 *
 * Always the exact form (`=value`), never the bare one: bare input means
 * substring ILIKE on text columns, and a facet click that also matched
 * `foo_bar` when you clicked `foo` would be lying about the share it showed.
 * Values that begin with a DSL operator are safe here for the same reason —
 * the leading `=` claims the parse.
 */
export function filterInputForValue(value: string | null): string {
  if (value === null) return 'null'
  return `=${value}`
}

/** Whether clicking this value can produce a filter at all — the DSL has no way
 *  to express an empty string, and `=` alone parses back to substring ILIKE. */
export function isFilterableValue(value: string | null): boolean {
  return value === null || value.trim().length > 0
}
