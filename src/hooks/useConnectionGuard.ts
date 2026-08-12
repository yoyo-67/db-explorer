import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useConnectionStatus } from '#/hooks/useConnectionStatus'

export function useConnectionGuard() {
  const navigate = useNavigate()

  const connectionCheck = useConnectionStatus()

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
