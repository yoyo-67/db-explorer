import PressureSection, { CappedList, Chip, Meter, TableLink } from '#/components/pressure/PressureSection'
import { bytesPerRow, formatBytes, indexToHeapRatio, shareOfTotal } from '#/lib/pressure/bytes'
import { formatCompactCount } from '#/lib/inspect/format'
import type { SchemaPressure, TableSizeEntry } from '#/lib/types'

/** Above this, a table carries more index than data — worth a look, not always wrong. */
const INDEX_HEAVY_RATIO = 1

/**
 * Where the disk went. Sizes are exact (they are file sizes, not estimates), and
 * split into heap, index and TOAST because the three have different causes: wide
 * rows, index sprawl, and large values pushed out of line.
 */
export default function SizeSection({ pressure }: { pressure: SchemaPressure }) {
  const { schema, sizes } = pressure
  const total = sizes.reduce((sum, entry) => sum + entry.totalBytes, 0)
  const ranked = [...sizes].sort((a, b) => b.totalBytes - a.totalBytes)

  return (
    <PressureSection
      id="sizes"
      title="Size"
      count={`${formatBytes(total)} across ${sizes.length} tables`}
      rule="Heap, index and TOAST bytes per table, largest first. Exact file sizes — the row counts beside them are planner estimates."
    >
      <div className="space-y-2">
        <Legend />
        <CappedList
          items={ranked}
          keyOf={(entry) => entry.table}
          empty="No tables in this schema."
          render={(entry) => <SizeRow schema={schema} entry={entry} total={total} />}
        />
      </div>
    </PressureSection>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-[var(--sea-ink-soft)]">
      <span className="flex items-center gap-1">
        <i className="inline-block h-2 w-2 rounded-sm bg-[var(--lagoon)]" /> heap
      </span>
      <span className="flex items-center gap-1">
        <i className="inline-block h-2 w-2 rounded-sm bg-[var(--palm)]" /> indexes
      </span>
      <span className="flex items-center gap-1">
        <i className="inline-block h-2 w-2 rounded-sm bg-[#d69e2e]" /> TOAST
      </span>
    </div>
  )
}

function SizeRow({
  schema,
  entry,
  total,
}: {
  schema: string
  entry: TableSizeEntry
  total: number
}) {
  const ratio = indexToHeapRatio(entry.heapBytes, entry.indexBytes)
  const perRow = bytesPerRow(entry.totalBytes, entry.estimatedRows)
  const scale = entry.totalBytes > 0 ? entry.totalBytes : 1

  return (
    <div className="space-y-1 py-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
        <TableLink schema={schema} table={entry.table} />
        <span className="tabular-nums font-medium text-[var(--sea-ink)]">
          {formatBytes(entry.totalBytes)}
        </span>
        <span className="tabular-nums text-[10px] text-[var(--sea-ink-soft)]">
          {(shareOfTotal(entry.totalBytes, total) * 100).toFixed(1)}% of schema
        </span>
        <span className="text-[10px] text-[var(--sea-ink-soft)]">
          ~{formatCompactCount(entry.estimatedRows)} rows
          {perRow !== null && ` · ${formatBytes(perRow)}/row`}
        </span>
        {ratio !== null && ratio > INDEX_HEAVY_RATIO && (
          <Chip
            tone="warn"
            title={`${formatBytes(entry.indexBytes)} of index against ${formatBytes(entry.heapBytes)} of data — check the index section for ones nothing reads`}
          >
            {ratio.toFixed(1)}× more index than data
          </Chip>
        )}
      </div>
      <Meter
        title={`heap ${formatBytes(entry.heapBytes)} · indexes ${formatBytes(entry.indexBytes)} · TOAST ${formatBytes(entry.toastBytes)}`}
        segments={[
          { pct: (entry.heapBytes / scale) * 100, className: 'bg-[var(--lagoon)]', label: 'heap' },
          { pct: (entry.indexBytes / scale) * 100, className: 'bg-[var(--palm)]', label: 'index' },
          { pct: (entry.toastBytes / scale) * 100, className: 'bg-[#d69e2e]', label: 'toast' },
        ]}
      />
    </div>
  )
}
