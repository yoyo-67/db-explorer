import { Link } from '@tanstack/react-router'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { DAMP_OFF } from '#/lib/lens-search'
import type { EdgeBasis, SchemaGraphNode, SchemaGraphStaleness } from '#/lib/types'
import LensTableSearch from '#/components/lens/LensTableSearch'
import TableName from '#/components/TableName'

/**
 * Shared chrome for the three structural views: where you are, how to get to the
 * other two, the two URL knobs, and the staleness deltas — which stay visible
 * everywhere (BUILD-SPEC §4.4) so a stale map can never be mistaken for a thin
 * schema.
 */
export default function LensNav({
  schema,
  group,
  table,
  tables,
  damp,
  basis,
  dampKeys,
  staleness,
  edgeCount,
  totalEdges,
  onChange,
}: {
  schema: string
  group?: string
  /** Set on a table's relations view — the deepest crumb. */
  table?: string
  /** Every node in the graph, so the search can reach outside this view. */
  tables: readonly SchemaGraphNode[]
  damp: string | undefined
  basis: EdgeBasis | undefined
  dampKeys: string[]
  staleness: SchemaGraphStaleness | undefined
  edgeCount: number
  totalEdges: number
  onChange: (next: { damp?: string | undefined; basis?: EdgeBasis | undefined }) => void
}) {
  const database = useDatabaseParam()
  const damping = dampKeys.length > 0
  return (
    <div className="space-y-2">
      <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--sea-ink-soft)]">
        <span className="font-semibold uppercase tracking-wide text-[10px] text-[var(--kicker)]">
          Lens
        </span>
        <Link
          to="/d/$database/lens/$schema"
          params={{ database, schema }}
          search={{ damp, basis }}
          className="hover:text-[var(--lagoon-deep)]"
          activeOptions={{ exact: true }}
          activeProps={{ className: 'text-[var(--sea-ink)] font-medium' }}
        >
          {schema} · groups
        </Link>
        <span>/</span>
        <Link
          to="/d/$database/lens/$schema/orphans"
          params={{ database, schema }}
          search={{ damp, basis }}
          className="hover:text-[var(--lagoon-deep)]"
          activeProps={{ className: 'text-[var(--sea-ink)] font-medium' }}
        >
          no references found
        </Link>
        {group && (
          <>
            <span>/</span>
            {table ? (
              <Link
                to="/d/$database/lens/$schema/g/$group"
                params={{ database, schema, group }}
                search={{ damp, basis, focus: table }}
                className="hover:text-[var(--lagoon-deep)]"
              >
                {group}
              </Link>
            ) : (
              <span className="text-[var(--sea-ink)]">{group}</span>
            )}
          </>
        )}
        {table && (
          <>
            <span>/</span>
            <span className="font-mono text-[var(--sea-ink)]">
              <TableName table={table} />
            </span>
          </>
        )}
      </nav>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--sea-ink-soft)]">
        <LensTableSearch schema={schema} tables={tables} damp={damp} basis={basis} />

        <label className="flex items-center gap-1.5" title={DAMP_HINT}>
          <input
            type="checkbox"
            checked={damping}
            onChange={(e) => onChange({ damp: e.target.checked ? undefined : DAMP_OFF })}
            className="rounded border-[var(--line)]"
          />
          Damp historical + aggregation
        </label>

        <label className="flex items-center gap-1.5">
          Basis
          <select
            value={basis ?? ''}
            onChange={(e) =>
              onChange({ basis: (e.target.value || undefined) as EdgeBasis | undefined })
            }
            className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-1.5 py-0.5 text-xs text-[var(--sea-ink)] outline-none"
          >
            <option value="">every basis</option>
            <option value="declared">declared only</option>
            <option value="catalog">catalog only</option>
            <option value="model">model only</option>
            <option value="convention">convention only</option>
          </select>
        </label>

        <span className="tabular-nums">
          {edgeCount === totalEdges
            ? `${edgeCount} edges`
            : `${edgeCount} of ${totalEdges} edges`}
        </span>

        {staleness && <StalenessBadge schema={schema} staleness={staleness} />}
      </div>
    </div>
  )
}

const DAMP_HINT =
  'Historical and Aggregation crossings are an order of magnitude larger than ' +
  'anything else (Historical → Auth is 54 rows of history_user_id). Undamped ' +
  'they set the colour scale and flatten every real signal.'

function StalenessBadge({
  schema,
  staleness,
}: {
  schema: string
  staleness: SchemaGraphStaleness
}) {
  const database = useDatabaseParam()
  const unmapped = staleness.liveNotMapped.length
  const drift = staleness.mappedNotLive.length
  const derived = staleness.derivedGroupTables.length
  const clean = unmapped === 0 && drift === 0 && derived === 0
  return (
    <Link
      to="/d/$database/lens/$schema/orphans"
      params={{ database, schema }}
      className={`ml-auto rounded-full border px-2 py-0.5 tabular-nums no-underline ${
        clean
          ? 'border-[var(--line)] text-[var(--sea-ink-soft)]'
          : 'border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--sea-ink)]'
      }`}
      title={`${unmapped} live tables missing from schema-map.json (rerun the extractor) · ${drift} mapped tables no longer live · ${derived} tables grouped from their Django module rather than the catalog`}
    >
      map: {unmapped} unmapped · {drift} drift · {derived} derived
    </Link>
  )
}
