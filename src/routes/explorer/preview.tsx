import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import TableCard from '#/components/TableCard'
import { $getTables, $getAllTablesPreview, $getTablePreview } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import type { AllTablesPreview, TableData, TableInfo } from '#/lib/types'

export const Route = createFileRoute('/explorer/preview')({
  component: PreviewPage,
})

function getPrefix(name: string): string {
  const parts = name.split('_')
  if (parts.length <= 1) return ''
  // Use all but last segment as prefix
  return parts.slice(0, -1).join('_')
}

function groupTables(tables: TableInfo[]): { group: string; tables: TableInfo[] }[] {
  // Count how many tables share each prefix
  const prefixCount = new Map<string, number>()
  for (const t of tables) {
    const prefix = getPrefix(t.name)
    if (prefix) prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1)
  }

  // Only group if 2+ tables share a prefix
  const grouped = new Map<string, TableInfo[]>()
  const ungrouped: TableInfo[] = []

  for (const t of tables) {
    const prefix = getPrefix(t.name)
    if (prefix && (prefixCount.get(prefix) ?? 0) >= 2) {
      const list = grouped.get(prefix) ?? []
      list.push(t)
      grouped.set(prefix, list)
    } else {
      ungrouped.push(t)
    }
  }

  const result: { group: string; tables: TableInfo[] }[] = []

  // Ungrouped tables go first as individual entries
  for (const t of ungrouped) {
    result.push({ group: '', tables: [t] })
  }

  // Grouped tables
  for (const [prefix, list] of grouped) {
    result.push({ group: prefix, tables: list })
  }

  // Sort groups: ungrouped by their table name, grouped by prefix
  result.sort((a, b) => {
    const aName = a.group || a.tables[0].name
    const bName = b.group || b.tables[0].name
    return aName.localeCompare(bName)
  })

  return result
}

