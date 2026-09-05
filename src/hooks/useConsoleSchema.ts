import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnectionState } from '#/hooks/useConnectionStatus'
import { $getMapModels, $getSchemas, $introspect } from '#/server/api'
import type { ConsoleSchema } from '#/lib/console/completion'

/**
 * Everything the console needs to know about the database it is pointed at.
 *
 * Two fetches on the keys the rest of the app already uses, so opening the
 * console after browsing a table costs nothing: the introspection is the same
 * one the table page read, and the model map is the same one every list that
 * prints a table name reads.
 *
 * Null until both land. A completion source with half a schema would quietly
 * offer half the tables, and a list that is silently incomplete is worse than
 * one that is briefly absent.
 */
export function useConsoleSchema(
  database: string | undefined,
  schema: string | undefined,
): ConsoleSchema | null {
  const isConnected = useConnectionState() === 'connected'
  const enabled = isConnected && Boolean(database) && Boolean(schema)

  const introspection = useQuery({
    queryKey: ['introspect', database, schema],
    queryFn: () => $introspect({ data: { database: database!, schema } }),
    enabled,
    staleTime: Infinity,
  })

  const models = useQuery({
    queryKey: ['mapModels', database, schema],
    queryFn: () => $getMapModels({ data: { database: database!, schema } }),
    enabled,
    staleTime: Infinity,
  })

  return useMemo(() => {
    if (!introspection.data || !schema) return null
    return {
      schema,
      tables: introspection.data.tables,
      fks: introspection.data.fks,
      models: models.data ?? {},
    }
  }, [introspection.data, models.data, schema])
}

/** The schemas on this connection, for the console's schema picker. */
export function useSchemaList(database: string | undefined): string[] {
  const isConnected = useConnectionState() === 'connected'
  const { data } = useQuery({
    queryKey: ['schemas', database],
    queryFn: () => $getSchemas({ data: { database: database! } }),
    enabled: isConnected && Boolean(database),
    staleTime: Infinity,
  })
  return (data ?? []).map((entry) => entry.name)
}
