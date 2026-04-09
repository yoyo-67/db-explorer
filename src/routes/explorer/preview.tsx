import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import TableCard from '#/components/TableCard'
import { $getTables, $getAllTablesPreview, $getTablePreview, $getTableCatalog } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import type { AllTablesPreview, TableCatalog, TableData, TableInfo } from '#/lib/types'

export const Route = createFileRoute('/explorer/preview')({
  component: PreviewPage,
})

interface CatalogGroup {
  name: string
  description: string
  order: number
  tables: TableInfo[]
}

function groupTablesByCatalog(
  tables: TableInfo[],
  catalog: TableCatalog | undefined,
): CatalogGroup[] {
  if (!catalog || catalog.groups.length === 0) {
    // Fallback: prefix-based grouping
    return fallbackGroupTables(tables)
  }

  // Build a lookup: table name -> group index
  const tableToGroup = new Map<string, number>()
  for (let i = 0; i < catalog.groups.length; i++) {
    for (const tableName of catalog.groups[i].tables) {
      tableToGroup.set(tableName, i)
    }
  }

  // Distribute tables into groups
  const groupBuckets = catalog.groups.map((g) => ({
    name: g.name,
    description: g.description,
    order: g.order,
    tables: [] as TableInfo[],
  }))
  const uncategorized: TableInfo[] = []

  for (const table of tables) {
    const groupIdx = tableToGroup.get(table.name)
    if (groupIdx !== undefined) {
      groupBuckets[groupIdx].tables.push(table)
    } else {
      uncategorized.push(table)
    }
  }

  // Filter out empty groups and sort by order
  const result = groupBuckets
    .filter((g) => g.tables.length > 0)
    .sort((a, b) => a.order - b.order)

  // Add uncategorized at the end
  if (uncategorized.length > 0) {
    result.push({
      name: 'Uncategorized',
      description: 'Tables not assigned to any group in table-catalog.json',
      order: 999,
      tables: uncategorized,
    })
  }

  return result
}

function fallbackGroupTables(tables: TableInfo[]): CatalogGroup[] {
  const prefixCount = new Map<string, number>()
  for (const t of tables) {
    const prefix = getPrefix(t.name)
    if (prefix) prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1)
  }

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

  const result: CatalogGroup[] = []

  for (const t of ungrouped) {
    result.push({ name: '', description: '', order: 0, tables: [t] })
  }

  for (const [prefix, list] of grouped) {
    result.push({ name: `${prefix}_*`, description: '', order: 0, tables: list })
  }

  result.sort((a, b) => {
    const aName = a.name || a.tables[0].name
    const bName = b.name || b.tables[0].name
    return aName.localeCompare(bName)
  })

  return result
}

function getPrefix(name: string): string {
  const parts = name.split('_')
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('_')
}

function PreviewPage() {
  const { isChecking, isConnected } = useConnectionGuard()
  const [filter, setFilter] = useState('')
  const [extraData, setExtraData] = useState<Record<string, TableData>>({})
  const [loadingMore, setLoadingMore] = useState<string | null>(null)
  const [prettyJson, setPrettyJson] = useState(true)
  const [emptyFilter, setEmptyFilter] = useState<'hide' | 'only' | 'all'>('hide')
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

  const catalogQuery = useQuery({
    queryKey: ['tableCatalog'],
    queryFn: () => $getTableCatalog(),
    staleTime: Infinity,
  })

  const tables = tablesQuery.data ?? []
  const catalog = catalogQuery.data
  const previews: AllTablesPreview = {
    ...(previewQuery.data ?? {}),
    ...extraData,
  }

  const filteredTables = tables
    .filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()))
    .filter((t) => {
      if (emptyFilter === 'hide') return t.rowCount > 0
      if (emptyFilter === 'only') return t.rowCount === 0
      return true
    })
    .sort((a, b) => {
      let cmp = 0
      if (sortBy === 'rows') cmp = a.rowCount - b.rowCount
      else if (sortBy === 'modified') cmp = (a.lastModified ?? '').localeCompare(b.lastModified ?? '')
      else cmp = a.name.localeCompare(b.name)
      return sortAsc ? cmp : -cmp
    })

  const hasCatalog = !!catalog && catalog.groups.length > 0
  const groups = useMemo(
    () => groupTablesByCatalog(filteredTables, catalog),
    [filteredTables, catalog],
  )

  if (isChecking) {
    return <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">Checking connection...</div>
  }
  if (!isConnected) return null

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
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

  const tableDescription = (name: string) => catalog?.tables[name]

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
          {hasCatalog && (
            <span className="rounded-full bg-[rgba(79,184,178,0.08)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)]">
              {groups.length} groups
            </span>
          )}
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
            <select
              value={emptyFilter}
              onChange={(e) => setEmptyFilter(e.target.value as 'hide' | 'only' | 'all')}
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-sm text-[var(--sea-ink)] outline-none"
            >
              <option value="hide">Hide empty</option>
              <option value="only">Only empty</option>
              <option value="all">All tables</option>
            </select>
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
        {groups.map(({ name, description, tables: groupTables }) => {
          // Ungrouped single table (fallback mode only)
          if (!name) {
            const table = groupTables[0]
            return (
              <div key={table.name}>
                <TableCard
                  tableInfo={table}
                  tableData={previews[table.name]}
                  onLoadMore={() => handleLoadMore(table.name)}
                  isLoadingMore={loadingMore === table.name}
                  prettyJson={prettyJson}
                  description={tableDescription(table.name)}
                />
              </div>
            )
          }

          // Catalog group or prefix group
          const isExpanded = expandedGroups.has(name)
          const totalRows = groupTables.reduce((sum, t) => sum + t.rowCount, 0)

          return (
            <div key={name} className="rounded-xl border border-[var(--line)]/60">
              <button
                type="button"
                onClick={() => toggleGroup(name)}
                className="sticky top-[40px] z-20 flex w-full items-center gap-3 rounded-t-xl bg-[var(--surface-strong)] px-4 py-2.5 text-left backdrop-blur-sm transition hover:bg-[var(--surface)]"
              >
                <span className={`text-xs text-[var(--sea-ink-soft)] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                  &#9654;
                </span>
                <span className="font-semibold text-[var(--sea-ink)]">{name}</span>
                <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2 py-0.5 text-xs font-medium text-[var(--lagoon-deep)]">
                  {groupTables.length} tables
                </span>
                <span className="text-xs text-[var(--sea-ink-soft)]">
                  {totalRows.toLocaleString()} total rows
                </span>
                {description && (
                  <span className="ml-auto text-xs italic text-[var(--sea-ink-soft)] opacity-70">
                    {description}
                  </span>
                )}
              </button>

              {!isExpanded ? (
                <div className="p-2">
                  <TableCard
                    tableInfo={groupTables[0]}
                    tableData={previews[groupTables[0].name]}
                    onLoadMore={() => handleLoadMore(groupTables[0].name)}
                    isLoadingMore={loadingMore === groupTables[0].name}
                    prettyJson={prettyJson}
                    description={tableDescription(groupTables[0].name)}
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
                      description={tableDescription(table.name)}
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
