import type {
  EdgeBasis,
  NodeKind,
  SchemaGraph,
  SchemaGraphEdge,
  SchemaGraphNode,
  SchemaGraphStaleness,
  SchemaMap,
  TableCatalog,
} from '#/lib/types'

/**
 * Merging the schema graph. Pure: the SQL and file reads live in
 * `src/server/functions.ts`, everything decided here is testable.
 *
 * Merge order (BUILD-SPEC §2.1) — live Postgres wins, then the Django map,
 * then name conventions, and only where the earlier source said nothing:
 *
 *   1. `information_schema` — nodes and `declared` edges
 *   2. `schema-map.json` — `model` edges, module groups
 *   3. `conventions.byColumn` — `convention` edges on still-unresolved columns
 *
 * Degrees are deliberately absent from the output: they are derived from the
 * edge list by `schema-graph-metrics.ts`, so there is one definition.
 */

export interface LiveColumn {
  name: string
  isNullable: boolean
}

export interface LiveTable {
  name: string
  schema: string
  kind: NodeKind
  rowCount: number
  lastModified: string | null
  columns: LiveColumn[]
  pkColumn: string | null
}

export interface DeclaredEdgeInput {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
}

export interface MergeInput {
  schema: string
  liveTables: LiveTable[]
  declaredEdges: DeclaredEdgeInput[]
  map: SchemaMap | null
  catalog: TableCatalog | null
  /** `table.column` for every leading index column in the schema. */
  indexedColumns: ReadonlySet<string>
}

export const UNGROUPED = 'Uncategorized'

/** `data_historicalvideo` → `data_video`, so history inherits its subject's Group. */
const HISTORICAL_PREFIX = 'data_historical'

/**
 * A column that looks like it points somewhere: `*_id` and not this table's own
 * primary key. The PK exclusion is what keeps `history_id` out — it is the PK of
 * every generated historical table, not a reference.
 */
export function isReferenceColumn(column: string, pkColumn: string | null): boolean {
  if (!column.endsWith('_id')) return false
  return column !== pkColumn
}

export function edgeKey(table: string, column: string): string {
  return `${table}.${column}`
}

/** declared beats model beats convention — the merge order, as a number. */
const BASIS_PRIORITY: Record<EdgeBasis, number> = {
  declared: 0,
  model: 1,
  convention: 2,
}

export interface CandidateEdge {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  basis: EdgeBasis
}

/**
 * One edge per source column, highest-priority basis winning. Shared by the
 * whole-schema merge and the per-row trace so the two can never disagree about
 * where a column points.
 */
export function resolveEdgesByColumn(
  candidates: readonly CandidateEdge[],
): Map<string, CandidateEdge> {
  const byColumn = new Map<string, CandidateEdge>()
  for (const c of candidates) {
    const key = edgeKey(c.fromTable, c.fromColumn)
    const existing = byColumn.get(key)
    if (!existing || BASIS_PRIORITY[c.basis] < BASIS_PRIORITY[existing.basis]) {
      byColumn.set(key, c)
    }
  }
  return byColumn
}

/** `"data_activity.id"` → `{ table, column }`; null when the target is malformed. */
export function parseConventionTarget(
  target: string,
): { table: string; column: string } | null {
  const dot = target.lastIndexOf('.')
  if (dot <= 0 || dot === target.length - 1) return null
  return { table: target.slice(0, dot), column: target.slice(dot + 1) }
}

/** The convention rule for a column, per-table rule first. */
export function conventionRuleFor(
  map: SchemaMap | null,
  table: string,
  column: string,
): { table: string; column: string } | null {
  const rule =
    map?.conventions.byTableColumn[edgeKey(table, column)] ??
    map?.conventions.byColumn[column]
  return rule ? parseConventionTarget(rule) : null
}

/**
 * Hand catalog → historical subject's group → Django module group (derived) →
 * `Uncategorized`. The last step should never fire; when it does the staleness
 * panel says so rather than the graph swallowing it.
 */
export function resolveGroup(
  table: string,
  catalogGroupByTable: ReadonlyMap<string, string>,
  mapGroupByTable: ReadonlyMap<string, string>,
): { group: string; groupIsDerived: boolean } {
  const curated = catalogGroupByTable.get(table)
  if (curated) return { group: curated, groupIsDerived: false }

  if (table.startsWith(HISTORICAL_PREFIX)) {
    const subject = `data_${table.slice(HISTORICAL_PREFIX.length)}`
    const inherited = catalogGroupByTable.get(subject)
    if (inherited) return { group: inherited, groupIsDerived: false }
  }

  const derived = mapGroupByTable.get(table)
  if (derived) return { group: derived, groupIsDerived: true }

  return { group: UNGROUPED, groupIsDerived: false }
}

