import type { TableCatalog, TableInfo } from '#/lib/types'
import { matchesTableName } from '#/lib/table-label'

export interface CatalogGroup {
  name: string
  description: string
  order: number
  tables: TableInfo[]
}

export const UNCATEGORIZED_GROUP_NAME = 'Uncategorized'
export const UNCATEGORIZED_ORDER = 999

/** Derived groups sort after every curated one, before Uncategorized. */
export const DERIVED_ORDER = 900

export function groupTablesByCatalog(
  tables: TableInfo[],
  catalog: TableCatalog | undefined,
  /** Table → Django module group, the lens's second-choice grouping. */
  mapGroups?: Readonly<Record<string, string>>,
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
  // A table the catalog skipped is not automatically homeless: the map places
  // most of them by Django module, which is what the lens draws. Only what
  // neither source knows is genuinely Uncategorized.
  const derived = new Map<string, TableInfo[]>()
  const uncategorized: TableInfo[] = []

  for (const table of tables) {
    const idx = tableToGroup.get(table.name)
    if (idx !== undefined) {
      buckets[idx].tables.push(table)
      continue
    }
    const derivedGroup = mapGroups?.[table.name]
    if (derivedGroup) {
      const list = derived.get(derivedGroup) ?? []
      list.push(table)
      derived.set(derivedGroup, list)
      continue
    }
    uncategorized.push(table)
  }

  const result = buckets
    .filter((g) => g.tables.length > 0)
    .sort((a, b) => a.order - b.order)

  /**
   * One name is one group.
   *
   * Two sections with the same heading are not a grouping, they are a split — the
   * reader has to check both to know what is in "Uncategorized", and React sees
   * two children under one key. It happens for real: a generated catalog names
   * its leftover bucket `Uncategorized` too, and a Django module can share a name
   * with a curated group. The tables join the group that already exists instead.
   */
  const append = (group: CatalogGroup) => {
    const existing = result.find((g) => g.name === group.name)
    if (existing) {
      existing.tables.push(...group.tables)
      return
    }
    result.push(group)
  }

  for (const [name, groupTables] of [...derived].sort(([a], [b]) => a.localeCompare(b))) {
    append({
      name,
      description: 'Grouped from the Django module, not the catalog',
      order: DERIVED_ORDER,
      tables: groupTables,
    })
  }

  if (uncategorized.length > 0) {
    append({
      name: UNCATEGORIZED_GROUP_NAME,
      description: 'Tables neither the catalog nor schema-map.json places',
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

export function filterGroups(
  groups: CatalogGroup[],
  query: string,
  /** Table → Django model, so a search answers to the model name too. Omitted
   *  where the caller has no map, which is the same as a map that knows nothing. */
  models: Readonly<Record<string, string>> = {},
): CatalogGroup[] {
  if (!query) return groups
  const q = query.toLowerCase()
  return groups
    .map((g) => ({
      ...g,
      tables: g.tables.filter((t) => matchesTableName(t.name, models[t.name], q)),
    }))
    .filter((g) => g.tables.length > 0 || g.name.toLowerCase().includes(q))
}
