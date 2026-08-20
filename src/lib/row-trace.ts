import {
  conventionRuleFor,
  edgeKey,
  isReferenceColumn,
  resolveEdgesByColumn,
} from '#/lib/schema-graph'
import type { CandidateEdge, DeclaredEdgeInput, LiveColumn } from '#/lib/schema-graph'
import type { EdgeBasis, SchemaMap } from '#/lib/types'

/**
 * The trace view's edges (BUILD-SPEC §2.2, §5.2).
 *
 * The trace is the row page extended, so it cannot afford the whole-schema merge
 * behind the lens — it needs the merged edges for *one* table. That means a
 * scoped merge, but the precedence rule is shared with `mergeSchemaGraph`
 * (`resolveEdgesByColumn`) so the two views can never disagree about where a
 * column points.
 *
 * The subtle part is precedence for *incoming* convention edges. A rule saying
 * `project_id → app_project.id` must not apply to a table whose
 * `project_id` has a declared or model edge pointing somewhere else — so the
 * candidate set deliberately includes those competing edges even though they do
 * not touch the row's table, and lets precedence drop the convention guess.
 */

export interface TraceCandidateNames {
  /** Column names to check for existence across the schema. */
  columnNames: string[]
  /** Tables whose row count, indexes and existence the merge needs. */
  tableNames: string[]
}

/**
 * What the scoped merge needs from the database, derived without touching it.
 * Computed first so all the metadata queries can be filtered and run in parallel.
 */
export function traceCandidateNames(
  table: string,
  tableColumns: readonly LiveColumn[],
  tablePkColumn: string | null,
  declaredEdges: readonly DeclaredEdgeInput[],
  map: SchemaMap | null,
): TraceCandidateNames {
  const columnNames = new Set<string>()
  const tableNames = new Set<string>([table])

  for (const e of declaredEdges) {
    if (e.fromTable === table || e.toTable === table) {
      tableNames.add(e.fromTable)
      tableNames.add(e.toTable)
    }
  }

  for (const e of map?.edges ?? []) {
    if (e.basis !== 'model') continue
    if (e.toTable === table) {
      columnNames.add(e.fromColumn)
      tableNames.add(e.fromTable)
    }
    if (e.fromTable === table) tableNames.add(e.toTable)
  }

  // Rules pointing *at* this table: every live column of that name is a candidate.
  for (const [column, target] of Object.entries(map?.conventions.byColumn ?? {})) {
    if (target.startsWith(`${table}.`)) columnNames.add(column)
  }
  for (const [key, target] of Object.entries(map?.conventions.byTableColumn ?? {})) {
    if (!target.startsWith(`${table}.`)) continue
    const dot = key.lastIndexOf('.')
    if (dot <= 0) continue
    tableNames.add(key.slice(0, dot))
    columnNames.add(key.slice(dot + 1))
  }

  // Rules pointing *away* from this table need their target table checked.
  for (const c of tableColumns) {
    if (!isReferenceColumn(c.name, tablePkColumn)) continue
    const target = conventionRuleFor(map, table, c.name)
    if (target) tableNames.add(target.table)
  }

  return { columnNames: [...columnNames].sort(), tableNames: [...tableNames].sort() }
}

export interface TraceMergeInput {
  table: string
  tableColumns: readonly LiveColumn[]
  tablePkColumn: string | null
  /** Every declared FK in the schema — cheap since the `pg_constraint` rewrite. */
  declaredEdges: readonly DeclaredEdgeInput[]
  map: SchemaMap | null
  /** `table.column` → nullability, for the candidate columns of other tables. */
  otherLiveColumns: ReadonlyMap<string, boolean>
  /** Tables confirmed to exist, so drift cannot produce a dead link. */
  liveTables: ReadonlySet<string>
  /** The catalog's own joins, when this table lives in the schema `pg_class`
   *  does. Empty everywhere else. */
  catalogEdges: readonly CandidateEdge[]
}

export type TraceEdge = CandidateEdge

