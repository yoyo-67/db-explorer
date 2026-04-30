import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  $connect,
  $getPresets,
  $getSchemas,
  $getTables,
  $testConnection,
} from '#/server/api'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)]/60 bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-3 py-2">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--sea-ink)] no-underline"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--lagoon)]" />
          DB Explorer
        </Link>

        <div className="flex items-center gap-x-3 text-xs font-medium">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
            activeOptions={{ exact: true }}
          >
            Connect
          </Link>
          <Link
            to="/console"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Console
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <ConnectionSwitcher />
          <SchemaPicker />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}

function SchemaPicker() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isOnTableRoute = pathname.startsWith('/t/')
  const currentSchema = isOnTableRoute ? pathname.split('/')[2] : undefined

  const schemasQuery = useQuery({
    queryKey: ['schemas'],
    queryFn: () => $getSchemas(),
    staleTime: Infinity,
  })

  const schemas = schemasQuery.data ?? []
  if (schemas.length === 0) return null

  const selected = currentSchema ?? schemas[0]

  const handleChange = async (nextSchema: string) => {
    const tables = await $getTables({ data: { schema: nextSchema } })
    if (tables.length === 0) return
    navigate({
      to: '/t/$schema/$table',
      params: { schema: nextSchema, table: tables[0].name },
    })
  }

  return (
    <select
      value={selected}
      onChange={(e) => handleChange(e.target.value)}
      className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-xs text-[var(--sea-ink)] outline-none"
      title="Schema"
    >
      {schemas.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

function ConnectionSwitcher() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const presetsQuery = useQuery({
    queryKey: ['presets'],
    queryFn: () => $getPresets(),
    staleTime: 60_000,
  })

  const presets = presetsQuery.data?.presets ?? []
  if (presets.length === 0) return null

  const handleSelect = async (name: string) => {
    if (!name) return
    const preset = presets.find((p) => p.name === name)
    if (!preset) return
    setSwitching(name)
    setError(null)
    try {
      const test = await $testConnection({ data: preset })
      if (!test.success) {
        setError('error' in test ? test.error : 'Connection failed')
        return
      }
      await $connect({ data: { config: preset, presetName: preset.name } })
      await queryClient.invalidateQueries()
      const schemas = await $getSchemas()
      const schema = schemas.includes('public') ? 'public' : schemas[0]
      if (!schema) {
        setError('Connected but no schemas were found')
        return
      }
      const tables = await $getTables({ data: { schema } })
      if (tables.length === 0) {
        navigate({ to: '/' })
        return
      }
      navigate({
        to: '/t/$schema/$table',
        params: { schema, table: tables[0].name },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSwitching(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value=""
        disabled={switching !== null}
        onChange={(e) => handleSelect(e.target.value)}
        className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-xs text-[var(--sea-ink)] outline-none disabled:opacity-50"
        title="Switch connection"
      >
        <option value="">{switching ? `Switching to ${switching}...` : 'Switch DB...'}</option>
        {presets.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      {error && (
        <span title={error} className="text-xs text-red-500">
          ⚠
        </span>
      )}
    </div>
  )
}
