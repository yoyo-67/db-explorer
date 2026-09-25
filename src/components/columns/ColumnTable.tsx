import { Link } from '@tanstack/react-router'
import BasisTag from '#/components/lens/BasisTag'
import TableName from '#/components/TableName'
import { isUnindexedReference } from '#/lib/column-search'
import type { ColumnEntry } from '#/lib/column-search'
import { encodeConditions } from '#/lib/filter-model'
import { estimateDistinct, formatPercent } from '#/lib/inspect/stats'

/** Rendered rows past this ask for a narrower search instead of a longer page. */
export const MAX_ROWS = 1000

/**
 * One row per column. Every table name links to the table, and the column name
 * links to that table filtered to rows where the column is set. That's the
 * question that usually follows "which table has this".
 */
export default function ColumnTable({
  database,
  schema,
  entries,
  graphLoading,
}: {
  database: string
  schema: string
  entries: ColumnEntry[]
  graphLoading: boolean
}) {
  const shown = entries.slice(0, MAX_ROWS)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12px]">
        <thead className="text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
          <tr>
            <th className="py-1 pr-3">Column</th>
            <th className="py-1 pr-3">Table</th>
            <th className="py-1 pr-3">Type</th>
            <th className="py-1 pr-3">Null?</th>
            <th className="py-1 pr-3">References</th>
            <th className="py-1 pr-3">Indexed</th>
            <th className="py-1 pr-3 text-right">Null %</th>
            <th className="py-1 pr-3 text-right">Distinct</th>
            <th className="py-1">Comment</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((entry) => (
            <ColumnRow
              key={`${entry.table}.${entry.column}`}
              database={database}
              schema={schema}
              entry={entry}
              graphLoading={graphLoading}
            />
          ))}
        </tbody>
      </table>
      {entries.length > MAX_ROWS && (
        <p className="mt-2 text-[11px] text-[var(--sea-ink-soft)]">
          Showing {MAX_ROWS.toLocaleString('en-US')} of {entries.length.toLocaleString('en-US')} —
          narrow the search to see the rest.
        </p>
      )}
    </div>
  )
}

function ColumnRow({
  database,
  schema,
  entry,
  graphLoading,
}: {
  database: string
  schema: string
  entry: ColumnEntry
  graphLoading: boolean
}) {
  const facet = entry.facet
  const distinct =
    facet?.nDistinctRaw === null || facet?.nDistinctRaw === undefined
      ? null
      : estimateDistinct(facet.nDistinctRaw, entry.rowCount ?? -1)
  const unindexed = isUnindexedReference(entry)

  return (
    <tr className="border-t border-[var(--line)] align-top">
      <td className="py-1 pr-3 font-mono">
        <Link
          to="/d/$database/t/$schema/$table"
          params={{ database, schema, table: entry.table }}
          search={{
            q: encodeConditions([
              { id: `columns-${entry.column}`, column: entry.column, op: 'notNull', values: [] },
            ]),
          }}
          title="Open the table, filtered to rows where this column is set"
          className="text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
        >
          {entry.column}
        </Link>
      </td>
      <td className="py-1 pr-3">
        <Link
          to="/d/$database/t/$schema/$table"
          params={{ database, schema, table: entry.table }}
          search={{}}
          className="hover:text-[var(--lagoon-deep)]"
        >
          <TableName table={entry.table} />
        </Link>
        {entry.group && (
          <span className="ml-1 text-[10px] text-[var(--sea-ink-soft)]">{entry.group}</span>
        )}
      </td>
      <td className="py-1 pr-3 font-mono text-[11px] text-[var(--sea-ink-soft)]">
        {entry.dataType}
      </td>
      <td className="py-1 pr-3">{entry.isNullable ? 'yes' : ''}</td>
      <td className="py-1 pr-3">
        {graphLoading ? (
          <span className="inline-block h-3 w-20 animate-pulse rounded bg-[var(--line)]" />
        ) : entry.reference ? (
          <span className="inline-flex items-center gap-1">
            <span className="font-mono text-[11px]">
              <TableName table={entry.reference.toTable} />.{entry.reference.toColumn}
            </span>
            <BasisTag basis={entry.reference.basis} />
          </span>
        ) : null}
      </td>
      <td className="py-1 pr-3">
        {facet === null ? (
          <span className="text-[var(--sea-ink-soft)]">—</span>
        ) : facet.index === 'lead' ? (
          'leads'
        ) : unindexed ? (
          <span
            className="text-[var(--destructive)]"
            title="References another table but no index leads with it — following the relation from the other side reads this whole table"
          >
            {facet.index === 'member' ? 'in' : 'none'} ⚠
          </span>
        ) : facet.index === 'member' ? (
          <span title="Appears after the first column of an index — cannot serve a lookup on this column alone">
            in
          </span>
        ) : (
          <span className="text-[var(--sea-ink-soft)]">none</span>
        )}
      </td>
      <td className="py-1 pr-3 text-right tabular-nums">
        {facet?.nullFrac === null || facet?.nullFrac === undefined ? (
          <span
            className="text-[var(--sea-ink-soft)]"
            title="Never analyzed — no statistics for this column"
          >
            —
          </span>
        ) : (
          formatPercent(facet.nullFrac)
        )}
      </td>
      <td className="py-1 pr-3 text-right tabular-nums">
        {distinct === null || distinct.count === null ? (
          <span className="text-[var(--sea-ink-soft)]">—</span>
        ) : distinct.kind === 'unique' ? (
          'unique'
        ) : (
          `~${distinct.count.toLocaleString('en-US')}`
        )}
      </td>
      <td className="py-1 text-[11px] text-[var(--sea-ink-soft)]">{facet?.comment ?? ''}</td>
    </tr>
  )
}
