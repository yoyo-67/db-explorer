import { resolveGroup, UNGROUPED } from '#/lib/schema-graph'
import type { TableCatalog } from '#/lib/types'

/**
 * The seam between the lens and the table browser (BUILD-SPEC §6). The lens is a
 * plugin, not a second app — its payoff is click-through — so both directions of
 * the seam are worked out here, once, and tested.
 */

export type LensView =
  | { kind: 'matrix' }
  | { kind: 'group'; group: string }
  | { kind: 'orphans' }

export interface LensLocation {
  schema: string
  view: LensView
}

/** Which schema the current URL is about, on either a table or a lens route. */
export function schemaFromPathname(pathname: string): string | undefined {
  const match = pathname.match(/^\/(?:t|lens)\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : undefined
}

export function parseLensPath(pathname: string): LensLocation | null {
  const match = pathname.match(/^\/lens\/([^/]+)(?:\/(.*))?$/)
  if (!match) return null
  const schema = decodeURIComponent(match[1])
  const rest = match[2] ?? ''
  if (rest === '' || rest === '/') return { schema, view: { kind: 'matrix' } }
  if (rest.replace(/\/$/, '') === 'orphans') return { schema, view: { kind: 'orphans' } }
  const group = rest.match(/^g\/([^/]+)\/?$/)
  if (group) {
    return { schema, view: { kind: 'group', group: decodeURIComponent(group[1]) } }
  }
  return { schema, view: { kind: 'matrix' } }
}

/**
 * Where "show in lens" goes for one table: its Group, focused on the table.
 *
 * The catalog alone answers this for 317 of 337 tables, and the historical
 * inheritance rule covers the generated `data_historical*` ones — enough to avoid
 * making the table page pay for the whole-schema graph fetch. Anything the catalog
 * cannot place lands on the matrix instead of a Group that would be empty.
 */
/** A table lands in a Group or, failing that, on the matrix — never on orphans. */
export type LensTableTarget = { kind: 'matrix' } | { kind: 'group'; group: string }

export function lensTargetForTable(
  table: string,
  catalog: TableCatalog | undefined,
): LensTableTarget {
  const curated = new Map<string, string>()
  for (const g of catalog?.groups ?? []) {
    for (const t of g.tables) curated.set(t, g.name)
  }
  const { group } = resolveGroup(table, curated, new Map())
  return group === UNGROUPED ? { kind: 'matrix' } : { kind: 'group', group }
}
