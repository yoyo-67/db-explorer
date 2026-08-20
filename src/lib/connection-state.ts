/**
 * Three states, not two. A check that has not answered yet is neither connected
 * nor disconnected, and the difference matters: collapsing "pending" into
 * "disconnected" makes the header advertise a Connect link and the guard bounce
 * a page back to the form while the answer is still in flight.
 */
export type ConnectionState = 'pending' | 'connected' | 'disconnected'

interface StatusQueryLike {
  isPending: boolean
  isFetching?: boolean
  isError?: boolean
  data: { connected: boolean } | undefined
}

export function connectionState(query: StatusQueryLike): ConnectionState {
  if (query.data) return query.data.connected ? 'connected' : 'disconnected'
  // No answer yet. Still asking is pending; a check that failed is a no.
  if (query.isError) return 'disconnected'
  return query.isPending || query.isFetching ? 'pending' : 'disconnected'
}
