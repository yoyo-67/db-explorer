import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { $isConnected, $reconnect } from '#/server/api'

export function useConnectionGuard() {
  const navigate = useNavigate()

  const connectionCheck = useQuery({
    queryKey: ['connectionStatus'],
    queryFn: async () => {
      const status = await $isConnected()
      if (!status.connected) {
        // Try to reconnect from last config
        const reconnectResult = await $reconnect()
        return { connected: reconnectResult.success }
      }
      return { connected: true }
    },
    retry: false,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (connectionCheck.data && !connectionCheck.data.connected) {
      navigate({ to: '/' })
    }
  }, [connectionCheck.data, navigate])

  return {
    isChecking: connectionCheck.isLoading,
    isConnected: connectionCheck.data?.connected ?? false,
  }
}
