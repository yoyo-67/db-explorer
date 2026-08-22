import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  $connect,
  $disconnect,
  $getDatabases,
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
import { menuHoldsRoute } from '#/lib/menu-routes'
import { useDatabase } from '#/hooks/useDatabase'
import TextScale from './TextScale'
import ThemeToggle from './ThemeToggle'
import QueryHud from './QueryHud/QueryHud'

/**
 * The bar carries only what a session actually navigates between — Console and
 * Lens — plus the controls that say which database you are looking at. The
 * once-a-session entries (query board, pressure, help, settings, text size,
 * theme, disconnect) live behind the menu, so the bar stops competing with the
 * data for attention and no longer needs the whole viewport to fit.
 */
export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)]/60 bg-[var(--header-bg)] px-3 backdrop-blur-lg sm:px-4">
      <nav className="mx-auto flex w-full max-w-[1680px] items-center gap-x-3 py-2">
        <HomeLink />

        <div className="scrollbar-none flex min-w-0 items-center gap-x-3 overflow-x-auto whitespace-nowrap text-xs font-medium">
          <ConsoleLink />
          <LensLink />
          <ConnectionState />
        </div>

        {/* Widest scope first: which connection, then which database on it,
            then which schema in that. */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <OptionalQueryHud />
          <ConnectionSwitcher />
          <DatabasePicker />
          <SchemaPicker />
          <Menu />
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
    if (!target.ok || !target.database) return navigate({ to: '/' })
    return navigate({
      to: '/d/$database/t/$schema/$table',
      params: { database: target.database, schema: target.schema, table: target.table },
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
  const database = useDatabase()
  const schemasQuery = useQuery({
    queryKey: ['schemas', database],
    queryFn: () => $getSchemas({ data: { database: database! } }),
    staleTime: Infinity,
    enabled: !!database,
  })
  if (!database) return undefined
  return resolveActiveSchema(pathname, (schemasQuery.data ?? []).map((s) => s.name))
}

/** The console runs SQL against one database, so it needs one to point at. */
function ConsoleLink() {
  const database = useDatabase()
  if (!database) return null
  return (
    <Link
      to="/d/$database/console"
      params={{ database }}
      className="nav-link"
      activeProps={{ className: 'nav-link is-active' }}
    >
      Console
    </Link>
  )
}

/** Entry point into the lens, for whichever schema the current route is about. */
function LensLink() {
  const database = useDatabase()
  const schema = useActiveSchema()
  if (!database || !schema) return null
  return (
    <Link
      to="/d/$database/lens/$schema"
      params={{ database, schema }}
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

const MENU_ITEM_ACTIVE_CLASS = `${MENU_ITEM_CLASS} bg-[rgba(79,184,178,0.16)] font-medium`

const MENU_HINT_CLASS = 'block text-[10px] text-[var(--sea-ink-soft)]'

/**
 * Everything a session reaches for once, if at all: the rarely-visited pages,
 * the two display controls, and the way out. A menu rather than more bar — none
 * of it is worth permanent width, and Disconnect in particular is safer one
 * deliberate click away from the links used all day.
 */
function Menu() {
  const [open, setOpen] = useState(false)
  const database = useDatabase()
  const schema = useActiveSchema()
  const state = useConnectionState()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // The selected route is inside here on those pages, and a bar that shows no
  // selection at all reads as "nowhere" — so the trigger carries the mark.
  const holdsSelectedRoute = menuHoldsRoute(pathname)

  // Any navigation closes it, including the entries below — the panel outliving
  // the page it was opened from is the one thing a menu must not do. The display
  // controls navigate nowhere, so they leave it open, which is what you want
  // while stepping the text size.
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-menu]') && !target.closest('[data-menu-trigger]')) {
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
        data-menu-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`relative cursor-pointer rounded-lg border px-2 py-1 text-xs leading-none transition ${
          open || holdsSelectedRoute
            ? 'border-[var(--lagoon)]/60 bg-[rgba(79,184,178,0.12)] text-[var(--sea-ink)]'
            : 'border-[var(--line)] bg-[var(--surface-strong)] text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
        }`}
        title="Menu"
      >
        <span aria-hidden>•••</span>
        <span className="sr-only">Menu</span>
        {holdsSelectedRoute && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[var(--lagoon)]"
          />
        )}
      </button>

      {open && (
        <div
          data-menu
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-1.5 shadow-lg shadow-black/10 backdrop-blur-xl"
        >
          {database && (
            <Link
              to="/d/$database/queries"
              params={{ database }}
              role="menuitem"
              className={MENU_ITEM_CLASS}
              activeProps={{ className: MENU_ITEM_ACTIVE_CLASS }}
            >
              Query board
              <span className={MENU_HINT_CLASS}>
                What this database spends its time running
              </span>
            </Link>
          )}

          {database && schema && (
            <Link
              to="/d/$database/pressure/$schema"
              params={{ database, schema }}
              role="menuitem"
              className={MENU_ITEM_CLASS}
              activeProps={{ className: MENU_ITEM_ACTIVE_CLASS }}
            >
              Schema pressure
              <span className={MENU_HINT_CLASS}>
                Unread indexes, disk, vacuum debt, sequences running out
              </span>
            </Link>
          )}

          {database && schema && (
            <Link
              to="/d/$database/indexes/$schema"
              params={{ database, schema }}
              // The route validates a search schema, so the link has to say it
              // starts with none: no selection, no filter, default sort.
              search={{}}
              role="menuitem"
              className={MENU_ITEM_CLASS}
              activeProps={{ className: MENU_ITEM_ACTIVE_CLASS }}
            >
              Indexes
              <span className={MENU_HINT_CLASS}>
                What each index costs, and what the counters say it serves
              </span>
            </Link>
          )}

          <Link
            to="/help"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            activeProps={{ className: MENU_ITEM_ACTIVE_CLASS }}
          >
            Help
          </Link>
          <Link
            to="/settings"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            activeProps={{ className: MENU_ITEM_ACTIVE_CLASS }}
          >
            Settings
          </Link>

          <div className="my-1.5 border-t border-[var(--line)]" />

          <MenuRow label="Text size">
            <TextScale />
          </MenuRow>
          <MenuRow label="Theme">
            <ThemeToggle />
          </MenuRow>

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

/** A named slot for a control that acts in place rather than navigating. */
function MenuRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
      <span className="text-xs text-[var(--sea-ink)]">{label}</span>
      {children}
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

/**
 * Which database on this server — a navigation, not a switch.
 *
 * The list is discovered from `pg_database`, so a database created this morning
 * is in it this afternoon. Choosing one goes to `/d/<database>`, which lands on
 * that database's first table: nothing is reconnected, no other tab moves, and
 * the address bar is the record of where you are. Hidden on a one-database
 * server, where a picker with a single option only takes up room.
 */
function DatabasePicker() {
  const navigate = useNavigate()
  const database = useDatabase()
  const state = useConnectionState()

  const databasesQuery = useQuery({
    queryKey: ['databases'],
    queryFn: () => $getDatabases(),
    staleTime: 60_000,
    enabled: state === 'connected',
  })

  const databases = databasesQuery.data ?? []
  if (!database || databases.length < 2) return null

  return (
    <select
      value={database}
      onChange={(e) => {
        const next = e.target.value
        if (next && next !== database) navigate({ to: '/d/$database', params: { database: next } })
      }}
      className="max-w-[9rem] truncate rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-xs text-[var(--sea-ink)] outline-none"
      title="Database on this server"
    >
      {/* The database in the URL is listed even if the discovery query has not
          answered yet, or has never heard of it — the page is about it either
          way, and a picker that silently shows a different name would lie. */}
      {!databases.some((db) => db.name === database) && (
        <option value={database}>{database}</option>
      )}
      {databases.map((db) => (
        // A database that refuses connections is still listed, disabled — the
        // absence of one you know exists is the more confusing answer.
        <option key={db.name} value={db.name} disabled={!db.canConnect}>
          {db.canConnect ? db.name : `${db.name} (no access)`}
        </option>
      ))}
    </select>
  )
}

function SchemaPicker() {
  const navigate = useNavigate()
  const database = useDatabase()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const lensLocation = parseLensPath(pathname)

  const schemasQuery = useQuery({
    queryKey: ['schemas', database],
    queryFn: () => $getSchemas({ data: { database: database! } }),
    staleTime: Infinity,
    enabled: !!database,
  })

  const schemas = schemasQuery.data ?? []
  if (!database || schemas.length === 0) return null

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
          to: '/d/$database/lens/$schema/g/$group',
          params: { database, schema: nextSchema, group: lensLocation.view.group },
        })
      } else if (lensLocation.view.kind === 'orphans') {
        navigate({ to: '/d/$database/lens/$schema/orphans', params: { database, schema: nextSchema } })
      } else {
        navigate({ to: '/d/$database/lens/$schema', params: { database, schema: nextSchema } })
      }
      return
    }
    const tables = await $getTables({ data: { database, schema: nextSchema } })
    if (tables.length === 0) return
    navigate({
      to: '/d/$database/t/$schema/$table',
      params: { database, schema: nextSchema, table: tables[0].name },
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
      // Everything cached belongs to the connection we just left. Cleared, not
      // invalidated, for the same reason as the database switch above.
      queryClient.clear()
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
        title="Switch to another configured connection"
      >
        <option value="">{switching ? `Switching to ${switching}...` : 'Switch connection...'}</option>
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
