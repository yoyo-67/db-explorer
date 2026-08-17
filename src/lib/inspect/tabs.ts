/** The inspector's tabs, in the order they are shown. */
export const INSPECTOR_TABS = ['profile', 'ddl', 'types'] as const

export type InspectorTab = (typeof INSPECTOR_TABS)[number]

export const INSPECTOR_TAB_LABELS: Record<InspectorTab, string> = {
  profile: 'Profile',
  ddl: 'DDL',
  types: 'Types',
}

/** One line on what the tab answers — shown next to the tabs, so the panel
 *  explains itself instead of relying on the reader knowing what "profile" means. */
export const INSPECTOR_TAB_HINTS: Record<InspectorTab, string> = {
  profile: 'nulls, distinct values and the common values of every column, from the last ANALYZE',
  ddl: 'the table as Postgres would write it: columns, constraints, indexes, comments',
  types: 'enum labels, and how much room each sequence has left',
}

/** URL search params are untrusted input: anything else means "closed". */
export function parseInspectorTab(value: unknown): InspectorTab | undefined {
  return typeof value === 'string' && (INSPECTOR_TABS as readonly string[]).includes(value)
    ? (value as InspectorTab)
    : undefined
}

/** Arrow-key movement within the tab list, wrapping at both ends. */
export function nextInspectorTab(current: InspectorTab, delta: number): InspectorTab {
  const index = INSPECTOR_TABS.indexOf(current)
  const count = INSPECTOR_TABS.length
  return INSPECTOR_TABS[(index + delta + count) % count]
}
