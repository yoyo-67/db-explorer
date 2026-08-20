import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { useMemo } from 'react'
import LensNav from '#/components/lens/LensNav'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { useLensGraph } from '#/hooks/useLensGraph'
import { validateLensSearch } from '#/lib/lens-search'
import { findOrphans } from '#/lib/schema-graph-metrics'
import type { SchemaGraphNode, SchemaGraphStaleness } from '#/lib/types'

export const Route = createFileRoute('/d/$database/lens/$schema/orphans')({
  component: OrphansPage,
  validateSearch: validateLensSearch,
})

/**
 * Orphans as a plain list (BUILD-SPEC §4.3) — a node with no edges has nothing to
 * draw, so forcing it into a graph would be theatre. The label is "no references
 * found", never "dead": application code can reach a table through a column no
 * basis ever saw.
 *
 * The staleness panel (§4.4) lives here too, because this is the page where a
 * stale map would be most likely to be mistaken for a finding.
 */
function OrphansPage() {
  const database = useDatabaseParam()
  const { schema } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { isChecking, isConnected } = useConnectionGuard()

  const lens = useLensGraph(schema, {
    enabled: isConnected,
    damp: search.damp,
    basis: search.basis,
  })

  const orphans = useMemo(
    () => findOrphans(lens.graph?.nodes ?? [], lens.edges),
    [lens.graph, lens.edges],
  )

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-4">
        <LensNav
          schema={schema}
          damp={search.damp}
          basis={search.basis}
          dampKeys={lens.dampKeys}
          staleness={lens.graph?.staleness}
          edgeCount={lens.edges.length}
          totalEdges={lens.totalEdges}
          onChange={(next) =>
            navigate({
              to: '/d/$database/lens/$schema/orphans',
              params: { database, schema },
              search: (prev) => ({ ...prev, ...next }),
            })
          }
        />

        <header className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            No references found
          </h1>
          <span className="text-xs text-[var(--sea-ink-soft)]">
            {orphans.candidates.length} tables with no edge in either direction on the
            merged graph
          </span>
        </header>

        {search.basis && (
          <p className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-2 text-xs text-[var(--sea-ink)]">
            Filtered to <strong>{search.basis}</strong> edges only, so this list is
            wider than the merged one. Declared-only would claim 76 orphans where the
            merged graph finds a dozen.
          </p>
        )}

        {lens.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load the schema graph: {String(lens.error)}
          </div>
        )}

        {lens.isLoading && <div className="island-shell h-48 animate-pulse rounded-xl" />}

        {lens.graph && (
          <>
            <NodeList
              schema={schema}
              nodes={orphans.candidates}
              empty="Every table is referenced or references something. Nothing to report."
              note="Application code can reach a table through a column the map never saw — this is a place to look, not a verdict."
            />

            <NodeList
              schema={schema}
              title="Framework-owned"
              nodes={orphans.framework}
              empty={null}
              note="Django, Celery and social-auth tables. Tagged rather than counted: they were never going to declare a relation into the app schema."
            />

            <NodeList
              schema={schema}
              title="Views"
              nodes={orphans.views}
              empty={null}
              note="A view cannot carry a constraint and nothing declares a foreign key to one, so an edge-free view says nothing about the schema."
            />

            <StalenessPanel schema={schema} staleness={lens.graph.staleness} />
          </>
        )}
      </div>
    </main>
  )
}

function NodeList({
  schema,
  title,
  nodes,
  empty,
  note,
}: {
  schema: string
  title?: string
  nodes: SchemaGraphNode[]
  empty: string | null
  note: string
}) {
  const database = useDatabaseParam()
  if (nodes.length === 0) {
    if (!empty) return null
    return <p className="text-xs text-[var(--sea-ink-soft)]">{empty}</p>
  }
  return (
    <section className="island-shell rounded-xl">
      {title && (
        <header className="border-b border-[var(--line)] px-4 py-2">
          <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
            {title}{' '}
            <span className="text-xs font-normal text-[var(--sea-ink-soft)]">
              {nodes.length}
            </span>
          </h2>
        </header>
      )}
      <ul className="grid gap-x-6 px-4 py-2 sm:grid-cols-2 lg:grid-cols-3">
        {nodes.map((n) => (
          <li
            key={n.name}
            className="flex items-baseline gap-2 py-0.5 font-mono text-[11px]"
          >
            <Link
              to="/d/$database/lens/$schema/t/$table"
              params={{ database, schema, table: n.name }}
              className="text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
            >
              {n.name}
            </Link>
            {n.kind === 'view' && (
              <span className="text-[10px] italic text-[var(--sea-ink-soft)]">view</span>
            )}
            <span className="ml-auto text-[10px] tabular-nums text-[var(--sea-ink-soft)]">
              {n.rowCount.toLocaleString()} rows
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-[var(--line)] px-4 py-2 text-[11px] text-[var(--sea-ink-soft)]">
        {note}
      </p>
    </section>
  )
}

/**
 * Three displayed deltas, not an assumption. The map is regenerated by hand and
 * that is deliberate — so the lens has to say out loud how far behind it is.
 */
function StalenessPanel({
  schema,
  staleness,
}: {
  schema: string
  staleness: SchemaGraphStaleness
}) {
  return (
    <section className="island-shell rounded-xl">
      <header className="border-b border-[var(--line)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
          Map coverage{' '}
          <span className="text-xs font-normal text-[var(--sea-ink-soft)]">
            {staleness.liveTableCount} live · {staleness.mapTableCount} mapped ·{' '}
            {staleness.catalogTableCount} curated
          </span>
        </h2>
      </header>
      <div className="grid gap-4 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        <Delta
          schema={schema}
          label="Live but unmapped"
          tables={staleness.liveNotMapped}
          hint="Rerun the extractor that writes schema-map.json"
        />
        <Delta
          schema={schema}
          label="Mapped but not live"
          tables={staleness.mappedNotLive}
          hint="Drift — the map names tables this database does not have."
          linkable={false}
        />
        <Delta
          schema={schema}
          label="Grouped from module"
          tables={staleness.derivedGroupTables}
          hint="Curation backlog: the module group is a backstop, the hand catalog stays authoritative."
        />
        <Delta
          schema={schema}
          label="No group at all"
          tables={staleness.ungroupedTables}
          hint="Neither the catalog nor a module knows these. Their edges are excluded from the matrix."
        />
      </div>
    </section>
  )
}

const MAX_LISTED = 12

function Delta({
  schema,
  label,
  tables,
  hint,
  linkable = true,
}: {
  schema: string
  label: string
  tables: string[]
  hint: string
  linkable?: boolean
}) {
  const database = useDatabaseParam()
  const shown = tables.slice(0, MAX_LISTED)
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-[var(--sea-ink)]">{label}</span>
        <span className="text-xs tabular-nums text-[var(--sea-ink-soft)]">
          {tables.length}
        </span>
      </div>
      <p className="text-[10px] leading-snug text-[var(--sea-ink-soft)]">{hint}</p>
      <ul className="space-y-0.5 font-mono text-[10px] text-[var(--sea-ink-soft)]">
        {shown.map((t) => (
          <li key={t} className="truncate">
            {linkable ? (
              <Link
                to="/d/$database/t/$schema/$table"
                params={{ database, schema, table: t }}
                className="hover:text-[var(--lagoon-deep)]"
              >
                {t}
              </Link>
            ) : (
              t
            )}
          </li>
        ))}
        {tables.length > shown.length && (
          <li className="opacity-70">+ {tables.length - shown.length} more</li>
        )}
      </ul>
    </div>
  )
}
