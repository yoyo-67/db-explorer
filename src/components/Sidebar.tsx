import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  $getMapGroups,
  $getTableActivity,
  $getTableCatalog,
  $introspect,
} from '#/server/api'
import {
  filterGroups,
  groupTablesByCatalog,
  UNCATEGORIZED_GROUP_NAME,
} from '#/lib/catalog-grouping'
import { describeChange, formatMods, rankByRecentChange } from '#/lib/table-activity'
import TableName, { useTableNameText } from '#/components/TableName'
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  readSidebarWidth,
  writeSidebarWidth,
} from '#/lib/sidebar-width'

const EXPANDED_KEY = 'sidebar:expandedGroups'
const COLLAPSED_KEY = 'sidebar:collapsed'

/** Matches the filter panel's rail on the other side of the rows. */
const RAIL_WIDTH = 14

/**
 * How the sidebar orders tables. Grouped is the catalog's own structure;
 * changed asks the statistics views what has been written lately, which no
 * grouping can tell you.
 */
type View = 'grouped' | 'changed'

export default function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // The table browser only: the database and schema both come off the path, so a
  // route without them has no sidebar to draw.
  const match = pathname.match(/^\/d\/([^/]+)\/t\/([^/]+)(?:\/([^/]+))?/)
  if (!match) return null
  const database = decodeURIComponent(match[1])
  const schema = decodeURIComponent(match[2])
  const activeTable = match[3] ? decodeURIComponent(match[3]) : undefined
  return <SidebarBody database={database} schema={schema} activeTable={activeTable} />
}

