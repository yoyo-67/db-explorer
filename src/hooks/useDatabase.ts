import { useRouterState } from '@tanstack/react-router'
import { databaseFromPathname } from '#/lib/lens-links'

/**
 * Which database the page is about, read from the URL.
 *
 * Read from the path rather than from route params so the header and the sidebar
 * — which render outside the `/d/$database` subtree — get the same answer as the
 * routes inside it. Undefined on the pages that are about no database: the
 * connect form, help, settings.
 */
export function useDatabase(): string | undefined {
  return useRouterState({ select: (s) => databaseFromPathname(s.location.pathname) })
}

/**
 * The database, insisted upon. For components that only ever render inside a
 * `/d/$database` route, where its absence is a routing bug rather than a state
 * to handle.
 */
export function useDatabaseParam(): string {
  const database = useDatabase()
  if (!database) throw new Error('This route is missing its database parameter')
  return database
}
