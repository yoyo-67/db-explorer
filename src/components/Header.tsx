import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  $connect,
  $disconnect,
  $getPresets,
  $getSchemas,
  $getTables,
  $resolveEntryTarget,
  $testConnection,
} from '#/server/api'
import { connectionStatusKey, useConnectionStatus } from '#/hooks/useConnectionStatus'
import { useAppSettings } from '#/hooks/useAppSettings'
import { parseLensPath, schemaFromPathname } from '#/lib/lens-links'
import ThemeToggle from './ThemeToggle'
import QueryHud from './QueryHud/QueryHud'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)]/60 bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-3 py-2">
        <HomeLink />

        <div className="flex items-center gap-x-3 text-xs font-medium">
          <ConnectionAction />
          <Link
            to="/console"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Console
          </Link>
          <Link
            to="/queries"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
            title="Query board — what this database spends its time running"
          >
            Queries
          </Link>
          <LensLink />
          <PressureLink />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <OptionalQueryHud />
          <ConnectionSwitcher />
          <SchemaPicker />
          <SettingsLink />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}

/**
 * The HUD polls the query log every second for as long as it is mounted, in
 * every open tab. Not mounted is the off switch — see `/settings`.
 */
function OptionalQueryHud() {
  const { queryHud } = useAppSettings()
  if (!queryHud) return null
  return <QueryHud />
}

function SettingsLink() {
  return (
    <Link
      to="/settings"
      className="nav-link"
      activeProps={{ className: 'nav-link is-active' }}
      title="Settings for this browser"
    >
      ⚙
    </Link>
  )
}

const WORDMARK = (
  <>
    <span className="h-1.5 w-1.5 rounded-full bg-[var(--lagoon)]" />
    DB Explorer
  </>
)

const WORDMARK_CLASS =
  'inline-flex items-center gap-1.5 text-sm font-medium text-[var(--sea-ink)] no-underline'

/**
 * The wordmark goes home, and home is wherever the app actually is: the data
 * once you are connected, the connect form only while you are not. Sending a
 * connected user back to a form they already filled in is a dead end.
 */
function HomeLink() {
  const status = useConnectionStatus()
  const openFirstTable = useOpenFirstTable()

  if (!status.data?.connected) {
    return (
      <Link to="/" className={WORDMARK_CLASS}>
        {WORDMARK}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={() => openFirstTable()}
      className={`${WORDMARK_CLASS} cursor-pointer`}
      title="Back to the tables"
    >
      {WORDMARK}
    </button>
  )
}

/**
 * Open the landing view of a connection — the first table of `public`, or of
 * whatever schema exists. The same move the app makes right after connecting,
 * so "home" and "just connected" agree.
 */
function useOpenFirstTable() {
  const navigate = useNavigate()
  return async () => {
    const target = await $resolveEntryTarget()
    if (!target.ok) return navigate({ to: '/' })
    return navigate({
      to: '/t/$schema/$table',
      params: { schema: target.schema, table: target.table },
    })
  }
}

/**
 * Connect while disconnected, Disconnect while connected — never a Connect link
 * that does nothing because you already are. Disconnecting is a real logout: the
 * server drops the pool and forgets the config, so nothing silently reconnects.
 */
function ConnectionAction() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const status = useConnectionStatus()
  const [disconnecting, setDisconnecting] = useState(false)

  if (!status.data?.connected) {
    return (
      <Link
        to="/"
        className="nav-link"
        activeProps={{ className: 'nav-link is-active' }}
        activeOptions={{ exact: true }}
      >
        Connect
      </Link>
    )
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await $disconnect()
      // The cached schemas, tables and rows all belong to the connection that
      // just went away, so they go with it rather than flashing on the next one.
      queryClient.clear()
      queryClient.setQueryData(connectionStatusKey, { connected: false })
      navigate({ to: '/' })
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDisconnect}
      disabled={disconnecting}
      className="nav-link cursor-pointer disabled:opacity-50"
      title="Disconnect and forget this connection"
    >
      {disconnecting ? 'Disconnecting...' : 'Disconnect'}
    </button>
  )
}

/** Entry point into the lens, for whichever schema the current route is about. */
function LensLink() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const schema = schemaFromPathname(pathname)
  if (!schema) return null
  return (
    <Link
      to="/lens/$schema"
      params={{ schema }}
      className="nav-link"
      activeProps={{ className: 'nav-link is-active' }}
      title="Schema architecture lens — how this schema is shaped"
    >
      Lens
    </Link>
  )
}

/** Index sprawl, disk, vacuum debt, sequence headroom — for the current schema. */
function PressureLink() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const schema = schemaFromPathname(pathname)
  if (!schema) return null
  return (
    <Link
      to="/pressure/$schema"
      params={{ schema }}
      className="nav-link"
      activeProps={{ className: 'nav-link is-active' }}
      title="Schema pressure — unread indexes, disk, vacuum debt, sequences running out"
    >
      Pressure
    </Link>
  )
}

function SchemaPicker() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const currentSchema = schemaFromPathname(pathname)
  const lensLocation = parseLensPath(pathname)

  const schemasQuery = useQuery({
    queryKey: ['schemas'],
    queryFn: () => $getSchemas(),
    staleTime: Infinity,
  })

  const schemas = schemasQuery.data ?? []
  if (schemas.length === 0) return null

  const selected = currentSchema ?? schemas[0]

  const handleChange = async (nextSchema: string) => {
    // On the lens, a schema switch keeps the view you were reading. A Group that
    // the next schema does not have falls back to the matrix, which the group
    // route handles rather than this picker guessing at another schema's groups.
    if (lensLocation) {
      if (lensLocation.view.kind === 'group') {
        navigate({
          to: '/lens/$schema/g/$group',
          params: { schema: nextSchema, group: lensLocation.view.group },
        })
      } else if (lensLocation.view.kind === 'orphans') {
        navigate({ to: '/lens/$schema/orphans', params: { schema: nextSchema } })
      } else {
        navigate({ to: '/lens/$schema', params: { schema: nextSchema } })
      }
      return
    }
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
  const openFirstTable = useOpenFirstTable()
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
      await openFirstTable()
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
