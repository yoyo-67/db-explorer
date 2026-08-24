import { useQuery } from '@tanstack/react-query'
import { useConnectionState } from '#/hooks/useConnectionStatus'
import { $getMapGroups, $getTableCatalog } from '#/server/api'
import type { TableCatalog } from '#/lib/types'

/**
 * The private metadata under `local/`, read only once the server has a
 * connection.
 *
 * The files are filed under the live connection — see
 * `#/lib/local-metadata-path` — so the server cannot name a folder before one
 * exists, and the handlers answer with an empty catalog. That is "no answer
 * yet", not "no metadata", and `staleTime: Infinity` keeps whichever of the two
 * arrives first: landing straight on a table URL while the server was still
 * unconnected cached the empty one, and the sidebar grouped 356 tables by name
 * prefix for the rest of the session. Asking only while connected is what makes
 * the cached answer the real one.
 *
 * Same query keys everywhere, so the sidebar, the table page and the lens still
 * share one fetch per schema.
 */
function useMetadataQuery<T>(
  key: string,
  database: string | undefined,
  schema: string | undefined,
  fetch: (data: { database: string; schema: string }) => Promise<T>,
) {
  const isConnected = useConnectionState() === 'connected'
  return useQuery({
    queryKey: [key, database, schema],
    queryFn: () => fetch({ database: database!, schema: schema! }),
    enabled: isConnected && Boolean(database) && Boolean(schema),
    staleTime: Infinity,
  })
}

/** The hand-curated grouping for a schema, or undefined until it is read. */
export function useTableCatalog(database: string | undefined, schema: string | undefined) {
  return useMetadataQuery<TableCatalog>('tableCatalog', database, schema, (data) =>
    $getTableCatalog({ data }),
  )
}

/** Table → Django module group, the lens's second-choice grouping. */
export function useMapGroups(database: string | undefined, schema: string | undefined) {
  return useMetadataQuery<Record<string, string>>('mapGroups', database, schema, (data) =>
    $getMapGroups({ data }),
  )
}
