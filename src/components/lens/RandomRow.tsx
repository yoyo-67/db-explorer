import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { useMemo, useState } from 'react'
import DataTable from '#/components/DataTable'
import { $getRandomRow } from '#/server/api'
import type { ColumnInfo, RandomRowSample } from '#/lib/types'

/**
 * One row of the table, before you commit to opening all of them.
 *
 * Rendered through `DataTable` rather than a bespoke layout, so it *is* a data-view
 * row — same cells, same click-to-expand field grid, same link out of the primary
 * key. Sort and filter are absent because a single row has nothing to sort.
 *
 * How random the row is depends on the table's size, and the label says which:
 * a block sample is not a uniform draw, and a `first` fallback is not random at
 * all. Re-rolling is a new query key, not a refetch, so React Query does not serve
 * the previous row back.
 */
export default function RandomRow({
  schema,
  table,
  references,
  enabled,
}: {
  schema: string
  table: string
  /** Column → what it points at, taken from the lens graph so no introspect fetch
   *  is needed to make the foreign keys clickable. */
  references: Map<string, { table: string; column: string }>
  enabled: boolean
}) {
  const database = useDatabaseParam()
  const [draw, setDraw] = useState(0)

  const sampleQuery = useQuery({
    queryKey: ['randomRow', database, schema, table, draw],
    queryFn: () => $getRandomRow({ data: { database, schema, table } }),
    enabled,
    staleTime: Infinity,
  })

  const sample = sampleQuery.data
  const columns = useMemo(
    () => withReferences(sample?.columns ?? [], references),
    [sample, references],
  )

  return (
    <section className="island-shell rounded-xl">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--line)] px-4 py-2">
        <h2 className="text-sm font-semibold text-[var(--sea-ink)]">Random row</h2>
        <span className="text-[11px] text-[var(--sea-ink-soft)]">
          {sampleQuery.isFetching ? 'drawing…' : sample ? drawLabel(sample) : ' '}
        </span>
        <button
          type="button"
          onClick={() => setDraw((n) => n + 1)}
          disabled={sampleQuery.isFetching}
          className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)] disabled:opacity-50"
        >
          ↻ another
        </button>
      </header>

      {sampleQuery.error && (
        <p className="px-4 py-2 text-xs text-red-700 dark:text-red-300">
          Failed to draw a row: {String(sampleQuery.error)}
        </p>
      )}

      {sampleQuery.isLoading && <div className="h-16 animate-pulse" />}

      {sample?.row && (
        <div className="overflow-visible">
          <DataTable
            columns={columns}
            rows={[sample.row]}
            totalRows={1}
            prettyJson
            schema={schema}
            table={table}
            pkColumn={sample.pkColumn}
          />
        </div>
      )}

      {sample && !sample.row && (
        <p className="px-4 py-2 text-xs text-[var(--sea-ink-soft)]">
          {sample.timedOut
            ? 'The draw ran out of time — this table is large enough that even one row costs more than three seconds. Its rows are still one click away.'
            : 'No rows: this table is empty.'}
        </p>
      )}
    </section>
  )
}

/** What the row is, said plainly — a block sample and a first row are not the
 *  same claim as a uniform random draw. */
function drawLabel(sample: RandomRowSample): string {
  if (!sample.row) return ''
  if (sample.strategy === 'random') return 'uniform draw over the whole table'
  if (sample.strategy === 'sampled') {
    return 'drawn from a random block — cheap, but not a uniform draw'
  }
  return 'the first row, not a random one: no sampled block held one'
}

/** Foreign keys, so the sample's cells link the way the data view's do. */
function withReferences(
  columns: ColumnInfo[],
  references: Map<string, { table: string; column: string }>,
): ColumnInfo[] {
  return columns.map((c) => {
    const target = references.get(c.name)
    return target ? { ...c, references: target } : c
  })
}
