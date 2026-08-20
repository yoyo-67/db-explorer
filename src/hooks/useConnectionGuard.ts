import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useConnectionState } from '#/hooks/useConnectionStatus'
import type { ConnectionState } from '#/lib/connection-state'

export function useConnectionGuard(): {
  state: ConnectionState
  isChecking: boolean
  isConnected: boolean
} {
  const navigate = useNavigate()
  const state = useConnectionState()

  useEffect(() => {
    // Only a check that answered "no" sends you to the form. Bouncing on a
    // pending check races the connect that is still landing.
    if (state === 'disconnected') {
      navigate({ to: '/' })
    }
  }, [state, navigate])

  return {
    state,
    isChecking: state === 'pending',
    isConnected: state === 'connected',
  }
}
