import CopyButton from '#/components/CopyButton'
import PressureSection, { CappedList, Chip, TableLink } from '#/components/pressure/PressureSection'
import { formatBytes } from '#/lib/pressure/bytes'
import { formatRelativeTime } from '#/lib/inspect/format'
import {
  createFkIndexSql,
  enforcesConstraint,
  indexAuditTotals,
  redundantIndexes,
  unindexedForeignKeys,
  unusedIndexes,
} from '#/lib/pressure/index-audit'
import type { ForeignKeyColumns, IndexEntry, SchemaPressure } from '#/lib/types'

/**
 * Three index findings, weakest claim first: an index nothing reads, an index
 * another one already covers, and a foreign key with nothing to lead its
 * lookups. Each row carries the statement that would fix it.
 */
export default function IndexSection({ pressure }: { pressure: SchemaPressure }) {
  const { schema, indexes, foreignKeys, statsReset } = pressure
  const totals = indexAuditTotals(indexes, foreignKeys)
  const unused = unusedIndexes(indexes)
  const redundant = redundantIndexes(indexes)
  const uncovered = unindexedForeignKeys(foreignKeys, indexes)

  return (
    <PressureSection
      id="indexes"
      title="Indexes"
      count={`${totals.indexCount} total · ${formatBytes(totals.unusedBytes)} unread`}
      rule="Usage comes from the cumulative scan counters, so every claim here is only as old as the last stats reset."
    >
      <div className="space-y-4">
        <p className="text-[11px] text-[var(--sea-ink-soft)]">
          Counters reset{' '}
          <span className="font-medium text-[var(--sea-ink)]">
            {statsReset ? formatRelativeTime(statsReset, Date.now()) : 'never (unknown)'}
          </span>
          {statsReset && ` (${statsReset.slice(0, 10)})`} — an index that looks unread may just be
          younger than that.
        </p>

        <Finding
          heading="Never scanned"
          note={`${totals.unusedCount} with a zero scan count · ${totals.droppableCount} of them enforce nothing and could go`}
        >
          <CappedList
            items={unused}
            keyOf={(index) => `${index.table}.${index.name}`}
            empty="Every index in this schema has been read at least once."
            render={(index) => <UnusedRow schema={schema} index={index} />}
          />
        </Finding>

        <Finding
          heading="Covered by another index"
          note="Key columns are a leading prefix of a longer index on the same table, so the longer one answers the same lookups."
        >
          <CappedList
            items={redundant}
            keyOf={({ index }) => `${index.table}.${index.name}`}
            empty="No index is a leading prefix of another."
            render={({ index, coveredBy }) => (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                <TableLink schema={schema} table={index.table} />
                <span className="font-mono text-[var(--sea-ink)]">{index.name}</span>
                <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
                  ({index.keyColumns.join(', ')})
                </span>
                <span className="text-[var(--sea-ink-soft)]">covered by</span>
                <span className="font-mono text-[var(--sea-ink)]">{coveredBy.name}</span>
                <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
                  ({coveredBy.keyColumns.join(', ')})
                </span>
                <span className="tabular-nums text-[var(--sea-ink-soft)]">
                  {formatBytes(index.bytes)}
                </span>
                {index.scans !== null && index.scans > 0 && (
                  <Chip tone="warn" title="It is being read, so check the plans before dropping it">
                    {index.scans.toLocaleString()} scans
                  </Chip>
                )}
              </div>
            )}
          />
        </Finding>

        <Finding
          heading="Foreign keys with no index"
          note="Postgres indexes the referenced side automatically and the referencing side never — these are the joins and parent deletes that scan the child table."
        >
          <CappedList
            items={uncovered}
            keyOf={(fk) => `${fk.table}.${fk.constraint}`}
            empty="Every foreign key is led by an index."
            render={(fk) => <UncoveredFkRow schema={schema} fk={fk} />}
          />
        </Finding>
      </div>
    </PressureSection>
  )
}

function Finding({
  heading,
  note,
  children,
}: {
  heading: string
  note: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
        {heading}
      </h3>
      <p className="text-[11px] text-[var(--sea-ink-soft)]">{note}</p>
      {children}
    </div>
  )
}

function UnusedRow({ schema, index }: { schema: string; index: IndexEntry }) {
  const loadBearing = enforcesConstraint(index)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      <TableLink schema={schema} table={index.table} />
      <span className="font-mono text-[var(--sea-ink)]">{index.name}</span>
      <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
        ({index.keyColumns.join(', ')})
      </span>
      <span className="tabular-nums font-medium text-[var(--sea-ink)]">
        {formatBytes(index.bytes)}
      </span>
      {index.method !== 'btree' && <Chip>{index.method}</Chip>}
      {index.isPartial && <Chip title="Partial index — covers only the rows its WHERE clause keeps">partial</Chip>}
      {loadBearing && (
        <Chip
          tone="warn"
          title="Dropping this index drops the constraint it enforces — unique keys are not dead weight even when nothing scans them"
        >
          enforces a constraint
        </Chip>
      )}
    </div>
  )
}

function UncoveredFkRow({ schema, fk }: { schema: string; fk: ForeignKeyColumns }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      <TableLink schema={schema} table={fk.table} />
      <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
        ({fk.columns.join(', ')})
      </span>
      <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">{fk.constraint}</span>
      <CopyButton
        text={createFkIndexSql(schema, fk)}
        label="Copy CREATE INDEX"
        className="ml-auto"
      />
    </div>
  )
}
