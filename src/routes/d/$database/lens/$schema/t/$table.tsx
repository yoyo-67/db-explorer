import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { useMemo } from 'react'
import BasisTag from '#/components/lens/BasisTag'
import LensNav from '#/components/lens/LensNav'
import RandomRow from '#/components/lens/RandomRow'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useLensGraph } from '#/hooks/useLensGraph'
import { validateLensSearch } from '#/lib/lens-search'
import { relationsForTable } from '#/lib/table-relations'
import { tableLabel } from '#/lib/table-label'
import type { LensSearch } from '#/lib/lens-search'
import type { RelatedTable, RelationEdge } from '#/lib/table-relations'
import type { SchemaGraphNode } from '#/lib/types'

export const Route = createFileRoute('/d/$database/lens/$schema/t/$table')({
  component: TableRelationsPage,
  validateSearch: validateLensSearch,
})

/**
 * One table's relations, the stop between the lens and its rows.
 *
 * Clicking a table in a drawing used to drop you straight into 50 rows of it,
 * which answers "what is in this table" and loses the question you clicked with:
 * what is it wired to. So the lens click lands here — outgoing edges, the incoming
 * ones nothing in the table itself would tell you, and only then a button to the
 * data. Everything is read off the graph the lens already fetched, so arriving from
 * a Group ring costs no round trip.
 */
