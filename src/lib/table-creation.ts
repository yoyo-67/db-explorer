/**
 * "Which tables are new", as honestly as Postgres can answer it.
 *
 * Postgres keeps no creation timestamp for a relation. `pg_class` has no
 * created-at column, the statistics views time maintenance rather than DDL, and
 * the one clock on disk — the file's ctime, via `pg_stat_file` — needs a
 * superuser this app is not, and is reset by any rewrite anyway. What is left is
 * the oid: allocated from a cluster-wide counter when the relation is created,
 * kept through rewrites and TRUNCATE, so a higher oid means created later.
 *
 * That is an ORDER and not a date, and it is only offered as one: the view ranks
 * tables and shows no times. Two things break the order, and the caveat below
 * says so in the UI rather than in this comment alone — a dump and restore
 * reassigns every oid in restore order, and the counter wraps after four billion
 * allocations.
 */

import { matchesTableName } from '#/lib/table-label'

export interface TableCreationEntry {
  table: string
  /** `table` or `view` — what the sidebar already distinguishes. */
  kind: 'table' | 'view'
  /** `pg_class.oid`: creation order, not a time. */
  oid: number
}

/** Shown wherever the ranking is: the order is a proxy, and says so. */
export const CREATION_ORDER_CAVEAT =
  'Creation order as Postgres records it (oid). A dump and restore reassigns these.'

export interface CreationRankOptions {
  /** Tables the schema listing has a page for; others are dropped. */
  listed?: Set<string>
  /** The sidebar search box. */
  filter?: string
  /** Table → Django model, so the box answers to the model name too. */
  models?: Readonly<Record<string, string>>
}

/**
 * Newest-created first.
 *
 * Ties break by name so the list is stable between reads — two relations cannot
 * share an oid, but a filtered read can still hand back the same oid twice when
 * a schema is being rebuilt underneath it.
 */
export function rankByCreation(
  entries: TableCreationEntry[],
  options: CreationRankOptions = {},
): TableCreationEntry[] {
  const needle = options.filter?.trim() ?? ''
  return entries
    .filter((entry) => !options.listed || options.listed.has(entry.table))
    .filter((entry) => matchesTableName(entry.table, options.models?.[entry.table], needle))
    .sort((a, b) => b.oid - a.oid || a.table.localeCompare(b.table))
}

/**
 * How the sidebar orders tables. Grouped is the catalog's own structure; changed
 * asks the statistics views what has been written lately; new ranks by creation
 * order. It lives in the URL, so a link carries the view someone was reading in.
 */
export type SidebarView = 'grouped' | 'changed' | 'new'

/** Anything that is not one of the three views is the grouping. */
export function parseSidebarView(raw: unknown): SidebarView {
  return raw === 'changed' || raw === 'new' ? raw : 'grouped'
}

/** Absent for the default, so the plain table URL stays plain. */
export function formatSidebarView(view: SidebarView): string | undefined {
  return view === 'grouped' ? undefined : view
}