function SidebarBody({
  database,
  schema,
  activeTable,
}: {
  database: string
  schema: string
  activeTable?: string
}) {
  const [filter, setFilter] = useState('')
  // The rows truncate, so the untruncated name — model and all — lives in the title.
  const nameText = useTableNameText()
  const [view, setView] = useState<View>('grouped')
  // Remembered per browser, like the expanded groups: which panes are open is
  // how someone has arranged their workspace, not what they are looking at.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === 'true')
    } catch {
      /* ignore */
    }
  }, [])
  // Read after mount, not during render: the server has no localStorage, and a
  // width guessed there would be hydrated over anyway.
  const [width, setWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    setWidth(readSidebarWidth(window.localStorage))
  }, [])

  const resizeTo = (next: number) => {
    const clamped = clampSidebarWidth(next)
    setWidth(clamped)
    writeSidebarWidth(window.localStorage, clamped)
  }

  const setCollapsedPersistent = (next: boolean) => {
    setCollapsed(next)
    try {
      window.localStorage.setItem(COLLAPSED_KEY, String(next))
    } catch {
      /* ignore quota */
    }
  }
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = window.localStorage.getItem(EXPANDED_KEY)
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {
      /* ignore quota */
    }
  }, [expanded])

  const introspectQuery = useQuery({
    queryKey: ['introspect', database, schema],
    queryFn: () => $introspect({ data: { database, schema } }),
    staleTime: Infinity,
  })

  const catalogQuery = useQuery({
    queryKey: ['tableCatalog', database, schema],
    queryFn: () => $getTableCatalog({ data: { database, schema } }),
    staleTime: Infinity,
  })

  const mapGroupsQuery = useQuery({
    queryKey: ['mapGroups', database, schema],
    queryFn: () => $getMapGroups({ data: { database, schema } }),
    staleTime: Infinity,
  })

  // Only asked for while the changed view is on: it is one cheap catalog query,
  // but a stats read on every sidebar render would still be a read nobody asked
  // for. Ten seconds stale is fine for something measured in ANALYZE cycles.
  const activityQuery = useQuery({
    queryKey: ['tableActivity', database, schema],
    queryFn: () => $getTableActivity({ data: { database, schema } }),
    staleTime: 10_000,
    enabled: view === 'changed',
  })

  const tables = introspectQuery.data?.tables ?? []
  const groups = useMemo(
    () => groupTablesByCatalog(tables, catalogQuery.data, mapGroupsQuery.data),
    [tables, catalogQuery.data, mapGroupsQuery.data],
  )
  const visibleGroups = useMemo(() => filterGroups(groups, filter), [groups, filter])

  // Ranked by the statistics views, then narrowed to tables this schema actually
  // lists — `pg_stat_all_tables` counts partitions and TOAST-side relations the
  // browser has no page for.
  const changed = useMemo(() => {
    const listed = new Set(tables.map((t) => t.name))
    const needle = filter.trim().toLowerCase()
    return rankByRecentChange(activityQuery.data?.tables ?? [])
      .filter((entry) => listed.has(entry.table))
      .filter((entry) => !needle || entry.table.toLowerCase().includes(needle))
  }, [activityQuery.data, tables, filter])

  // Keep the active table's group expanded automatically
  useEffect(() => {
    if (!activeTable) return
    for (const g of groups) {
      if (g.tables.some((t) => t.name === activeTable) && g.name) {
        setExpanded((prev) => (prev.has(g.name) ? prev : new Set(prev).add(g.name)))
        return
      }
    }
  }, [activeTable, groups])

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  if (collapsed) {
    return (
      <aside
        style={{ width: RAIL_WIDTH }}
        className="sticky top-[44px] h-[calc(100vh-44px)] shrink-0 border-r border-[var(--line)]/60 bg-[var(--surface)]/50 transition-[width] duration-200 ease-out"
      >
        <button
          type="button"
          onClick={() => setCollapsedPersistent(false)}
          title="Show the table list"
          aria-label="Show the table list"
          aria-expanded={false}
          className="absolute -right-3 top-3 z-10 rounded-full border border-[var(--line)] bg-[var(--bg-base)] px-1.5 py-1 text-[10px] text-[var(--sea-ink-soft)] shadow hover:text-[var(--lagoon-deep)]"
        >
          &rsaquo;
        </button>
        <span className="absolute left-1/2 top-14 -translate-x-1/2 rotate-90 whitespace-nowrap text-[10px] text-[var(--sea-ink-soft)]">
          {tables.length} tables
        </span>
      </aside>
    )
  }

  return (
    <aside
      style={{ width }}
      className={`sticky top-[44px] flex h-[calc(100vh-44px)] shrink-0 border-r border-[var(--line)]/60 bg-[var(--surface)]/50 ${
        // The transition is what makes collapsing glide; during a drag it is
        // what makes the edge lag behind the cursor.
        dragging ? 'select-none' : 'transition-[width] duration-200 ease-out'
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsedPersistent(true)}
        title="Hide the table list"
        aria-label="Hide the table list"
        aria-expanded
        className="absolute right-3 top-3 z-10 rounded-full border border-[var(--line)] bg-[var(--bg-base)] px-1.5 py-1 text-[10px] text-[var(--sea-ink-soft)] shadow hover:text-[var(--lagoon-deep)]"
      >
        &lsaquo;
      </button>

      <div className="min-w-0 flex-1 overflow-y-auto px-2 py-3">
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search tables..."
        className="mb-2 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] py-1.5 pl-2.5 pr-8 text-xs text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
      />

      <div className="mb-2 flex items-center gap-1">
        <ViewChip active={view === 'grouped'} onClick={() => setView('grouped')} title="The catalog's own grouping">
          Grouped
        </ViewChip>
        <ViewChip
          active={view === 'changed'}
          onClick={() => setView('changed')}
          title="Tables with rows changed since their last ANALYZE, most first"
        >
          Changed
        </ViewChip>
      </div>

      <Link
        to="/d/$database/lens/$schema"
        params={{ database, schema }}
        className="mb-3 flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-semibold text-[var(--sea-ink)] no-underline hover:bg-[var(--surface-strong)]"
        title="How this schema is shaped: Group crossings, boundaries, and tables nothing references"
      >
        <span className="text-[10px] text-[var(--lagoon-deep)]">◈</span>
        Schema lens
        <span className="ml-auto text-[10px] font-normal text-[var(--sea-ink-soft)]">
          {tables.length} tables
        </span>
      </Link>

      {introspectQuery.isLoading && (
        <div className="px-2 py-1 text-xs text-[var(--sea-ink-soft)]">Loading...</div>
      )}

      {introspectQuery.error && (
        <div className="px-2 py-1 text-xs text-red-500">Failed: {String(introspectQuery.error)}</div>
      )}

      {!introspectQuery.isLoading && tables.length === 0 && (
        <div className="px-2 py-1 text-xs text-[var(--sea-ink-soft)]">No tables in {schema}.</div>
      )}

      {view === 'changed' && (
        <ChangedList
          database={database}
          schema={schema}
          activeTable={activeTable}
          entries={changed}
          isLoading={activityQuery.isLoading}
          error={activityQuery.error}
          statsReset={activityQuery.data?.statsReset ?? null}
        />
      )}

      {view === 'grouped' && (
      <ul className="space-y-1">
        {visibleGroups.map((g, idx) => {
          const isUngrouped = g.name === ''
          const groupKey = isUngrouped ? `__solo__${g.tables[0]?.name ?? idx}` : g.name
          const isOpen = isUngrouped || !!filter || expanded.has(g.name)
          const isUncat = g.name === UNCATEGORIZED_GROUP_NAME
          return (
            <li key={groupKey}>
              {!isUngrouped && (
                <button
                  type="button"
                  onClick={() => toggle(g.name)}
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
                  title={g.description || undefined}
                >
                  <span
                    className={`text-[10px] text-[var(--sea-ink-soft)] transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  >
                    &#9654;
                  </span>
                  <span className={isUncat ? 'italic text-[var(--sea-ink-soft)]' : undefined}>
                    {g.name}
                  </span>
                  <span className="ml-auto text-[10px] text-[var(--sea-ink-soft)]">
                    {g.tables.length}
                  </span>
                </button>
              )}

              {isOpen && (
                <ul className={isUngrouped ? '' : 'ml-3 mt-0.5'}>
                  {g.tables.map((t) => {
                    const isActive = t.name === activeTable
                    return (
                      <li key={t.name}>
                        <Link
                          to="/d/$database/t/$schema/$table"
                          params={{ database, schema, table: t.name }}
                          className={`group flex items-center gap-2 rounded px-1.5 py-0.5 text-[12px] no-underline transition ${
                            isActive
                              ? 'bg-[rgba(79,184,178,0.18)] text-[var(--lagoon-deep)]'
                              : 'text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]'
                          }`}
                        >
                          <span className="truncate" title={nameText(t.name)}>
                            <TableName table={t.name} />
                          </span>
                          {/* A view has no rows of its own, so its row slot says
                              what it is instead of claiming a count of zero. */}
                          <span className="ml-auto shrink-0 text-[10px] text-[var(--sea-ink-soft)] opacity-70 group-hover:opacity-100">
                            {t.kind === 'view' ? 'view' : formatRowCount(t.rowCount)}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      )}
      </div>

      <ResizeHandle width={width} dragging={dragging} setDragging={setDragging} resizeTo={resizeTo} />
    </aside>
  )
}

/**
 * The sidebar's right edge, dragged.
 *
 * A `separator` rather than a decoration: it carries the width it is reporting,
 * and the arrow keys move it, because a control that only answers to a drag is
 * one nobody without a mouse can reach. Double-click puts it back where it
 * started — the cheapest undo for a drag that went too far.
 */
function ResizeHandle({
  width,
  dragging,
  setDragging,
  resizeTo,
}: {
  width: number
  dragging: boolean
  setDragging: (next: boolean) => void
  resizeTo: (next: number) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the table list"
      aria-valuenow={width}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      tabIndex={0}
      title="Drag to resize — double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault()
        // Capture, so a pointer that outruns the 4px strip keeps reporting here
        // instead of being swallowed by whatever it slid over.
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (!dragging) return
        const left = e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0
        resizeTo(e.clientX - left)
      }}
      onPointerUp={(e) => {
        if (!dragging) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        setDragging(false)
      }}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => resizeTo(DEFAULT_SIDEBAR_WIDTH)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') resizeTo(width - 16)
        else if (e.key === 'ArrowRight') resizeTo(width + 16)
        else if (e.key === 'Home') resizeTo(MIN_SIDEBAR_WIDTH)
        else if (e.key === 'End') resizeTo(MAX_SIDEBAR_WIDTH)
        else return
        e.preventDefault()
      }}
      className={`w-1 shrink-0 cursor-col-resize outline-none transition-colors ${
        dragging
          ? 'bg-[var(--lagoon)]'
          : 'bg-transparent hover:bg-[var(--lagoon)]/50 focus-visible:bg-[var(--lagoon)]'
      }`}
    />
  )
}

