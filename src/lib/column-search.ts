import { MAX_MATCHES, confidentTableMatches } from '#/lib/palette/table-matches'
import type { EdgeBasis, SchemaGraph, SchemaGraphEdge, TableInfo } from '#/lib/types'

/**
 * Columns as a thing to search for, rather than something found by opening a
 * table first.
 *
 * The question people bring is "which table has `project_id`", or "every
 * `jsonb` column here". The answer is already on the client: introspection holds
 * every column, and the merged graph holds what each one references. The one
 * extra read, the facets, adds what the catalog knows about indexes, statistics
 * and comments. This module joins the three and does the searching. It fetches
 * nothing.
 */

export interface ColumnReference {
  toTable: string
  toColumn: string
  basis: EdgeBasis
}

/** What the catalog knows about one column, beyond its name and type. */
export interface ColumnFacet {
  /** Leads some index, appears later in one, or in none. */
  index: 'lead' | 'member' | null
  /** Share of rows that are null, from the last ANALYZE. `null` means no stats, never "none". */
  nullFrac: number | null
  /** `pg_stats.n_distinct` as stored. Resolve with `estimateDistinct`. */
  nDistinctRaw: number | null
  comment: string | null
}

export interface ColumnFacets {
  /** Keyed by {@link facetKey}. */
  columns: Record<string, ColumnFacet>
  /** Per table, the later of the manual and auto ANALYZE, ISO. */
  analyzedAt: Record<string, string | null>
}

export interface ColumnEntry {
  table: string
  column: string
  dataType: string
  isNullable: boolean
  rowCount: number | null
  group: string | null
  model: string | null
  reference: ColumnReference | null
  /** `null` when the facets have not arrived, failed, or did not mention this column. */
  facet: ColumnFacet | null
}

export function facetKey(table: string, column: string): string {
  return `${table}.${column}`
}

/**
 * Strongest first. A column that is a declared FK and also matches a naming rule
 * is a declared FK. Showing the weaker basis beside it would say the schema is
 * less sure than it is.
 */
const BASIS_STRENGTH: Record<EdgeBasis, number> = {
  declared: 0,
  model: 1,
  convention: 2,
  catalog: 3,
}

function strongestEdges(edges: readonly SchemaGraphEdge[]): Map<string, SchemaGraphEdge> {
  const best = new Map<string, SchemaGraphEdge>()
  for (const edge of edges) {
    const key = facetKey(edge.fromTable, edge.fromColumn)
    const held = best.get(key)
    if (!held || BASIS_STRENGTH[edge.basis] < BASIS_STRENGTH[held.basis]) best.set(key, edge)
  }
  return best
}

/**
 * One entry per column, tables alphabetical and columns in table order. That
 * order is the tie-break every later sort falls back on, so two renders of the
 * same schema list the same rows the same way.
 */
export function buildColumnEntries(
  tables: readonly TableInfo[],
  graph: SchemaGraph | undefined,
  facets: ColumnFacets | undefined,
): ColumnEntry[] {
  const edges = strongestEdges(graph?.edges ?? [])
  const nodes = new Map((graph?.nodes ?? []).map((node) => [node.name, node]))
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name))

  const entries: ColumnEntry[] = []
  for (const table of sorted) {
    const node = nodes.get(table.name)
    for (const column of table.columns) {
      const key = facetKey(table.name, column.name)
      const edge = edges.get(key)
      entries.push({
        table: table.name,
        column: column.name,
        dataType: column.dataType,
        isNullable: column.isNullable,
        rowCount: table.rowCount ?? null,
        group: node?.group ?? null,
        model: node?.model ?? null,
        reference: edge
          ? { toTable: edge.toTable, toColumn: edge.toColumn, basis: edge.basis }
          : null,
        facet: facets?.columns[key] ?? null,
      })
    }
  }
  return entries
}

/**
 * Column hits for the palette root: the same confidence gate as table names,
 * applied to the column name, so a column is offered only when the typing
 * clearly meant it.
 *
 * `excludeTable` is the table on screen, whose columns the root already offers
 * as filters. Listing them twice would make the root read as two answers to one
 * question.
 */
export function confidentColumnMatches(
  entries: readonly ColumnEntry[],
  query: string,
  opts: { limit?: number; excludeTable?: string } = {},
): ColumnEntry[] {
  const candidates = entries
    .filter((entry) => entry.table !== opts.excludeTable)
    .map((entry) => ({ name: entry.column, rowCount: entry.rowCount, entry }))
  return confidentTableMatches(candidates, query, opts.limit ?? MAX_MATCHES).map(
    (hit) => hit.entry,
  )
}
