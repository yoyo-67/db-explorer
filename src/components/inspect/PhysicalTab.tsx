import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import ByteRuler, { ByteRulerLegend } from '#/components/physical/ByteRuler'
import Gauge from '#/components/widgets/Gauge'
import SplitBar from '#/components/widgets/SplitBar'
import StatRow from '#/components/widgets/StatRow'
import { $getTablePhysical } from '#/server/api'
import {
  SWAMPED_SHARE,
  computeLayout,
  fixedWidthColumns,
  repackOrder,
  repackSaving,
  widestColumnShare,
} from '#/lib/physical/align'
import {
  STORAGE_LABELS,
  STORAGE_MEANING,
  likelyToastColumn,
  sizeSplit,
  storageNote,
  storageOverridden,
} from '#/lib/physical/storage'
import {
  freezeLevel,
  freezeShare,
  freezeSentence,
  transactionsUntilFreeze,
  visibilityLevel,
  visibilitySentence,
  visibilityShare,
} from '#/lib/physical/freeze'
import { formatBytes } from '#/lib/pressure/bytes'
import { formatCompactCount, formatRelativeTime } from '#/lib/inspect/format'
import type { Tone } from '#/components/widgets/tone'
import type { FreezeLevel, VisibilityLevel } from '#/lib/physical/freeze'
import type { PhysicalColumn, TablePhysical } from '#/lib/physical/types'

/**
 * The table's anatomy: how wide a row is and why, where the bytes actually
 * live, and how close the table is to the two deadlines Postgres keeps for it.
 *
 * Nothing here is a list — the other tabs already do lists well. These are
 * quantities, and quantities drawn against each other say in one look what a
 * column of numbers says in a paragraph. Every figure comes from the catalog or
 * the last ANALYZE, so the tab costs the same on a billion rows as on none.
 */
export default function PhysicalTab({ schema, table }: { schema: string; table: string }) {
  const database = useDatabaseParam()
  const physicalQuery = useQuery({
    queryKey: ['tablePhysical', database, schema, table],
    queryFn: () => $getTablePhysical({ data: { database, schema, table } }),
    staleTime: 5 * 60_000,
  })

  if (physicalQuery.isLoading) {
    return <div className="h-56 animate-pulse rounded-lg bg-[rgba(79,184,178,0.06)]" />
  }
  if (physicalQuery.error) {
    return (
      <p className="text-xs text-red-700 dark:text-red-300">
        Could not read the physical shape: {String(physicalQuery.error)}
      </p>
    )
  }
  const physical = physicalQuery.data
  if (!physical) return null

  return (
    <div className="space-y-5">
      <RowLayout physical={physical} />
      <WhereTheBytesAre physical={physical} />
      <Deadlines physical={physical} />
    </div>
  )
}

function RowLayout({ physical }: { physical: TablePhysical }) {
  const actual = computeLayout(physical.columns)
  const packed = computeLayout(physical.columns, repackOrder(physical.columns))
  const saving = repackSaving(actual, packed, physical.estimatedRows)
  const scaleTo = Math.max(actual.totalBytes, packed.totalBytes)
  const dropped = physical.columns.filter((column) => column.dropped)

  // One wide payload column turns every fixed column into a one-pixel sliver —
  // and the padding, which is the point of the picture, lives among exactly
  // those. Draw them again on their own scale when that happens.
  const swamped = widestColumnShare(actual) >= SWAMPED_SHARE
  const fixed = fixedWidthColumns(physical.columns)
  const fixedActual = computeLayout(physical.columns, fixed)
  const fixedPacked = computeLayout(physical.columns, repackOrder(fixed))
  const fixedScale = Math.max(fixedActual.totalBytes, fixedPacked.totalBytes)

  return (
    <section className="space-y-2">
      <SectionHeading
        title="How a row is laid out"
        rule="Columns are stored in attnum order, each pushed forward to its type's alignment. The gaps are bytes no value occupies — they cost disk and they cost every scan that reads past them."
      />

      <div className="space-y-2.5">
        <ByteRuler layout={actual} scaleTo={scaleTo} caption="As stored" />
        {saving.bytesPerRow > 0 && (
          <ByteRuler layout={packed} scaleTo={scaleTo} caption="Widest type first" />
        )}
      </div>
      {swamped && fixed.length > 1 && (
        <div className="space-y-2 rounded-lg border border-[var(--line)] px-3 py-2">
          <p className="text-[11px] leading-relaxed text-[var(--sea-ink-soft)]">
            One column takes most of the row, so the rest are drawn a pixel wide above. Here are the
            fixed-width columns on their own scale — the padding is all among these, because a
            variable-length column is stored last and needs no alignment.
          </p>
          <ByteRuler layout={fixedActual} scaleTo={fixedScale} caption="Fixed columns, as stored" />
          {fixedActual.padBytes > fixedPacked.padBytes && (
            <ByteRuler
              layout={fixedPacked}
              scaleTo={fixedScale}
              caption="Fixed columns, widest first"
            />
          )}
        </div>
      )}
      <ByteRulerLegend />

      {saving.bytesPerRow > 0 ? (
        <div className="rounded-lg border border-[var(--line)] bg-[rgba(214,158,46,0.08)] px-3 py-2">
          <p className="text-[11px] leading-relaxed text-[var(--sea-ink)]">
            Reordering the columns widest-first would save{' '}
            <strong className="font-semibold">{saving.bytesPerRow} B per row</strong> —{' '}
            {formatBytes(saving.totalBytes)} across {formatCompactCount(physical.estimatedRows)}{' '}
            estimated rows, {(saving.share * 100).toFixed(0)}% of the row.
            {saving.estimated && ' Variable-length widths come from the last ANALYZE, so this is an estimate.'}
          </p>
          <p className="mt-1.5 text-[10px] text-[var(--sea-ink-soft)]">
            Postgres cannot reorder columns in place, so this is only worth having where the table
            is due a rewrite anyway.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-[var(--sea-ink-soft)]">
          Nothing to reclaim — the column order already wastes no alignment padding.
        </p>
      )}

      {actual.unknownWidths.length > 0 && (
        <p className="text-[11px] text-[var(--sea-ink-soft)]">
          No width recorded for {actual.unknownWidths.join(', ')} — those columns have never been
          analyzed, so the row width above is a floor rather than a figure.
        </p>
      )}

      {dropped.length > 0 && (
        <p className="text-[11px] text-[var(--sea-ink-soft)]">
          {dropped.length} dropped {dropped.length === 1 ? 'column' : 'columns'} still hold a slot in
          every row&rsquo;s null bitmap. Only a table rewrite removes them.
        </p>
      )}
    </section>
  )
}

