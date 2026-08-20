import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  $connect,
  $disconnect,
  $getPresets,
  $getSchemas,
  $getTables,
  $resolveEntryTarget,
  $testConnection,
} from '#/server/api'
import { connectionStatusKey, useConnectionState } from '#/hooks/useConnectionStatus'
import { useAppSettings } from '#/hooks/useAppSettings'
import { parseLensPath } from '#/lib/lens-links'
import { resolveActiveSchema } from '#/lib/active-schema'
import TextScale from './TextScale'
import ThemeToggle from './ThemeToggle'
import QueryHud from './QueryHud/QueryHud'

/**
 * The bar carries only what a session actually navigates between — Console and
 * Lens — plus the controls that say which database you are looking at. The
 * once-a-session entries (query board, pressure, help, settings, disconnect)
 * live behind the overflow menu, so the bar stops competing with the data for
 * attention and no longer needs the whole viewport to fit.
 */
export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)]/60 bg-[var(--header-bg)] px-3 backdrop-blur-lg sm:px-4">
      <nav className="mx-auto flex w-full max-w-[1680px] items-center gap-x-3 py-2">
        <HomeLink />

        <div className="scrollbar-none flex min-w-0 items-center gap-x-3 overflow-x-auto whitespace-nowrap text-xs font-medium">
          <Link
            to="/console"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Console
          </Link>
          <LensLink />
          <ConnectionState />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <OptionalQueryHud />
          <ConnectionSwitcher />
          <SchemaPicker />
          <OverflowMenu />
          <TextScale />
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

const WORDMARK = (
  <>
    <span className="h-1.5 w-1.5 rounded-full bg-[var(--lagoon)]" />
    Tables
  </>
)

const WORDMARK_CLASS =
  'inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-[var(--sea-ink)] no-underline'

/**
 * The wordmark goes home, and home is wherever the app actually is: the data
 * once you are connected, the connect form only while you are not. Sending a
 * connected user back to a form they already filled in is a dead end.
 */
function HomeLink() {
  const state = useConnectionState()
  const openFirstTable = useOpenFirstTable()

  // While the check is in flight the wordmark leads nowhere: a link to the form
  // is wrong if we turn out to be connected, and the table target is not known
  // yet either.
  if (state === 'pending') {
    return <span className={`${WORDMARK_CLASS} opacity-60`}>{WORDMARK}</span>
  }
  if (state === 'disconnected') {
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
 * Only the states that need an answer from the user reach the bar: a way in
 * while there is no connection, and "still asking" while we do not know yet.
 * Being connected is already said by the switcher and the schema picker, so it
 * says nothing — and leaving is a menu entry, not a button under your cursor.
 */
function ConnectionState() {
  const state = useConnectionState()

  if (state === 'pending') {
    return (
      <span
        className="nav-link inline-flex items-center gap-1.5 opacity-70"
        title="Checking the connection"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--lagoon)]" />
        Connecting...
      </span>
    )
  }
  if (state !== 'disconnected') return null
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

/**
 * The schema the schema-scoped links point at: the route's own when it has one,
 * the default otherwise, so the nav does not lose entries on the console or the
 * query board. The schema list is already cached by the picker below.
 */
function useActiveSchema(): string | undefined {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const schemasQuery = useQuery({
    queryKey: ['schemas'],
    queryFn: () => $getSchemas(),
    staleTime: Infinity,
  })
  return resolveActiveSchema(pathname, (schemasQuery.data ?? []).map((s) => s.name))
}

/** Entry point into the lens, for whichever schema the current route is about. */
function LensLink() {
  const schema = useActiveSchema()
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

const MENU_ITEM_CLASS =
  'block w-full rounded-lg px-3 py-2 text-left text-xs text-[var(--sea-ink)] no-underline transition hover:bg-[rgba(79,184,178,0.12)]'

/**
 * Everything a session reaches for once, if at all. A menu rather than more bar:
 * these entries are not worth permanent width, and Disconnect in particular is
 * safer one deliberate click away from the links you use all day.
 */
function OverflowMenu() {
  const [open, setOpen] = useState(false)
  const schema = useActiveSchema()
  const state = useConnectionState()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Any navigation closes it, including the entries below — the panel outliving
  // the page it was opened from is the one thing a menu must not do.
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-overflow-menu]') && !target.closest('[data-overflow-trigger]')) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        type="button"
        data-overflow-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`cursor-pointer rounded-lg border border-[var(--line)] px-2 py-1 text-xs leading-none transition ${
          open
            ? 'bg-[rgba(79,184,178,0.12)] text-[var(--sea-ink)]'
            : 'bg-[var(--surface-strong)] text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
        }`}
        title="More"
      >
        <span aria-hidden>•••</span>
        <span className="sr-only">More</span>
      </button>

      {open && (
        <div
          data-overflow-menu
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-1.5 shadow-lg shadow-black/10"
        >
          <Link to="/queries" role="menuitem" className={MENU_ITEM_CLASS}>
            Query board
            <span className="block text-[10px] text-[var(--sea-ink-soft)]">
              What this database spends its time running
            </span>
          </Link>

          {schema && (
            <Link
              to="/pressure/$schema"
              params={{ schema }}
              role="menuitem"
              className={MENU_ITEM_CLASS}
            >
              Schema pressure
              <span className="block text-[10px] text-[var(--sea-ink-soft)]">
                Unread indexes, disk, vacuum debt, sequences running out
              </span>
            </Link>
          )}

          <Link to="/help" role="menuitem" className={MENU_ITEM_CLASS}>
            Help
          </Link>
          <Link to="/settings" role="menuitem" className={MENU_ITEM_CLASS}>
            Settings
          </Link>

          {state === 'connected' && (
            <>
              <div className="my-1.5 border-t border-[var(--line)]" />
              <DisconnectItem />
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Disconnecting is a real logout: the server drops the pool and forgets the
 * config, so nothing silently reconnects.
 */
function DisconnectItem() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [disconnecting, setDisconnecting] = useState(false)

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
      role="menuitem"
      onClick={handleDisconnect}
      disabled={disconnecting}
      className={`${MENU_ITEM_CLASS} cursor-pointer disabled:opacity-50`}
      title="Disconnect and forget this connection"
    >
      {disconnecting ? 'Disconnecting...' : 'Disconnect'}
    </button>
  )
}

function SchemaPicker() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const lensLocation = parseLensPath(pathname)

  const schemasQuery = useQuery({
    queryKey: ['schemas'],
    queryFn: () => $getSchemas(),
    staleTime: Infinity,
  })

  const schemas = schemasQuery.data ?? []
  if (schemas.length === 0) return null

  const selected =
    resolveActiveSchema(
      pathname,
      schemas.map((s) => s.name),
    ) ?? schemas[0].name

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
      className="max-w-[9rem] truncate rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-xs text-[var(--sea-ink)] outline-none"
      title="Schema"
    >
      {/* Postgres's own schemas are listed like any other, and say so — the
          flag is read off the server, never matched against a name. */}
      {schemas.map((s) => (
        <option key={s.name} value={s.name}>
          {s.isSystem ? `${s.name} (system)` : s.name}
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
      // Everything cached belongs to the connection we just left.
      await queryClient.invalidateQueries()
      queryClient.setQueryData(connectionStatusKey, { connected: true })
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
        className="max-w-[9rem] truncate rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-xs text-[var(--sea-ink)] outline-none disabled:opacity-50"
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
