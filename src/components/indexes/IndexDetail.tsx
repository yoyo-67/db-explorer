import CopyButton from '#/components/CopyButton'
import Sparkline from '#/components/indexes/Sparkline'
import { Chip, TableLink } from '#/components/pressure/PressureSection'
import { describeCapability } from '#/lib/indexes/capability'
import { classifyAccess } from '#/lib/indexes/shape'
import { indexTrend } from '#/lib/indexes/trend'
import { indexedWrites, writeTax } from '#/lib/indexes/write-tax'
import { createFkIndexSql, enforcesConstraint } from '#/lib/pressure/index-audit'
import { formatBytes } from '#/lib/pressure/bytes'
import type { IndexUsageEntry, SchemaIndexUsage } from '#/lib/types'

/**
 * One index, argued from its numbers: what it is, what has been read through it,
 * whether that is rising, what its shape unlocks, and what it costs.
 *
 * No DROP statement is offered anywhere. Whether an index should go is a
 * judgement with a production lock behind it; the page's job is to give the
 * reader every number that judgement needs and say what dropping would take with
 * it — not to hand over the statement.
 */

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`
}

function rows(value: number | null): string {
  if (value === null) return 'unknown'
  if (value < 10) return `~${value.toFixed(1)} rows`
  return `~${Math.round(value).toLocaleString()} rows`
}

const PATTERN_SENTENCE: Record<string, string> = {
  'never-scanned': 'Never scanned since the counters were reset.',
  'point-lookup': 'Point lookups: a scan walks about one entry.',
  'narrow-range': 'Bounded ranges: a scan walks a handful of entries.',
  'wide-sweep': 'Wide sweeps: a scan walks many entries at a time.',
  'full-index-read': 'Whole-index reads: a scan touches much of the table.',
  unknown: 'Not counted: the statistics have no usable figures for this index.',
}

export default function IndexDetail({
  usage,
  selectedKey,
}: {
  usage: SchemaIndexUsage
  selectedKey: string
}) {
  const index = usage.indexes.find((entry) => `${entry.table}.${entry.name}` === selectedKey)
  if (index) return <IndexBlocks usage={usage} index={index} />

  const gap = usage.foreignKeys.find((fk) => `${fk.table}.${fk.constraint}` === selectedKey)
  if (gap) {
    return (
      <div className="island-shell space-y-3 rounded-xl p-4">
        <div>
          <p className="island-kicker">Foreign key with no index</p>
          <h2 className="font-mono text-sm text-[var(--sea-ink)]">{gap.constraint}</h2>
        </div>
        <p className="text-[11px] leading-relaxed text-[var(--sea-ink-soft)]">
          Postgres indexes the referenced side of a foreign key automatically and the
          referencing side never. Until one exists, a join through{' '}
          <span className="font-mono">({gap.columns.join(', ')})</span> and every parent
          delete has to scan <TableLink schema={usage.schema} table={gap.table} />.
        </p>
        <pre className="overflow-x-auto rounded bg-[rgba(23,58,64,0.06)] p-2 text-[11px] text-[var(--sea-ink)]">
          {createFkIndexSql(usage.schema, gap)}
        </pre>
        <CopyButton text={createFkIndexSql(usage.schema, gap)} label="Copy CREATE INDEX" />
      </div>
    )
  }

  return (
    <div className="island-shell flex items-center justify-center rounded-xl p-6 text-sm text-[var(--sea-ink-soft)]">
      That index is no longer in this schema — it may have been dropped since the page
      was read.
    </div>
  )
}

function IndexBlocks({
  usage,
  index,
}: {
  usage: SchemaIndexUsage
  index: IndexUsageEntry
}) {
  const table = usage.tables.find((entry) => entry.table === index.table) ?? null
  const shape = classifyAccess(index, table)
  const capability = describeCapability(index, table)
  const indexesOnTable = usage.indexes.filter((entry) => entry.table === index.table).length
  const tax = writeTax(index, table, indexesOnTable)
  const trend = indexTrend(usage.history, index.name)
  // An invalid index gets a banner at the top of the pane; repeating the same
  // sentence down here reads as two separate problems.
  const shownNotes = capability.notes.filter(
    (note) => index.isValid || !note.includes('not valid'),
  )

  return (
    <div className="island-shell min-h-0 space-y-4 overflow-y-auto rounded-xl p-4">
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-mono text-sm text-[var(--sea-ink)]">{index.name}</h2>
          <span className="tabular-nums text-[11px] font-medium text-[var(--sea-ink)]">
            {formatBytes(index.bytes)}
          </span>
          <TableLink schema={usage.schema} table={index.table} />
          {index.isPrimary && <Chip>primary key</Chip>}
          {index.isUnique && !index.isPrimary && <Chip>unique</Chip>}
          {index.method !== 'btree' && <Chip>{index.method}</Chip>}
          {index.isPartial && <Chip tone="warn">partial</Chip>}
        </div>
        {!index.isValid && (
          <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            This index is not valid — the usual cause is a CREATE INDEX CONCURRENTLY that
            failed. The planner will not use it, and every write to{' '}
            <span className="font-mono">{index.table}</span> still maintains it.
          </p>
        )}
        <pre className="overflow-x-auto rounded bg-[rgba(23,58,64,0.06)] p-2 text-[11px] text-[var(--sea-ink)]">
          {index.definition}
        </pre>
        <CopyButton text={index.definition} label="Copy definition" />
      </section>

      <Block title="Access" note={`Counters are cumulative since the last reset${usage.statsReset ? ` (${usage.statsReset.slice(0, 10)})` : ''}.`}>
        <p className="text-[11px] text-[var(--sea-ink)]">{PATTERN_SENTENCE[shape.pattern]}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
          <Figure label="scans" value={shape.scans === null ? 'not counted' : shape.scans.toLocaleString()} />
          <Figure
            label="entries per scan"
            value={shape.tuplesPerScan === null ? '—' : shape.tuplesPerScan.toFixed(1)}
          />
          <Figure
            label="heap fetches"
            value={percent(shape.heapFetchRatio)}
            title="Share of index entries followed to the heap. Near 0% means the index is answering on its own."
          />
          <Figure label="cache hit" value={percent(shape.cacheHitRatio)} />
        </dl>
      </Block>

      <Block
        title="Trend"
        note="Scans per day, from the snapshots stored under local/. A cumulative counter cannot tell you about now."
      >
        {trend.empty ? (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            No history yet — a rate needs two snapshots, and one is taken every fifteen
            minutes this page is opened.
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <Sparkline
              values={trend.points.map((point) => point.scansPerDay)}
              label={`Scans per day over ${trend.windowDays?.toFixed(1)} days`}
            />
            <p className="text-[11px] text-[var(--sea-ink)]">
              {Math.round(trend.scansPerDay ?? 0).toLocaleString()} scans a day over{' '}
              {trend.windowDays?.toFixed(1)} days
              {trend.discontinuities > 0 &&
                ` · ${trend.discontinuities} gap${trend.discontinuities === 1 ? '' : 's'} where the counters restarted`}
            </p>
          </div>
        )}
      </Block>

      <Block title="Unlocks" note="Read from the key shape and the last ANALYZE — what it can serve, whether or not it has.">
        <ul className="space-y-1 text-[11px] text-[var(--sea-ink)]">
          {capability.equalityColumns.map((lookup) => (
            <li key={lookup.column}>
              <span className="font-mono">= {lookup.column}</span>{' '}
              <span className="text-[var(--sea-ink-soft)]">
                → {rows(lookup.estimatedRowsPerValue)} per value
              </span>
            </li>
          ))}
          {capability.sortOrders.map((order) => (
            <li key={order} className="text-[var(--sea-ink-soft)]">
              sorted by <span className="font-mono text-[var(--sea-ink)]">{order}</span>
            </li>
          ))}
          {capability.indexOnlyEligible && (
            <li className="text-[var(--sea-ink-soft)]">
              can answer without the heap for{' '}
              <span className="font-mono text-[var(--sea-ink)]">
                {capability.coveredColumns.join(', ')}
              </span>
            </li>
          )}
          {capability.restrictedTo && (
            <li className="text-[var(--sea-ink-soft)]">
              only the rows where{' '}
              <span className="font-mono text-[var(--sea-ink)]">{capability.restrictedTo}</span>
            </li>
          )}
        </ul>
        {shownNotes.length > 0 && (
          <ul className="space-y-1 text-[10px] text-[var(--sea-ink-soft)]">
            {shownNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Cost and standing" note="Every insert, delete and non-HOT update on the table has to be written into this index too.">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
          {/* Size is already stated beside the name; repeating it here just makes
              the reader check whether the two figures agree. */}
          <Figure
            label="share of table"
            value={percent(tax.byteShare)}
            title={
              tax.tableTotalBytes === null
                ? undefined
                : `of ${formatBytes(tax.tableTotalBytes)} for the table, its indexes and its TOAST`
            }
          />
          <Figure
            label="indexed writes"
            value={
              tax.indexedWrites === null ? 'not counted' : tax.indexedWrites.toLocaleString()
            }
            title="Inserts, deletes and updates that could not stay on their page — each one maintains every index on the table."
          />
          <Figure label="indexes on the table" value={String(tax.indexCount)} />
        </dl>
        <p className="text-[11px] leading-relaxed text-[var(--sea-ink-soft)]">
          {enforcesConstraint({
            table: index.table,
            name: index.name,
            method: index.method,
            keyColumns: index.keyColumns.map((column) => column.name),
            isUnique: index.isUnique,
            isPrimary: index.isPrimary,
            isPartial: index.isPartial,
            hasExpression: index.hasExpression,
            constraintBacked: index.constraintBacked,
            scans: index.scans,
            bytes: index.bytes,
          })
            ? 'Removing this index would drop the constraint it enforces — a unique or primary key is not dead weight even when nothing scans it.'
            : 'This index enforces nothing, so removing it would cost only the lookups it serves.'}
        </p>
        {tax.seqScanShare !== null && tax.seqScanShare > 0.5 && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            {percent(tax.seqScanShare)} of scans of{' '}
            <span className="font-mono">{index.table}</span> are sequential — the planner
            is mostly not reaching for any index on it.
          </p>
        )}
        {indexedWrites(table) === 0 && (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            No writes have been counted on this table since the reset, so the write cost
            above is a floor, not a measurement.
          </p>
        )}
      </Block>
    </div>
  )
}

function Block({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-1.5 border-t border-[var(--line)] pt-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
        {title}
      </h3>
      <p className="text-[11px] text-[var(--sea-ink-soft)]">{note}</p>
      {children}
    </section>
  )
}

function Figure({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}) {
  return (
    <div title={title}>
      <dt className="text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">{label}</dt>
      <dd className="tabular-nums text-[var(--sea-ink)]">{value}</dd>
    </div>
  )
}
