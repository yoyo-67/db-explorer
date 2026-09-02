/**
 * The inspector's tabs, in the order they are shown.
 *
 * `physical` is advanced: it answers a question about bytes rather than about
 * data, and most visits to a table are not about bytes. It stays behind a
 * preference so the common case shows two tabs rather than three — but a link to
 * it still opens it, whatever that preference says, because a link that lands on
 * nothing is worse than a tab somebody did not ask for.
 */
export const INSPECTOR_TABS = ['profile', 'ddl', 'physical'] as const

export type InspectorTab = (typeof INSPECTOR_TABS)[number]

/** Hidden unless the reader has turned advanced tabs on, or is linked straight to one. */
export const ADVANCED_INSPECTOR_TABS: readonly InspectorTab[] = ['physical']

export function isAdvancedTab(tab: InspectorTab): boolean {
  return ADVANCED_INSPECTOR_TABS.includes(tab)
}

/** The tabs to draw: the plain ones, plus any advanced one that is open or armed. */
export function visibleInspectorTabs(
  advanced: boolean,
  openTab?: InspectorTab,
): InspectorTab[] {
  return INSPECTOR_TABS.filter(
    (tab) => !isAdvancedTab(tab) || advanced || tab === openTab,
  )
}

export const INSPECTOR_TAB_LABELS: Record<InspectorTab, string> = {
  profile: 'Profile',
  ddl: 'DDL',
  physical: 'Physical',
}

/** One line on what the tab answers — shown next to the tabs, so the panel
 *  explains itself instead of relying on the reader knowing what "profile" means. */
export const INSPECTOR_TAB_HINTS: Record<InspectorTab, string> = {
  profile: 'nulls, distinct values and the common values of every column, from the last ANALYZE',
  ddl: 'the table as Postgres would write it — columns, constraints, indexes, comments — with enum labels and sequence headroom underneath',
  physical:
    'how wide a row is and what it wastes, where the bytes live, and the freeze clocks running on the table',
}

/** URL search params are untrusted input: anything else means "closed". */
export function parseInspectorTab(value: unknown): InspectorTab | undefined {
  return typeof value === 'string' && (INSPECTOR_TABS as readonly string[]).includes(value)
    ? (value as InspectorTab)
    : undefined
}

/**
 * Arrow-key movement within the tab list, wrapping at both ends. Moves through
 * the tabs actually on screen — stepping onto a hidden one would leave the
 * focus ring nowhere.
 */
export function nextInspectorTab(
  current: InspectorTab,
  delta: number,
  tabs: readonly InspectorTab[] = INSPECTOR_TABS,
): InspectorTab {
  const list = tabs.length > 0 ? tabs : INSPECTOR_TABS
  const index = list.indexOf(current)
  if (index === -1) return list[0]
  const count = list.length
  return list[(index + delta + count) % count]
}
