import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { $getTableCatalog, $introspect } from '#/server/api'
import {
  filterGroups,
  groupTablesByCatalog,
  UNCATEGORIZED_GROUP_NAME,
} from '#/lib/catalog-grouping'

const EXPANDED_KEY = 'sidebar:expandedGroups'

export default function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const match = pathname.match(/^\/t\/([^/]+)(?:\/([^/]+))?/)
  if (!match) return null
  const schema = decodeURIComponent(match[1])
  const activeTable = match[2] ? decodeURIComponent(match[2]) : undefined
  return <SidebarBody schema={schema} activeTable={activeTable} />
}

function SidebarBody({ schema, activeTable }: { schema: string; activeTable?: string }) {
  const [filter, setFilter] = useState('')
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
    queryKey: ['introspect', schema],
    queryFn: () => $introspect({ data: { schema } }),
    staleTime: Infinity,
  })

  const catalogQuery = useQuery({
    queryKey: ['tableCatalog'],
    queryFn: () => $getTableCatalog(),
    staleTime: Infinity,
  })

  const tables = introspectQuery.data?.tables ?? []
  const groups = useMemo(
    () => groupTablesByCatalog(tables, catalogQuery.data),
    [tables, catalogQuery.data],
  )
  const visibleGroups = useMemo(() => filterGroups(groups, filter), [groups, filter])

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

  return (
    <aside className="sticky top-[44px] h-[calc(100vh-44px)] w-64 shrink-0 overflow-y-auto border-r border-[var(--line)]/60 bg-[var(--surface)]/50 px-2 py-3">
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search tables..."
        className="mb-3 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2.5 py-1.5 text-xs text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
      />

      {introspectQuery.isLoading && (
        <div className="px-2 py-1 text-xs text-[var(--sea-ink-soft)]">Loading...</div>
      )}

      {introspectQuery.error && (
        <div className="px-2 py-1 text-xs text-red-500">Failed: {String(introspectQuery.error)}</div>
      )}

      {!introspectQuery.isLoading && tables.length === 0 && (
        <div className="px-2 py-1 text-xs text-[var(--sea-ink-soft)]">No tables in {schema}.</div>
      )}

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
                          to="/t/$schema/$table"
                          params={{ schema, table: t.name }}
                          className={`group flex items-center gap-2 rounded px-1.5 py-0.5 text-[12px] no-underline transition ${
                            isActive
                              ? 'bg-[rgba(79,184,178,0.18)] text-[var(--lagoon-deep)]'
                              : 'text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]'
                          }`}
                        >
                          <span className="truncate">{t.name}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-[var(--sea-ink-soft)] opacity-70 group-hover:opacity-100">
                            {formatRowCount(t.rowCount)}
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
    </aside>
  )
}

function formatRowCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
