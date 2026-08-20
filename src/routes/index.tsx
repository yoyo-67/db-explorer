import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import ConnectionForm from '#/components/ConnectionForm'
import { connectionStatusKey } from '#/hooks/useConnectionStatus'
import {
  $connect,
  $getPresets,
  $isConnected,
  $resolveEntryTarget,
  $testConnection,
} from '#/server/api'
import type { ConnectionConfig } from '#/lib/types'

/**
 * The pool lives on the server, so a second tab is already connected the moment
 * it loads. Send it to the data instead of a connect form it doesn't need —
 * filling that form in would rebuild the pool the first tab is using. Reaching
 * the form again is what Disconnect in the header menu is for.
 */
export const Route = createFileRoute('/')({
  loader: async () => {
    const status = await $isConnected()
    if (!status.connected) return
    const target = await $resolveEntryTarget()
    if (target.ok && target.database) {
      throw redirect({
        to: '/d/$database/t/$schema/$table',
        params: { database: target.database, schema: target.schema, table: target.table },
      })
    }
  },
  component: HomePage,
})

function HomePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const presetsQuery = useQuery({
    queryKey: ['presets'],
    queryFn: () => $getPresets(),
  })

  const handleConnect = async (config: ConnectionConfig, presetName?: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await $testConnection({ data: config })
      if (!result.success) {
        setError('error' in result ? result.error : 'Connection failed')
        setIsLoading(false)
        return
      }

      await $connect({ data: { config, presetName } })
      // The status query answered "not connected" moments ago and holds that for
      // 30s. Leaving it there sent the page we are about to open straight back
      // here, through the guard. The connect we just did IS the newer answer.
      queryClient.setQueryData(connectionStatusKey, { connected: true })
      const target = await $resolveEntryTarget()
      if (!target.ok || !target.database) {
        setError('error' in target ? target.error : 'This connection has no table to open.')
        setIsLoading(false)
        return
      }
      // Stay on "Connecting..." until the next screen is actually mounted —
      // flipping the button back first is what made the form look idle while
      // the connection was still being set up.
      await navigate({
        to: '/d/$database/t/$schema/$table',
        params: { database: target.database, schema: target.schema, table: target.table },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
      setIsLoading(false)
    }
  }

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />
        <p className="island-kicker mb-3">Database Explorer</p>
        <h1 className="display-title mb-5 max-w-3xl text-3xl leading-[1.08] font-bold tracking-tight text-[var(--sea-ink)] sm:text-5xl">
          Connect to your database
        </h1>
        <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)]">
          Enter your PostgreSQL credentials to explore tables, preview data, and
          visualize relationships. All queries are read-only.
        </p>

        {presetsQuery.data?.error && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Preset error: {presetsQuery.data.error}
          </div>
        )}

        <ConnectionForm
          onConnect={handleConnect}
          isLoading={isLoading}
          error={error}
          presets={presetsQuery.data?.presets ?? []}
        />
      </section>
    </main>
  )
}