function ViewChip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
        active
          ? 'border-[var(--lagoon)]/60 bg-[rgba(79,184,178,0.16)] text-[var(--sea-ink)]'
          : 'border-[var(--line)] text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * A flat list, deliberately: the question "what changed" is not a question about
 * the catalog's areas, and grouping the answer would bury it.
 */
function ChangedList({
  database,
  schema,
  activeTable,
  entries,
  isLoading,
  error,
  statsReset,
}: {
  database: string
  schema: string
  activeTable?: string
  entries: ReturnType<typeof rankByRecentChange>
  isLoading: boolean
  error: unknown
  statsReset: string | null
}) {
  // Read once per render rather than per row, so every age on screen is measured
  // from the same instant.
  const now = Date.now()

  if (isLoading) {
    return <div className="px-2 py-1 text-xs text-[var(--sea-ink-soft)]">Reading statistics...</div>
  }
  if (error) {
    return <div className="px-2 py-1 text-xs text-red-500">Failed: {String(error)}</div>
  }
  if (entries.length === 0) {
    return (
      <div className="space-y-1 px-2 py-1 text-xs text-[var(--sea-ink-soft)]">
        <p>Nothing changed since these tables were last analyzed.</p>
        {statsReset && (
          <p className="text-[10px]">Counters reset {new Date(statsReset).toLocaleString()}.</p>
        )}
      </div>
    )
  }

  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => {
        const isActive = entry.table === activeTable
        return (
          <li key={entry.table}>
            <Link
              to="/d/$database/t/$schema/$table"
              params={{ database, schema, table: entry.table }}
              title={describeChange(entry, now)}
              className={`group flex items-center gap-2 rounded px-1.5 py-0.5 text-[12px] no-underline transition ${
                isActive
                  ? 'bg-[rgba(79,184,178,0.18)] text-[var(--lagoon-deep)]'
                  : 'text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]'
              }`}
            >
              <span className="truncate">
                <TableName table={entry.table} />
              </span>
              {/* The count, not a time: the timestamp belongs to the ANALYZE it
                  is counted from, and lives in the row's title. */}
              <span className="ml-auto shrink-0 text-[10px] text-[var(--sea-ink-soft)] opacity-70 group-hover:opacity-100">
                {formatMods(entry.modsSinceAnalyze)}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function formatRowCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
