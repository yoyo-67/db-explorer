/** The neighborhood page's URL. One hop is the default and is left out, so the
 *  plain link and the one-hop page are the same URL. */
export interface NeighborhoodSearch {
  col?: string
  hops?: 2
}

export function validateNeighborhoodSearch(search: Record<string, unknown>): NeighborhoodSearch {
  const out: NeighborhoodSearch = {}
  if (typeof search.col === 'string' && search.col.length > 0) out.col = search.col
  if (search.hops === 2 || search.hops === '2') out.hops = 2
  return out
}
