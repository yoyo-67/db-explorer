import { useQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { useDatabase } from '#/hooks/useDatabase'
import { useConnectionState } from '#/hooks/useConnectionStatus'
import { schemaFromPathname } from '#/lib/lens-links'
import { $getMapModels } from '#/server/api'

/**
 * Table → Django model for the schema the URL is about.
 *
 * Read off the path rather than taken as props, like `useDatabase`: the model
 * name is wanted in the sidebar and the pressure sections as much as in the
 * routes under `/d/$database`, and threading a database and a schema down to
 * every list that prints a table name is a lot of wiring for a name.
 *
 * One fetch per schema on the key the table page already uses, so a page that
 * reads this in twenty rows still makes no request the page did not make
 * anyway. An empty map is the honest answer while it loads and on a schema with
 * no `schema-map.json` — every caller renders the bare table name for both.
 */
export function useModelNames(): Readonly<Record<string, string>> {
  const database = useDatabase()
  const schema = useRouterState({
    select: (s) => schemaFromPathname(s.location.pathname),
  })
  const isConnected = useConnectionState() === 'connected'

  const { data } = useQuery({
    queryKey: ['mapModels', database, schema],
    queryFn: () => $getMapModels({ data: { database: database!, schema } }),
    enabled: isConnected && Boolean(database) && Boolean(schema),
    staleTime: Infinity,
  })
  return data ?? {}
}
