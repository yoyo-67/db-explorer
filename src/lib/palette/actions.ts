import { fuzzySearch } from '#/lib/fuzzy'
import { planValue } from '#/lib/find/value-shape'
import type { PaletteView } from '#/lib/palette/views'

/**
 * What the palette's root page offers, and how typing narrows it.
 *
 * Two kinds of row, because there are two kinds of thing to do: *push* opens
 * another palette page (a list of tables, the owners of an id), *route* leaves
 * the palette for a page of the app. Both are described as data — the route is
 * named, not built — so this module stays pure and the one place that knows how
 * to navigate is the component that has the router.
 */

/** The routes the palette can reach. Named, so the mapping to typed router
 *  calls stays in one component instead of stringly-typed all over. */
export type PaletteRoute =
  | 'tables'
  | 'console'
  | 'lens'
  | 'find'
  | 'pressure'
  | 'indexes'
  | 'queries'
  | 'flows'
  | 'help'
  | 'settings'

export type PaletteTarget =
  | { kind: 'push'; view: PaletteView; query?: string }
  | { kind: 'route'; route: PaletteRoute }

export interface PaletteAction {
  id: string
  title: string
  /** One line under the title: what the row does, not what it is called. */
  hint: string
  /** Heading the row sits under. */
  group: string
  target: PaletteTarget
  /** Extra words the fuzzy match should see — how people ask for the thing. */
  keywords?: string[]
}

export interface PaletteContext {
  /** Absent on the pages that are about no database — connect, help, settings. */
  database?: string
  schema?: string
}

/**
 * The root list. Actions that need a database are left out entirely when there
 * is none rather than shown disabled: a palette full of dead rows on the connect
 * screen teaches the reader to ignore it.
 */
export function rootActions(context: PaletteContext): PaletteAction[] {
  const actions: PaletteAction[] = []
  const scoped = Boolean(context.database)

  if (scoped) {
    actions.push({
      id: 'find',
      title: 'Find a value',
      hint: 'Paste an id — which table owns it, and what else holds it',
      group: 'Find',
      target: { kind: 'push', view: { kind: 'find' } },
      keywords: ['uuid', 'id', 'search', 'value', 'where'],
    })
    actions.push({
      id: 'tables',
      title: 'Go to table',
      hint: 'Every table in this schema, by name',
      group: 'Navigate',
      target: { kind: 'push', view: { kind: 'tables' } },
      keywords: ['open', 'browse', 'rows'],
    })
    actions.push({
      id: 'console',
      title: 'SQL console',
      hint: 'Run a statement in a read-only transaction',
      group: 'Navigate',
      target: { kind: 'route', route: 'console' },
      keywords: ['query', 'sql', 'run'],
    })
  }

  if (scoped && context.schema) {
    actions.push({
      id: 'lens',
      title: 'Schema lens',
      hint: 'How this schema is shaped — Group crossings and boundaries',
      group: 'Navigate',
      target: { kind: 'route', route: 'lens' },
      keywords: ['graph', 'architecture', 'diagram'],
    })
    actions.push({
      id: 'pressure',
      title: 'Schema pressure',
      hint: 'Unread indexes, disk, vacuum debt, sequences running out',
      group: 'Inspect',
      target: { kind: 'route', route: 'pressure' },
      keywords: ['vacuum', 'bloat', 'size', 'sequence'],
    })
    actions.push({
      id: 'indexes',
      title: 'Indexes',
      hint: 'What each index costs, and what the counters say it serves',
      group: 'Inspect',
      target: { kind: 'route', route: 'indexes' },
      keywords: ['index', 'scans', 'usage'],
    })
  }

  if (scoped) {
    actions.push({
      id: 'queries',
      title: 'Query board',
      hint: 'What this database spends its time running',
      group: 'Inspect',
      target: { kind: 'route', route: 'queries' },
      keywords: ['pg_stat_statements', 'slow', 'time'],
    })
  }

  actions.push({
    id: 'flows',
    title: 'Flows',
    hint: 'Captured walks through the data, with their queries attached',
    group: 'Pages',
    target: { kind: 'route', route: 'flows' },
    keywords: ['doc', 'investigation'],
  })
  actions.push({
    id: 'help',
    title: 'Help',
    hint: 'What each page asks the database, clause by clause',
    group: 'Pages',
    target: { kind: 'route', route: 'help' },
    keywords: ['docs', 'explain'],
  })
  actions.push({
    id: 'settings',
    title: 'Settings',
    hint: 'Theme, text size, statement timeout, edit mode',
    group: 'Pages',
    target: { kind: 'route', route: 'settings' },
    keywords: ['theme', 'timeout', 'preferences'],
  })

  return actions
}

/** Everything the fuzzy matcher should see for one row. */
function haystack(action: PaletteAction): string {
  return [action.title, ...(action.keywords ?? [])].join(' ')
}

export function filterActions(
  actions: readonly PaletteAction[],
  query: string,
): PaletteAction[] {
  if (query.trim().length === 0) return [...actions]
  return fuzzySearch(actions, query, haystack).map((hit) => hit.item)
}

/**
 * The row that appears at the top of the root when what has been typed looks
 * like a value rather than a command.
 *
 * This is the whole reason the palette exists on a chord: an id is pasted, not
 * typed, and the reader should not have to first choose "Find a value" and then
 * paste it again.
 *
 * A bare integer gets this row too, and says so. Find will gate it — `4271` is
 * a key in nearly every table — but the gate *is* the next step: it comes with
 * every key that could hold the value, and picking one is a click. Offering no
 * row at all was worse than offering the gate, because the reader had pasted an
 * id and the palette appeared to have nothing to say about it.
 *
 * A short unstructured word still gets nothing: `alice` is far more likely to be
 * someone typing towards a command than an id, and Find could not do anything
 * with it either.
 */
export function pasteAction(query: string, context: PaletteContext): PaletteAction | null {
  if (!context.database) return null
  const plan = planValue(query)
  if (plan.value.length === 0) return null
  if (plan.gateReason === 'too-short') return null
  return {
    id: `paste:${plan.value}`,
    title: `Find ${plan.value}`,
    hint:
      plan.gateReason === 'ambiguous-integer'
        ? 'An id this shape is a key in nearly every table — pick which one it is from'
        : `Which table's key holds this ${plan.shape}, and what else references it`,
    group: 'Find',
    target: { kind: 'push', view: { kind: 'find' }, query: plan.value },
  }
}

/** The rows, in the order they are shown: what was pasted first, then commands. */
export function rootRows(
  context: PaletteContext,
  query: string,
): PaletteAction[] {
  const pasted = pasteAction(query, context)
  const matched = filterActions(rootActions(context), query)
  return pasted ? [pasted, ...matched] : matched
}

/** Rows grouped for rendering, in first-appearance order. */
export function byGroup(actions: readonly PaletteAction[]): [string, PaletteAction[]][] {
  const groups = new Map<string, PaletteAction[]>()
  for (const action of actions) {
    const bucket = groups.get(action.group)
    if (bucket) bucket.push(action)
    else groups.set(action.group, [action])
  }
  return [...groups.entries()]
}
