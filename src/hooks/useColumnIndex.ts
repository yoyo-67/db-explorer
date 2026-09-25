import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnectionState } from '#/hooks/useConnectionStatus'
import { buildColumnEntries } from '#/lib/column-search'
import type { ColumnEntry } from '#/lib/column-search'
import { $getColumnFacets, $getSchemaGraph, $introspect } from '#/server/api'

export interface ColumnIndex {
  /** Null until introspection lands. Half a column list reads as a complete one. */
  entries: ColumnEntry[] | null
  /** While true, references are unknown, not absent. */
  graphLoading: boolean
  /** Why the graph isn't there. References are then unknown, not absent. */
  graphError: string | null
  facetsLoading: boolean
  /** Why the facets aren't there. Names, types and references still render. */
  facetsError: string | null
  analyzedAt: Record<string, string | null>
}

/**
 * Every column in a schema, with what each references and what the catalog
 * knows about it.
 *
 * Three fetches, and two of them are usually cache hits: introspection is keyed
 * the way the sidebar keys it, and the graph the way the lens does. Each piece
 * joins as it arrives rather than holding the page until the slowest one lands.
 */
export function useColumnIndex(
  database: string | undefined,
  schema: string | undefined,
): ColumnIndex {
  const enabled = useConnectionState() === 'connected' && Boolean(database) && Boolean(schema)

  const introspection = useQuery({
    queryKey: ['introspect', database, schema],
    queryFn: () => $introspect({ data: { database: database!, schema } }),
    enabled,
    staleTime: Infinity,
  })
  const graph = useQuery({
    queryKey: ['schemaGraph', database, schema],
    queryFn: () => $getSchemaGraph({ data: { database: database!, schema } }),
    enabled,
    staleTime: Infinity,
  })
  const facets = useQuery({
    queryKey: ['columnFacets', database, schema],
    queryFn: () => $getColumnFacets({ data: { database: database!, schema } }),
    enabled,
    // Statistics move when ANALYZE runs, not while someone reads the page.
    staleTime: 5 * 60_000,
  })

  const entries = useMemo(
    () =>
      introspection.data
        ? buildColumnEntries(introspection.data.tables, graph.data, facets.data)
        : null,
    [introspection.data, graph.data, facets.data],
  )

  return {
    entries,
    graphLoading: graph.isLoading,
    graphError: graph.isError ? (graph.error as Error).message : null,
    facetsLoading: facets.isLoading,
    facetsError: facets.isError ? (facets.error as Error).message : null,
    analyzedAt: facets.data?.analyzedAt ?? {},
  }
}
