import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { useMemo } from 'react'
import { $getSchemaGraph } from '#/server/api'
import { useTableCatalog } from '#/hooks/useSchemaMetadata'
import {
  deriveDegrees,
  filterEdgesByBasis,
  resolveDampedGroups,
} from '#/lib/schema-graph-metrics'
import { dampKeysFromSearch } from '#/lib/lens-search'
import type { Degrees } from '#/lib/schema-graph-metrics'
import type { EdgeBasis, SchemaGraph, SchemaGraphEdge, SchemaGraphNode } from '#/lib/types'

/**
 * The one graph fetch both lens views share, plus everything derived from it.
 *
 * Degrees, damping and the basis filter are computed here rather than shipped by
 * the server so each metric has a single definition. The query key is the schema
 * alone; switching connection calls `invalidateQueries()` in the header, which
 * is what stops one database's graph being shown for another.
 */
export interface LensGraph {
  isLoading: boolean
  error: Error | null
  graph: SchemaGraph | undefined
  /** Edges after the `?basis=` filter — what every view should draw. */
  edges: SchemaGraphEdge[]
  /** Unfiltered edge count, so the UI can say what the filter is hiding. */
  totalEdges: number
  nodeByName: Map<string, SchemaGraphNode>
  degrees: Map<string, Degrees>
  maxInDegree: number
  /** Curated Group order from the catalog — it carries meaning, so keep it. */
  groupOrder: string[]
  groupDescriptions: Map<string, string>
  dampedGroups: Set<string>
  dampKeys: string[]
  groupOf: (table: string) => string | undefined
  tablesByGroup: Map<string, SchemaGraphNode[]>
}

export function useLensGraph(
  schema: string,
  opts: { enabled: boolean; damp?: string; basis?: EdgeBasis },
): LensGraph {
  const database = useDatabaseParam()
  const graphQuery = useQuery({
    queryKey: ['schemaGraph', database, schema],
    queryFn: () => $getSchemaGraph({ data: { database, schema } }),
    enabled: opts.enabled,
    staleTime: Infinity,
  })

  const catalogQuery = useTableCatalog(database, schema)

  const graph = graphQuery.data
  const dampKeys = useMemo(() => dampKeysFromSearch(opts.damp), [opts.damp])

  const groupOrder = useMemo(
    () =>
      [...(catalogQuery.data?.groups ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((g) => g.name),
    [catalogQuery.data],
  )

  const groupDescriptions = useMemo(
    () =>
      new Map(
        (catalogQuery.data?.groups ?? []).map((g) => [g.name, g.description] as const),
      ),
    [catalogQuery.data],
  )

  const edges = useMemo(
    () => filterEdgesByBasis(graph?.edges ?? [], opts.basis),
    [graph, opts.basis],
  )

  const nodeByName = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.name, n])),
    [graph],
  )

  // Degrees come off the *filtered* edges: with ?basis=declared the sizes have
  // to match the picture actually on screen.
  const degrees = useMemo(() => deriveDegrees(edges), [edges])
  const maxInDegree = useMemo(() => {
    let max = 0
    for (const d of degrees.values()) if (d.inDegree > max) max = d.inDegree
    return max
  }, [degrees])

  const presentGroups = useMemo(() => {
    const set = new Set<string>()
    for (const n of graph?.nodes ?? []) set.add(n.group)
    return [...set]
  }, [graph])

  const dampedGroups = useMemo(
    () => resolveDampedGroups(presentGroups, dampKeys),
    [presentGroups, dampKeys],
  )

  const tablesByGroup = useMemo(() => {
    const map = new Map<string, SchemaGraphNode[]>()
    for (const n of graph?.nodes ?? []) {
      const list = map.get(n.group) ?? []
      list.push(n)
      map.set(n.group, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return map
  }, [graph])

  return {
    isLoading: graphQuery.isLoading,
    error: graphQuery.error,
    graph,
    edges,
    totalEdges: graph?.edges.length ?? 0,
    nodeByName,
    degrees,
    maxInDegree,
    groupOrder,
    groupDescriptions,
    dampedGroups,
    dampKeys,
    groupOf: (table: string) => nodeByName.get(table)?.group,
    tablesByGroup,
  }
}
