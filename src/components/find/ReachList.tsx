import { Link } from '@tanstack/react-router'
import BasisTag from '#/components/lens/BasisTag'
import TableLink from '#/components/TableLink'
import { useTableNameText } from '#/components/TableName'
import { reachTableSearch } from '#/lib/find/find-search'
import { skipExplanation } from '#/lib/find/reach-plan'
import type { ReachSkip } from '#/lib/find/reach-plan'
import type { FindReach, FindReachEntry } from '#/lib/types'

/**
 * Stage two's answer: every column that references the owner, and whether this
 * value is in it.
 *
 * The list is not a search result — it is the reference graph, filtered to one
 * table and then counted where counting is affordable. That is why a row can say
 * "not counted": the column is a place the value could be whether or not anyone
 * has looked, and hiding the ones too expensive to check would turn an honest
 * list into a misleading one.
 *
 * Rows with a hit come first, then the counted zeroes, then everything not
 * counted — the reading order of the answer.
 */
export default function ReachList({
  reach,
  database,
  pending,
}: {
  reach: FindReach
  database: string
  pending: boolean
}) {
  const { entries, schema, value, owner, excludedByType } = reach
  // The owner appears in three sentences here; all three spell it the way the
  // rest of the app does.
  const ownerName = useTableNameText()(owner)
  const hits = entries.filter((entry) => (entry.total ?? 0) > 0)
  const counted = entries.filter((entry) => entry.total === 0)
  const uncounted = entries.filter((entry) => entry.total === null)
  const ordered = [...hits, ...counted, ...uncounted]

  return (
    <section className="island-shell rounded-xl">
      <header className="border-b border-[var(--line)] px-4 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold text-[var(--sea-ink)]">Where else</h2>
          <span className="text-[11px] text-[var(--sea-ink-soft)]">
            {pending
              ? 'counting…'
              : `${hits.length} of ${entries.length} columns referencing ${ownerName} hold it` +
                (uncounted.length > 0 ? `, ${uncounted.length} not counted` : '')}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--sea-ink-soft)]">
          The columns that reference {ownerName} on the merged graph — declared
          constraints and inferred relations alike, never conflated. Counted where
          an index leads with the column and the table is small enough; listed with
          the reason otherwise.
        </p>
      </header>
      <div className="space-y-1 px-4 py-3">
        {entries.length === 0 ? (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            Nothing in {schema} references {ownerName} on any basis. The row stands on
            its own — or the columns that point at it are named in a way no basis
            could resolve.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {ordered.map((entry) => (
              <ReachRow
                key={`${entry.fromTable}.${entry.fromColumn}`}
                entry={entry}
                schema={schema}
                database={database}
                value={value}
              />
            ))}
          </ul>
        )}
        {excludedByType > 0 && (
          <p className="pt-1 text-[10px] text-[var(--sea-ink-soft)]">
            {excludedByType} further{' '}
            {excludedByType === 1 ? 'column references' : 'columns reference'} {ownerName}{' '}
            but cannot hold a value of this type — a name-derived edge onto a column
            whose type disagrees.
          </p>
        )}
      </div>
    </section>
  )
}

function ReachRow({
  entry,
  schema,
  database,
  value,
}: {
  entry: FindReachEntry
  schema: string
  database: string
  value: string
}) {
  const hit = (entry.total ?? 0) > 0

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-[11px]">
      <TableLink schema={schema} table={entry.fromTable} />
      <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
        {entry.fromColumn}
      </span>
      <BasisTag basis={entry.basis} />
      {entry.total !== null ? (
        <span
          className={`tabular-nums ${
            hit ? 'font-semibold text-[var(--sea-ink)]' : 'text-[var(--sea-ink-soft)]'
          }`}
        >
          {entry.total.toLocaleString('en-US')} {entry.total === 1 ? 'row' : 'rows'}
        </span>
      ) : (
        <span
          title={
            entry.countSkipped === 'timeout'
              ? 'The count was affordable by the estimate and was not. Nothing was read.'
              : entry.countSkipped
                ? skipExplanation(entry.countSkipped as ReachSkip)
                : undefined
          }
          className="rounded-full border border-dashed border-[var(--line)] px-1.5 text-[10px] text-[var(--sea-ink-soft)]"
        >
          not counted{entry.countSkipped ? ` · ${entry.countSkipped}` : ''}
        </span>
      )}
      <span className="tabular-nums text-[10px] text-[var(--sea-ink-soft)]">
        of ~{entry.rowCount.toLocaleString('en-US')}
      </span>
      {/* Offered whether or not it was counted: the filtered table view is the
          answer for a column too big to count, and the reader chose to pay. */}
      <Link
        to="/d/$database/t/$schema/$table"
        params={{ database, schema, table: entry.fromTable }}
        search={reachTableSearch(entry.fromColumn, value)}
        className="rounded-full border border-[var(--chip-line)] px-1.5 text-[10px] text-[var(--palm)] transition hover:bg-[var(--link-bg-hover)]"
      >
        {hit ? 'open rows' : 'check'}
      </Link>
      <span className="text-[10px] text-[var(--sea-ink-soft)]">{entry.group}</span>
    </li>
  )
}
