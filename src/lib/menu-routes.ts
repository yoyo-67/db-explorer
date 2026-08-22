/**
 * The routes the header keeps behind the menu rather than in the bar. They are
 * rare enough not to earn permanent width — but a selected route with nothing on
 * screen saying so is worse than no menu at all, so the trigger reads this to
 * mark itself.
 *
 * Two kinds, because the app has two kinds of route: `/queries` and `/pressure`
 * are about one database and live under `/d/<database>/`, while `/help` and
 * `/settings` are about neither and sit at the root.
 */
const DATABASE_ROUTES = ['/queries', '/pressure', '/indexes'] as const
const ROOT_ROUTES = ['/help', '/settings'] as const

/** Prefix match on a segment boundary: `/pressured` is not `/pressure`. */
function isUnder(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`)
}

/** Whether the menu currently holds the selected route. */
export function menuHoldsRoute(pathname: string): boolean {
  if (ROOT_ROUTES.some((route) => isUnder(pathname, route))) return true
  const scoped = pathname.match(/^\/d\/[^/]+(\/.*)?$/)
  if (!scoped) return false
  const rest = scoped[1] ?? '/'
  return DATABASE_ROUTES.some((route) => isUnder(rest, route))
}