function TableRelationsPage() {
  const database = useDatabaseParam()
  const { schema, table } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { isChecking, isConnected } = useConnectionGuard()

  const lens = useLensGraph(schema, {
    enabled: isConnected,
    damp: search.damp,
    basis: search.basis,
  })

  const relations = useMemo(
    () => relationsForTable(lens.edges, table),
    [lens.edges, table],
  )

  /**
   * The sample's foreign keys, from the graph rather than a fresh introspect: every
   * outgoing edge is a column of this table pointing somewhere, which is exactly
   * what `ColumnInfo.references` means.
   */
  const references = useMemo(() => {
    const map = new Map<string, { table: string; column: string }>()
    for (const related of relations.outgoing) {
      for (const e of related.edges) {
        map.set(e.column, { table: related.table, column: e.otherColumn })
      }
    }
    for (const e of relations.selfRefs) {
      map.set(e.column, { table, column: e.otherColumn })
    }
    return map
  }, [relations, table])

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  const node = lens.nodeByName.get(table)

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-4">
        <LensNav
          schema={schema}
          group={node?.group}
          table={table}
          damp={search.damp}
          basis={search.basis}
          dampKeys={lens.dampKeys}
          staleness={lens.graph?.staleness}
          edgeCount={lens.edges.length}
          totalEdges={lens.totalEdges}
          onChange={(next) =>
            navigate({
              to: '/d/$database/lens/$schema/t/$table',
              params: { database, schema, table },
              search: (prev) => ({ ...prev, ...next }),
            })
          }
        />

        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            {tableLabel(table, node?.model)}
          </h1>
          <span className="font-mono text-xs text-[var(--sea-ink-soft)]">
            {schema}.{table}
          </span>
          {node && <NodeFacts schema={schema} node={node} search={search} />}
          <Link
            to="/d/$database/t/$schema/$table"
            params={{ database, schema, table }}
            className="ml-auto rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-sm font-medium text-[var(--lagoon-deep)] no-underline hover:bg-[rgba(79,184,178,0.16)]"
          >
            Open data →
          </Link>
        </header>

        {search.basis && (
          <p className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-xs text-[var(--sea-ink)]">
            Filtered to <strong>{search.basis}</strong> edges only — relations on the
            other two bases are hidden, not absent.
          </p>
        )}

        {lens.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load the schema graph: {String(lens.error)}
          </div>
        )}

        {lens.isLoading && <div className="island-shell h-48 animate-pulse rounded-xl" />}

        {lens.graph && !node && (
          <p className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-xs text-[var(--sea-ink)]">
            No node named <span className="font-mono">{table}</span> in this schema's
            graph — the map may be stale, or the name wrong. Its rows are still one
            click away.
          </p>
        )}

        <RandomRow
          schema={schema}
          table={table}
          references={references}
          enabled={isConnected}
        />

        {lens.graph && node && (
          <>
            <RelationList
              title="References out"
              direction="out"
              hint="Columns of this table pointing at another. Follow one to read what a row of it belongs to."
              empty="This table references nothing — it is only ever a destination."
              schema={schema}
              search={search}
              table={table}
              related={relations.outgoing}
              edgeCount={relations.outgoingEdgeCount}
              nodeByName={lens.nodeByName}
            />

            <RelationList
              title="Referenced by"
              direction="in"
              hint="Tables pointing back at this one — the half no column of this table would tell you. An unindexed referencing column is a scan on every walk down it."
              empty="Nothing references this table."
              schema={schema}
              search={search}
              table={table}
              related={relations.incoming}
              edgeCount={relations.incomingEdgeCount}
              nodeByName={lens.nodeByName}
            />

            {relations.selfRefs.length > 0 && (
              <section className="island-shell rounded-xl">
                <header className="border-b border-[var(--line)] px-4 py-2">
                  <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
                    Self-references{' '}
                    <span className="text-xs font-normal text-[var(--sea-ink-soft)]">
                      {relations.selfRefs.length} — a hierarchy inside the table, not a
                      relation to another
                    </span>
                  </h2>
                </header>
                <ul className="divide-y divide-[var(--line)]/60">
                  {relations.selfRefs.map((e) => (
                    <li key={e.column} className="px-4 py-1">
                      <EdgeLine edge={e} direction="out" otherTable={table} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}

/** Group, kind, size and the count of reference columns no basis could resolve. */
function NodeFacts({
  schema,
  node,
  search,
}: {
  schema: string
  node: SchemaGraphNode
  search: LensSearch
}) {
  const database = useDatabaseParam()
  return (
    <>
      <Link
        to="/d/$database/lens/$schema/g/$group"
        params={{ database, schema, group: node.group }}
        search={{ ...search, focus: node.name }}
        className="rounded-full border border-[var(--chip-line)] px-2 py-0.5 text-[11px] text-[var(--sea-ink-soft)] no-underline hover:text-[var(--lagoon-deep)]"
        title={
          node.groupIsDerived
            ? 'Group taken from the Django module — the hand catalog does not place this table yet.'
            : 'Curated Group'
        }
      >
        {node.group}
        {node.groupIsDerived && ' *'}
      </Link>
      {node.kind === 'view' && (
        <span className="text-[11px] italic text-[var(--sea-ink-soft)]">view</span>
      )}
      <span className="text-[11px] tabular-nums text-[var(--sea-ink-soft)]">
        {node.rowCount.toLocaleString()} rows
      </span>
      {node.unresolvedRefColumns > 0 && (
        <span
          className="text-[11px] text-[var(--sea-ink-soft)]"
          title="Columns that look like references (*_id) which no declared FK, Django relation or naming convention could resolve — relations this page cannot show you."
        >
          {node.unresolvedRefColumns} unresolved ref column
          {node.unresolvedRefColumns === 1 ? '' : 's'}
        </span>
      )}
    </>
  )
}

function RelationList({
  title,
  direction,
  hint,
  empty,
  schema,
  search,
  table,
  related,
  edgeCount,
  nodeByName,
}: {
  title: string
  direction: 'in' | 'out'
  hint: string
  empty: string
  schema: string
  search: LensSearch
  table: string
  related: RelatedTable[]
  edgeCount: number
  nodeByName: Map<string, SchemaGraphNode>
}) {
  const database = useDatabaseParam()
  return (
    <section className="island-shell rounded-xl">
      <header className="border-b border-[var(--line)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
          {title}{' '}
          <span className="text-xs font-normal tabular-nums text-[var(--sea-ink-soft)]">
            {related.length} table{related.length === 1 ? '' : 's'} · {edgeCount} edge
            {edgeCount === 1 ? '' : 's'}
          </span>
        </h2>
        <p className="text-[11px] text-[var(--sea-ink-soft)]">{hint}</p>
      </header>
      {related.length === 0 ? (
        <p className="px-4 py-2 text-xs text-[var(--sea-ink-soft)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]/60">
          {related.map((r) => (
            <li key={r.table} className="space-y-0.5 px-4 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to="/d/$database/lens/$schema/t/$table"
                  params={{ database, schema, table: r.table }}
                  search={search}
                  className="text-sm font-medium text-[var(--sea-ink)] no-underline hover:text-[var(--lagoon-deep)]"
                  title={`Relations of ${r.table}`}
                >
                  {tableLabel(r.table, nodeByName.get(r.table)?.model)}
                </Link>
                <span className="font-mono text-[11px] text-[var(--sea-ink-soft)]">
                  {r.table}
                </span>
                <GroupChip
                  schema={schema}
                  search={search}
                  node={nodeByName.get(r.table)}
                  self={nodeByName.get(table)?.group}
                />
                <span className="text-[10px] tabular-nums text-[var(--sea-ink-soft)]">
                  {nodeByName.get(r.table)?.rowCount.toLocaleString() ?? '?'} rows
                </span>
                <Link
                  to="/d/$database/t/$schema/$table"
                  params={{ database, schema, table: r.table }}
                  className="ml-auto rounded border border-[var(--line)] px-1.5 text-[10px] text-[var(--sea-ink-soft)] no-underline hover:text-[var(--lagoon-deep)]"
                  title={`Rows of ${r.table}`}
                >
                  data
                </Link>
              </div>
              <ul className="space-y-0.5">
                {r.edges.map((e) => (
                  <li key={e.column}>
                    <EdgeLine edge={e} direction={direction} otherTable={r.table} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The referencing side is always written first, so out and in read the same way:
 * `project_id → data_project.id`, `data_recording.unit_id → id`.
 */
function EdgeLine({
  edge,
  direction,
  otherTable,
}: {
  edge: RelationEdge
  direction: 'in' | 'out'
  otherTable: string
}) {
  const referencing =
    direction === 'out' ? edge.column : `${otherTable}.${edge.column}`
  const referenced =
    direction === 'out' ? `${otherTable}.${edge.otherColumn}` : edge.otherColumn
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 font-mono text-[11px] text-[var(--sea-ink-soft)]">
      <span className="text-[var(--sea-ink)]">{referencing}</span>
      <span>→</span>
      <span>{referenced}</span>
      <BasisTag basis={edge.basis} />
      {/* Only the mandatory case is worth a chip: nullable is the norm here, so
          "not null" is the one that changes how you read the relation. */}
      {!edge.nullable && (
        <span
          className="text-[10px] not-italic text-[var(--sea-ink-soft)]/80"
          title="The referencing column is NOT NULL — every row has this relation."
        >
          not null
        </span>
      )}
      {!edge.indexed && (
        <span
          className="text-[10px] text-[var(--sea-ink-soft)]/70"
          title="The referencing column leads no index — walking this relation is a sequential scan."
        >
          unindexed
        </span>
      )}
    </span>
  )
}

/** The other table's Group, dropped when it is the same one — no information. */
function GroupChip({
  schema,
  search,
  node,
  self,
}: {
  schema: string
  search: LensSearch
  node: SchemaGraphNode | undefined
  self: string | undefined
}) {
  const database = useDatabaseParam()
  if (!node || node.group === self) return null
  return (
    <Link
      to="/d/$database/lens/$schema/g/$group"
      params={{ database, schema, group: node.group }}
      search={{ ...search, focus: node.name }}
      className="rounded-full border border-[var(--chip-line)] px-1.5 text-[10px] text-[var(--sea-ink-soft)] no-underline hover:text-[var(--lagoon-deep)]"
    >
      {node.group}
    </Link>
  )
}