function WhereTheBytesAre({ physical }: { physical: TablePhysical }) {
  const split = sizeSplit(physical)
  const toastColumn = likelyToastColumn(physical.columns)
  const notes = physical.columns
    .map((column) => ({ column, note: storageNote(physical.schema, physical.table, column) }))
    .filter((entry): entry is { column: PhysicalColumn; note: NonNullable<ReturnType<typeof storageNote>> } => entry.note !== null)

  return (
    <section className="space-y-2">
      <SectionHeading
        title="Where the bytes are"
        rule="A table's reported size is its heap. Anything too wide for a page is moved to a TOAST relation — compressed on the way, unless the column says otherwise — and counted separately."
      />

      <SplitBar
        total={split.totalBytes}
        format={formatBytes}
        slices={[
          { label: 'heap', bytes: split.heapBytes, tone: 'neutral' },
          {
            label: 'TOAST',
            bytes: split.toastBytes,
            tone: split.toastShare > 0.5 ? 'warn' : 'good',
            detail: toastColumn ? `probably ${toastColumn.name}` : undefined,
          },
          { label: 'indexes', bytes: split.indexBytes, tone: 'muted' },
        ]}
      />

      {split.toastShare > 0.5 && (
        <p className="text-[11px] leading-relaxed text-[var(--sea-ink)]">
          {(split.toastShare * 100).toFixed(0)}% of this table is TOAST. Its heap — the part every
          size figure reports — is {formatBytes(split.heapBytes)}
          {toastColumn
            ? `, and the widest column allowed out of it is ${toastColumn.name}. Postgres does not record which column filled TOAST, so that is an inference, not a fact.`
            : '.'}
        </p>
      )}

      <StorageTable columns={physical.columns} />

      {notes.map(({ column, note }) => (
        <div
          key={column.name}
          className="rounded-lg border border-[var(--line)] bg-[rgba(214,158,46,0.08)] px-3 py-2"
        >
          <p className="text-[11px] leading-relaxed text-[var(--sea-ink)]">
            <span className="font-mono font-medium">{column.name}</span> — {note.text}
          </p>
          {note.ddl && (
            <code className="mt-1.5 block rounded bg-[rgba(0,0,0,0.05)] px-1.5 py-0.5 font-mono text-[10px] dark:bg-[rgba(255,255,255,0.06)]">
              {note.ddl}
            </code>
          )}
        </div>
      ))}
    </section>
  )
}

