/**
 * The routes the header keeps behind the overflow menu rather than in the bar.
 * They are rare enough not to earn permanent width — but a selected route with
 * nothing on screen saying so is worse than no menu at all, so the trigger
 * reads this to mark itself.
 */
const OVERFLOW_ROUTES = ['/queries', '/pressure', '/help', '/settings'] as const

/**
 * Whether the menu currently holds the selected route.
 *
 * Prefix matching, on a segment boundary: `/pressure/public` is the pressure
 * route, `/pressured` is not one at all.
 */
export function menuHoldsRoute(pathname: string): boolean {
  return OVERFLOW_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  )
}
