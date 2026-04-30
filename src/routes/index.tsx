import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import ConnectionForm from '#/components/ConnectionForm'
import {
  $connect,
  $getPresets,
  $getSchemas,
  $getTables,
  $testConnection,
} from '#/server/api'
import type { ConnectionConfig } from '#/lib/types'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const presetsQuery = useQuery({
    queryKey: ['presets'],
    queryFn: () => $getPresets(),
  })

  const handleConnect = async (config: ConnectionConfig) => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await $testConnection({ data: config })
      if (!result.success) {
        setError('error' in result ? result.error : 'Connection failed')
        return
      }

      await $connect({ data: config })
      const schemas = await $getSchemas()
      const schema = schemas.includes('public') ? 'public' : schemas[0]
      if (!schema) {
        setError('Connected, but no schemas were found')
        return
      }
      const tables = await $getTables({ data: { schema } })
      if (tables.length === 0) {
        setError(`Connected, but schema "${schema}" has no tables`)
        return
      }
      navigate({
        to: '/t/$schema/$table',
        params: { schema, table: tables[0].name },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
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