export function mergeSchemaGraph(input: MergeInput): SchemaGraph {
  const { schema, liveTables, declaredEdges, map, catalog, indexedColumns } = input

  const liveByName = new Map(liveTables.map((t) => [t.name, t]))
  const nullableByColumn = new Map<string, boolean>()
  for (const t of liveTables) {
    for (const c of t.columns) nullableByColumn.set(edgeKey(t.name, c.name), c.isNullable)
  }

  const catalogGroupByTable = new Map<string, string>()
  for (const g of catalog?.groups ?? []) {
    for (const t of g.tables) catalogGroupByTable.set(t, g.name)
  }
  const mapGroupByTable = new Map<string, string>()
  for (const [table, meta] of Object.entries(map?.tables ?? {})) {
    if (meta.group) mapGroupByTable.set(table, meta.group)
  }

  /** Both endpoints and the source column have to still exist in the database. */
  const isDrawable = (e: CandidateEdge): boolean =>
    liveByName.has(e.fromTable) &&
    liveByName.has(e.toTable) &&
    nullableByColumn.has(edgeKey(e.fromTable, e.fromColumn))

  const candidates: CandidateEdge[] = []

  // 1. declared — the live constraint is the truth wherever it exists
  for (const e of declaredEdges) candidates.push({ ...e, basis: 'declared' })

  // 2. model — Django knows the target the constraint was stripped from
  for (const e of map?.edges ?? []) {
    if (e.basis !== 'model') continue
    candidates.push({ ...e, basis: 'model' })
  }

  // 3. convention — name rules; precedence drops these wherever 1 or 2 spoke
  for (const t of liveTables) {
    for (const c of t.columns) {
      if (!isReferenceColumn(c.name, t.pkColumn)) continue
      const target = conventionRuleFor(map, t.name, c.name)
      if (!target) continue
      candidates.push({
        fromTable: t.name,
        fromColumn: c.name,
        toTable: target.table,
        toColumn: target.column,
        basis: 'convention',
      })
    }
  }

  const edgesByColumn = new Map<string, SchemaGraphEdge>()
  for (const [key, c] of resolveEdgesByColumn(candidates.filter(isDrawable))) {
    edgesByColumn.set(key, {
      ...c,
      nullable: nullableByColumn.get(key) ?? true,
      indexed: indexedColumns.has(key),
    })
  }

  const edges = [...edgesByColumn.values()].sort(
    (a, b) =>
      a.fromTable.localeCompare(b.fromTable) || a.fromColumn.localeCompare(b.fromColumn),
  )

  const nodes: SchemaGraphNode[] = liveTables.map((t) => {
    const { group, groupIsDerived } = resolveGroup(
      t.name,
      catalogGroupByTable,
      mapGroupByTable,
    )
    let unresolved = 0
    for (const c of t.columns) {
      if (!isReferenceColumn(c.name, t.pkColumn)) continue
      if (!edgesByColumn.has(edgeKey(t.name, c.name))) unresolved++
    }
    return {
      name: t.name,
      schema: t.schema,
      group,
      groupIsDerived,
      kind: t.kind,
      rowCount: t.rowCount,
      lastModified: t.lastModified,
      unresolvedRefColumns: unresolved,
    }
  })

  return { schema, nodes, edges, staleness: buildStaleness(nodes, map, catalog) }
}

export function buildStaleness(
  nodes: readonly SchemaGraphNode[],
  map: SchemaMap | null,
  catalog: TableCatalog | null,
): SchemaGraphStaleness {
  const mapTables = new Set(Object.keys(map?.tables ?? {}))
  const liveNames = new Set(nodes.map((n) => n.name))
  const catalogTables = new Set<string>()
  for (const g of catalog?.groups ?? []) for (const t of g.tables) catalogTables.add(t)

  return {
    liveTableCount: nodes.length,
    mapTableCount: mapTables.size,
    catalogTableCount: catalogTables.size,
    liveNotMapped: nodes
      .filter((n) => !mapTables.has(n.name))
      .map((n) => n.name)
      .sort(),
    mappedNotLive: [...mapTables].filter((t) => !liveNames.has(t)).sort(),
    derivedGroupTables: nodes
      .filter((n) => n.groupIsDerived)
      .map((n) => n.name)
      .sort(),
    ungroupedTables: nodes
      .filter((n) => n.group === UNGROUPED)
      .map((n) => n.name)
      .sort(),
  }
}