/** Only the columns whose storage is worth a reader's attention: the wide ones. */
function StorageTable({ columns }: { columns: PhysicalColumn[] }) {
  const varlena = columns.filter(
    (column) => !column.dropped && column.typlen === -1,
  )
  if (varlena.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[26rem] border-collapse text-[11px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            <th className="py-1 pr-3 font-medium">Variable-length column</th>
            <th className="py-1 pr-3 font-medium">Average width</th>
            <th className="py-1 pr-3 font-medium">Storage</th>
            <th className="py-1 font-medium">Compression</th>
          </tr>
        </thead>
        <tbody>
          {varlena.map((column) => (
            <tr key={column.name} className="border-t border-[var(--line)]">
              <td className="py-1 pr-3">
                <span className="font-mono text-[var(--sea-ink)]">{column.name}</span>{' '}
                <span className="text-[var(--sea-ink-soft)]">{column.type}</span>
              </td>
              <td className="py-1 pr-3 font-mono text-[var(--sea-ink-soft)]">
                {column.avgWidth === null ? 'never analyzed' : `${formatBytes(column.avgWidth)}`}
              </td>
              <td className="py-1 pr-3" title={STORAGE_MEANING[column.storage]}>
                <span className="text-[var(--sea-ink)]">{STORAGE_LABELS[column.storage]}</span>
                {storageOverridden(column) && (
                  <span className="ml-1 text-[10px] text-[var(--sea-ink-soft)]">
                    (set, not the type default)
                  </span>
                )}
              </td>
              <td className="py-1 font-mono text-[var(--sea-ink-soft)]">
                {column.compression === null
                  ? '—'
                  : column.compression === 'default'
                    ? 'server default'
                    : column.compression}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const FREEZE_TONE: Record<FreezeLevel, Tone> = {
  urgent: 'bad',
  watch: 'warn',
  ok: 'good',
  unknown: 'muted',
}

const VISIBILITY_TONE: Record<VisibilityLevel, Tone> = {
  poor: 'warn',
  partial: 'warn',
  ok: 'good',
  unknown: 'muted',
}

function Deadlines({ physical }: { physical: TablePhysical }) {
  const now = Date.now()
  const xidLevel = freezeLevel(physical.frozenAge, physical.freezeMaxAge)
  const mxidLevel = freezeLevel(physical.multixactAge, physical.multixactFreezeMaxAge)
  const visLevel = visibilityLevel(physical)
  const remaining = transactionsUntilFreeze(physical.frozenAge, physical.freezeMaxAge)

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Deadlines"
        rule="Two clocks run on every table whether it is used or not: the transaction age that forces an anti-wraparound vacuum, and the share of pages an index-only scan is allowed to skip the heap for."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Gauge
          label="Freeze age"
          value={
            physical.frozenAge === null ? 'unknown' : formatCompactCount(physical.frozenAge)
          }
          ceiling={formatCompactCount(physical.freezeMaxAge)}
          fraction={freezeShare(physical.frozenAge, physical.freezeMaxAge)}
          tone={FREEZE_TONE[xidLevel]}
          sentence={freezeSentence(xidLevel)}
          note={
            remaining === null
              ? undefined
              : `${formatCompactCount(remaining)} transactions of headroom.`
          }
        />
        <Gauge
          label="Multixact age"
          value={
            physical.multixactAge === null
              ? 'unknown'
              : formatCompactCount(physical.multixactAge)
          }
          ceiling={formatCompactCount(physical.multixactFreezeMaxAge)}
          fraction={freezeShare(physical.multixactAge, physical.multixactFreezeMaxAge)}
          tone={FREEZE_TONE[mxidLevel]}
          sentence={
            mxidLevel === 'ok'
              ? 'Row-level locking has not aged this table.'
              : freezeSentence(mxidLevel)
          }
        />
        <Gauge
          label="Pages an index-only scan may skip"
          value={`${formatCompactCount(physical.relallvisible)} pages`}
          ceiling={`${formatCompactCount(physical.relpages)} pages`}
          fraction={visibilityShare(physical)}
          tone={VISIBILITY_TONE[visLevel]}
          sentence={visibilitySentence(visLevel)}
          note="The visibility map is rebuilt by vacuum, so this rises after one and decays with every write."
        />
        <div className="space-y-2">
          <StatRow
            stats={[
              {
                label: 'Estimated rows',
                value: formatCompactCount(physical.estimatedRows),
                title: 'reltuples — the planner’s estimate, not a count',
              },
              { label: 'Pages', value: formatCompactCount(physical.relpages) },
              {
                label: 'Fillfactor',
                value: physical.fillfactor === null ? '100 (default)' : String(physical.fillfactor),
                title:
                  'How full a page is packed on insert. Below 100 leaves room for HOT updates in place.',
                muted: physical.fillfactor === null,
              },
            ]}
          />
          <StatRow
            stats={[
              { label: 'Last vacuum', value: formatRelativeTime(physical.lastVacuum, now) },
              { label: 'Last analyze', value: formatRelativeTime(physical.lastAnalyze, now) },
              {
                label: 'TOAST relation',
                value: physical.toastRelation ?? 'none',
                muted: !physical.toastRelation,
              },
            ]}
          />
        </div>
      </div>
    </section>
  )
}

function SectionHeading({ title, rule }: { title: string; rule: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-[var(--sea-ink)]">{title}</h3>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--sea-ink-soft)]">{rule}</p>
    </div>
  )
}
