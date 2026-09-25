import { MAX_MATCHES, confidentTableMatches, matchRank } from '#/lib/palette/table-matches'
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

export type RefFilter = 'any' | 'none' | EdgeBasis
export type IndexFilter = 'lead' | 'any' | 'none'

/**
 * The survey page's URL state. Every filter lives here so a finding ("these are
 * the unindexed reference columns") is a link someone else can open.
 */
export interface ColumnSearch {
  q?: string
  type?: string[]
  ref?: RefFilter
  indexed?: IndexFilter
  nullable?: true
}

const REF_FILTERS = new Set<string>(['any', 'none', 'declared', 'model', 'convention', 'catalog'])
const INDEX_FILTERS = new Set<string>(['lead', 'any', 'none'])

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read the search params, dropping whatever doesn't parse. A hand-edited URL
 * should land on a wider list, never on an error page or an empty one.
 */
export function validateColumnSearch(search: Record<string, unknown>): ColumnSearch {
  const result: ColumnSearch = {}
  const q = nonEmptyText(search.q)
  if (q) result.q = q

  const rawTypes = Array.isArray(search.type) ? search.type : [search.type]
  const types = rawTypes.filter((t): t is string => typeof t === 'string' && t.length > 0)
  if (types.length > 0) result.type = types

  if (typeof search.ref === 'string' && REF_FILTERS.has(search.ref)) {
    result.ref = search.ref as RefFilter
  }
  if (typeof search.indexed === 'string' && INDEX_FILTERS.has(search.indexed)) {
    result.indexed = search.indexed as IndexFilter
  }
  if (search.nullable === true || search.nullable === 'true') result.nullable = true
  return result
}

function matchesRef(entry: ColumnEntry, ref: RefFilter): boolean {
  if (ref === 'any') return entry.reference !== null
  if (ref === 'none') return entry.reference === null
  return entry.reference?.basis === ref
}

/**
 * Only a facet that was read can say "in no index". Missing facets mean the
 * read failed or hasn't landed, and those rows are left out of `none` rather
 * than claimed as unindexed.
 */
function matchesIndex(entry: ColumnEntry, indexed: IndexFilter): boolean {
  if (!entry.facet) return false
  if (indexed === 'lead') return entry.facet.index === 'lead'
  if (indexed === 'any') return entry.facet.index !== null
  return entry.facet.index === null
}

/**
 * The survey list. No confidence gate: this page exists to show every match.
 * But it keeps the tiers, so whole-name hits sit above a word inside a longer
 * name. Inside a tier, entries keep the table-then-column order
 * {@link buildColumnEntries} gave them.
 */
export function searchColumns(
  entries: readonly ColumnEntry[],
  search: ColumnSearch,
): ColumnEntry[] {
  const types = search.type ? new Set(search.type) : null
  const q = search.q?.trim() ?? ''

  const ranked: { entry: ColumnEntry; rank: number; order: number }[] = []
  entries.forEach((entry, order) => {
    if (types && !types.has(entry.dataType)) return
    if (search.ref && !matchesRef(entry, search.ref)) return
    if (search.indexed && !matchesIndex(entry, search.indexed)) return
    if (search.nullable && !entry.isNullable) return
    const rank = q.length === 0 ? 0 : matchRank(entry.column, q)
    if (rank === null) return
    ranked.push({ entry, rank, order })
  })

  return ranked
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((hit) => hit.entry)
}

/** The type chips: only types this schema actually uses. */
export function typesPresent(entries: readonly ColumnEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.dataType))].sort((a, b) => a.localeCompare(b))
}

/**
 * A reference column that no index leads. Following that relation from the
 * referenced side reads the whole table. A column later in a composite index
 * cannot serve that lookup alone, so it counts too. Unknown facets are not
 * flagged: this is a claim about the schema, made only when the catalog said so.
 */
export function isUnindexedReference(entry: ColumnEntry): boolean {
  return entry.reference !== null && entry.facet !== null && entry.facet.index !== 'lead'
}
