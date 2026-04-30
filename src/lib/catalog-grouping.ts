import type { TableCatalog, TableInfo } from '#/lib/types'

export interface CatalogGroup {
  name: string
  description: string
  order: number
  tables: TableInfo[]
}

export const UNCATEGORIZED_GROUP_NAME = 'Uncategorized'
export const UNCATEGORIZED_ORDER = 999

export function groupTablesByCatalog(
  tables: TableInfo[],
  catalog: TableCatalog | undefined,
): CatalogGroup[] {
  if (!catalog || catalog.groups.length === 0) {
    return fallbackGroupTables(tables)
  }

  const tableToGroup = new Map<string, number>()
  for (let i = 0; i < catalog.groups.length; i++) {
    for (const tableName of catalog.groups[i].tables) {
      tableToGroup.set(tableName, i)
    }
  }

  const buckets = catalog.groups.map((g) => ({
    name: g.name,
    description: g.description,
    order: g.order,
    tables: [] as TableInfo[],
  }))
  const uncategorized: TableInfo[] = []

  for (const table of tables) {
    const idx = tableToGroup.get(table.name)
    if (idx !== undefined) {
      buckets[idx].tables.push(table)
    } else {
      uncategorized.push(table)
    }
  }

  const result = buckets
    .filter((g) => g.tables.length > 0)
    .sort((a, b) => a.order - b.order)

  if (uncategorized.length > 0) {
    result.push({
      name: UNCATEGORIZED_GROUP_NAME,
      description: 'Tables not assigned to any group in table-catalog.json',
      order: UNCATEGORIZED_ORDER,
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

export function filterGroups(groups: CatalogGroup[], query: string): CatalogGroup[] {
  if (!query) return groups
  const q = query.toLowerCase()
  return groups
    .map((g) => ({
      ...g,
      tables: g.tables.filter((t) => t.name.toLowerCase().includes(q)),
    }))
    .filter((g) => g.tables.length > 0 || g.name.toLowerCase().includes(q))
}
