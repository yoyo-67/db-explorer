import type { ColumnInfo, RelatedField } from '#/lib/types'

/**
 * Which columns of a table read as a name.
 *
 * One list, two consumers: the row inspector labels a row it already has
 * (`row-label.ts`), and the filter picker offers these as the fields to search
 * a *referenced* table by. Both answer the same question — "what does a human
 * call this row?" — so the order lives here rather than in either of them.
 */
export const LABEL_FIELDS = [
  'name',
  'title',
  'label',
  'display_name',
  'email',
  'username',
  'slug',
  'code',
  'key',
  'description',
] as const

/** Types worth searching by name. Keys and timestamps are not names. */
const SEARCHABLE_TYPES = new Set([
  'text',
  'character varying',
  'character',
  'citext',
  'name',
])

/** More buttons than this is a column list, not a choice. */
const MAX_FIELDS = 6

export function isSearchableType(dataType: string): boolean {
  return SEARCHABLE_TYPES.has(dataType.toLowerCase())
}

/**
 * The searchable columns of a table, the name-ish ones first and in the order
 * above, then whatever other text columns exist in their own order.
 *
 * Capped, because these are drawn as buttons: a table with thirty text columns
 * would otherwise bury the picker it is meant to sit above.
 */
export function labelFieldsFor(columns: readonly ColumnInfo[]): RelatedField[] {
  const searchable = columns.filter((c) => isSearchableType(c.dataType))
  const rank = (name: string) => {
    const at = LABEL_FIELDS.indexOf(name.toLowerCase() as (typeof LABEL_FIELDS)[number])
    return at === -1 ? LABEL_FIELDS.length : at
  }
  return searchable
    .map((c, order) => ({ field: { name: c.name, dataType: c.dataType }, order }))
    .sort((a, b) => {
      const byRank = rank(a.field.name) - rank(b.field.name)
      return byRank !== 0 ? byRank : a.order - b.order
    })
    .slice(0, MAX_FIELDS)
    .map((entry) => entry.field)
}
