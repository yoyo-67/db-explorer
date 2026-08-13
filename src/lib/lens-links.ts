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
 * Same precedence as the graph — catalog, then the historical inheritance rule,
 * then the Django module group from the map. Skipping that last source is what
 * used to dump ~20 module-grouped tables on the matrix while the lens itself was
 * happily drawing them inside a Group. Two small JSON reads, so the table page
 * still never pays for the whole-schema graph fetch.
 */
/** A table lands in a Group or, failing that, on the matrix — never on orphans. */
export type LensTableTarget = { kind: 'matrix' } | { kind: 'group'; group: string }

export function lensTargetForTable(
  table: string,
  catalog: TableCatalog | undefined,
  mapGroups?: Readonly<Record<string, string>>,
): LensTableTarget {
  const { group } = resolveGroup(
    table,
    curatedGroups(catalog),
    new Map(Object.entries(mapGroups ?? {})),
  )
  return group === UNGROUPED ? { kind: 'matrix' } : { kind: 'group', group }
}

/** Table → curated Group, flattened out of the catalog's group-major shape. */
export function curatedGroups(catalog: TableCatalog | undefined): Map<string, string> {
  const curated = new Map<string, string>()
  for (const g of catalog?.groups ?? []) {
    for (const t of g.tables) curated.set(t, g.name)
  }
  return curated
}