export interface TableEdges {
  /** Columns of this table that point somewhere — the steerable hops. */
  outgoing: TraceEdge[]
  /** Columns of other tables that point here — the incoming references. */
  incoming: TraceEdge[]
}

export function mergeTableEdges(input: TraceMergeInput): TableEdges {
  const { table, tableColumns, tablePkColumn, declaredEdges, map } = input

  const ownColumns = new Set(tableColumns.map((c) => c.name))
  /**
   * An inferred edge has to prove its source column exists. A declared one does
   * not: the constraint is the proof, and the candidate column list is only
   * gathered for the columns inference wants to guess about.
   */
  const columnExists = (t: string, c: string): boolean =>
    t === table ? ownColumns.has(c) : input.otherLiveColumns.has(edgeKey(t, c))

  const candidates: CandidateEdge[] = []
  const push = (e: CandidateEdge) => {
    if (!input.liveTables.has(e.toTable)) return
    if (e.basis !== 'declared' && !columnExists(e.fromTable, e.fromColumn)) return
    candidates.push(e)
  }

  for (const e of declaredEdges) push({ ...e, basis: 'declared' })

  // The catalog's own joins, which no constraint declares. The lens merges these
  // too; a row page that skipped them would disagree with the diagram drawn from
  // the same schema.
  for (const e of input.catalogEdges) push({ ...e, basis: 'catalog' })

  for (const e of map?.edges ?? []) {
    if (e.basis !== 'model') continue
    push({ ...e, basis: 'model' })
  }

  // Convention, away from this table.
  for (const c of tableColumns) {
    if (!isReferenceColumn(c.name, tablePkColumn)) continue
    const target = conventionRuleFor(map, table, c.name)
    if (!target) continue
    push({
      fromTable: table,
      fromColumn: c.name,
      toTable: target.table,
      toColumn: target.column,
      basis: 'convention',
    })
  }

  // Convention, towards this table: any live column matching a rule that targets it.
  for (const key of input.otherLiveColumns.keys()) {
    const dot = key.lastIndexOf('.')
    if (dot <= 0) continue
    const fromTable = key.slice(0, dot)
    const fromColumn = key.slice(dot + 1)
    if (fromTable === table) continue
    const target = conventionRuleFor(map, fromTable, fromColumn)
    if (!target || target.table !== table) continue
    push({
      fromTable,
      fromColumn,
      toTable: target.table,
      toColumn: target.column,
      basis: 'convention',
    })
  }

  const resolved = [...resolveEdgesByColumn(candidates).values()]

  const byColumn = (a: TraceEdge, b: TraceEdge) =>
    a.fromTable.localeCompare(b.fromTable) || a.fromColumn.localeCompare(b.fromColumn)

  return {
    outgoing: resolved
      .filter((e) => e.fromTable === table)
      .sort((a, b) => a.fromColumn.localeCompare(b.fromColumn)),
    incoming: resolved.filter((e) => e.toTable === table).sort(byColumn),
  }
}

/**
 * Whether an incoming reference can be counted eagerly (BUILD-SPEC §5.2).
 *
 * 45% of inferred columns are unindexed, so "not counted" is the common case, not
 * an edge case: counting them eagerly would mean a sequential scan per neighbour
 * on a row page that already fans out to as many as 144 tables.
 */
export type CountSkipReason = 'unindexed' | 'large' | 'timeout'

export function countSkipReason(
  indexed: boolean,
  rowCount: number,
  exactCountThreshold: number,
): CountSkipReason | null {
  if (!indexed) return 'unindexed'
  if (rowCount >= exactCountThreshold) return 'large'
  return null
}

/** `catalog` is documented by Postgres, not guessed — only the name-rule and
 *  model bases are inferences, and the label has to keep them apart. */
export function basisLabel(basis: EdgeBasis): string {
  if (basis === 'declared') return 'declared'
  if (basis === 'catalog') return 'catalog'
  return `inferred (${basis})`
}
