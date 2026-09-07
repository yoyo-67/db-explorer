import { useQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { $getSchemas } from '#/server/api'
import { resolveActiveSchema } from '#/lib/active-schema'
import { useDatabase } from '#/hooks/useDatabase'

/**
 * The schema the schema-scoped links point at: the route's own when it has one,
 * the default otherwise, so a nav does not lose entries on the console or the
 * query board.
 *
 * Shared by the header and the palette, on the schema-picker's cached key — two
 * navigations disagreeing about what "the schema" means is the bug this exists
 * to prevent.
 */
export function useActiveSchema(): string | undefined {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const database = useDatabase()
  const schemasQuery = useQuery({
    queryKey: ['schemas', database],
    queryFn: () => $getSchemas({ data: { database: database! } }),
    staleTime: Infinity,
    enabled: !!database,
  })
  if (!database) return undefined
  return resolveActiveSchema(pathname, (schemasQuery.data ?? []).map((s) => s.name))
}
