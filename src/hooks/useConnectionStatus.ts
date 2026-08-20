import { useQuery } from '@tanstack/react-query'
import { $isConnected, $reconnect } from '#/server/api'
import { connectionState } from '#/lib/connection-state'
import type { ConnectionState } from '#/lib/connection-state'

/** The one connection-status query. Shared key, so the guard on a page and the
 *  header's connect/disconnect control never disagree about the state. */
export const connectionStatusKey = ['connectionStatus'] as const

export function useConnectionStatus() {
  return useQuery({
    queryKey: connectionStatusKey,
    queryFn: async () => {
      const status = await $isConnected()
      if (status.connected) return { connected: true }
      // A dropped pool is revived from the last config; an explicit disconnect
      // clears that config, so logging out stays logged out.
      const reconnected = await $reconnect()
      return { connected: reconnected.success }
    },
    retry: false,
    staleTime: 30_000,
  })
}

/** The same query read as the three states the UI actually has to render. */
export function useConnectionState(): ConnectionState {
  const query = useConnectionStatus()
  return connectionState(query)
}