function PreviewPage() {
  const { isChecking, isConnected } = useConnectionGuard()
  const [filter, setFilter] = useState('')
  const [extraData, setExtraData] = useState<Record<string, TableData>>({})
  const [loadingMore, setLoadingMore] = useState<string | null>(null)
  const [prettyJson, setPrettyJson] = useState(true)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [sortBy, setSortBy] = useState<'name' | 'rows' | 'modified'>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const tablesQuery = useQuery({
    queryKey: ['tables'],
    queryFn: () => $getTables(),
    enabled: isConnected,
    staleTime: Infinity,
  })

  const previewQuery = useQuery({
    queryKey: ['allTablesPreview'],
    queryFn: () => $getAllTablesPreview(),
    enabled: isConnected && !!tablesQuery.data?.length,
    staleTime: Infinity,
  })

  const tables = tablesQuery.data ?? []
  const previews: AllTablesPreview = {
    ...(previewQuery.data ?? {}),
    ...extraData,
  }

  const filteredTables = tables
    .filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()))
    .filter((t) => !hideEmpty || t.rowCount > 0)
    .sort((a, b) => {
      let cmp = 0
      if (sortBy === 'rows') cmp = a.rowCount - b.rowCount
      else if (sortBy === 'modified') cmp = (a.lastModified ?? '').localeCompare(b.lastModified ?? '')
      else cmp = a.name.localeCompare(b.name)
      return sortAsc ? cmp : -cmp
    })

  const groups = useMemo(() => groupTables(filteredTables), [filteredTables])

  if (isChecking) {
    return <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">Checking connection...</div>
  }
  if (!isConnected) return null

  const toggleGroup = (prefix: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(prefix)) next.delete(prefix)
      else next.add(prefix)
      return next
    })
  }

  const handleLoadMore = async (tableName: string) => {
    const current = previews[tableName]
    if (!current) return
    setLoadingMore(tableName)
    try {
      const more = await $getTablePreview({
        data: { tableName, limit: current.rows.length + 10 },
      })
      setExtraData((prev) => ({ ...prev, [tableName]: more }))
    } finally {
      setLoadingMore(null)
    }
  }

  return (
    <main className="px-4 pb-8 pt-8">
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables..."
            className="w-full max-w-sm rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20"
          />
          <span className="text-sm text-[var(--sea-ink-soft)]">
            {filteredTables.length} table{filteredTables.length !== 1 ? 's' : ''}
          </span>
          <div className="ml-auto flex items-center gap-4">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'rows' | 'modified')}
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-sm text-[var(--sea-ink)] outline-none"
            >
              <option value="name">Sort: Name</option>
              <option value="rows">Sort: Row count</option>
              <option value="modified">Sort: Recently modified</option>
            </select>
            <button
              type="button"
              onClick={() => setSortAsc(!sortAsc)}
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-sm text-[var(--sea-ink)] hover:bg-[var(--surface)]"
              title={sortAsc ? 'Ascending' : 'Descending'}
            >
              {sortAsc ? '\u2191' : '\u2193'}
            </button>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--sea-ink-soft)]">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
                className="rounded border-[var(--line)]"
              />
              Hide empty
            </label>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--sea-ink-soft)]">
              <input
                type="checkbox"
                checked={prettyJson}
                onChange={(e) => setPrettyJson(e.target.checked)}
                className="rounded border-[var(--line)]"
              />
              Pretty JSON
            </label>
          </div>
        </div>

        {/* Loading / errors */}
        {tablesQuery.isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="island-shell h-14 animate-pulse rounded-xl" />
            ))}
          </div>
        )}

        {tablesQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load tables: {String(tablesQuery.error)}
          </div>
        )}

        {previewQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load preview data: {String(previewQuery.error)}
          </div>
        )}

        {/* Table groups */}
        {groups.map(({ group, tables: groupTables }) => {
          if (!group) {
            // Ungrouped single table
            const table = groupTables[0]
            return (
              <div key={table.name}>
                <TableCard
                  tableInfo={table}
                  tableData={previews[table.name]}
                  onLoadMore={() => handleLoadMore(table.name)}
                  isLoadingMore={loadingMore === table.name}
                  prettyJson={prettyJson}
                />
              </div>
            )
          }

          // Grouped tables
          const isExpanded = expandedGroups.has(group)
          const totalRows = groupTables.reduce((sum, t) => sum + t.rowCount, 0)

          return (
            <div key={group} className="rounded-xl border border-[var(--line)]/60">
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="sticky top-[40px] z-20 flex w-full items-center gap-3 rounded-t-xl bg-[var(--surface-strong)] px-4 py-2.5 text-left backdrop-blur-sm transition hover:bg-[var(--surface)]"
              >
                <span className={`text-xs text-[var(--sea-ink-soft)] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                  &#9654;
                </span>
                <span className="font-semibold text-[var(--sea-ink)]">{group}_*</span>
                <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2 py-0.5 text-xs font-medium text-[var(--lagoon-deep)]">
                  {groupTables.length} tables
                </span>
                <span className="text-xs text-[var(--sea-ink-soft)]">
                  {totalRows.toLocaleString()} total rows
                </span>
              </button>

              {!isExpanded ? (
                <div className="p-2">
                  <TableCard
                    tableInfo={groupTables[0]}
                    tableData={previews[groupTables[0].name]}
                    onLoadMore={() => handleLoadMore(groupTables[0].name)}
                    isLoadingMore={loadingMore === groupTables[0].name}
                    prettyJson={prettyJson}
                  />
                </div>
              ) : (
                <div className="space-y-2 p-2">
                  {groupTables.map((table) => (
                    <TableCard
                      key={table.name}
                      tableInfo={table}
                      tableData={previews[table.name]}
                      onLoadMore={() => handleLoadMore(table.name)}
                      isLoadingMore={loadingMore === table.name}
                      prettyJson={prettyJson}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </main>
  )
}
