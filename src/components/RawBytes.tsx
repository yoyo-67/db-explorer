import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { $getRawCell } from '#/server/api'

/**
 * The stored bytes of one decoded cell, on request.
 *
 * A compressed column is shown as the document it holds, which is what makes it
 * readable — but the bytes are still the thing in the row, and sometimes the
 * question *is* the bytes (a hash to compare, a header to check, a cell that
 * would not decode next to ones that did). They are not shipped with the page:
 * a screen of decoded documents plus every blob's hex is the payload the
 * decoding was meant to spare, so this asks per cell, on a click.
 */
export default function RawBytes({
  schema,
  table,
  column,
  keyColumn,
  keyValue,
}: {
  schema: string
  table: string
  column: string
  /** The column addressing this row — without one there is no cell to re-read. */
  keyColumn: string
  keyValue: string
}) {
  const database = useDatabaseParam()
  const [asked, setAsked] = useState(false)

  const cell = useQuery({
    queryKey: ['rawCell', database, schema, table, column, keyColumn, keyValue],
    queryFn: () =>
      $getRawCell({ data: { database, schema, table, column, keyColumn, keyValue } }),
    enabled: asked,
    staleTime: Infinity,
  })

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setAsked((on) => !on)
        }}
        className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--sea-ink-soft)] transition hover:border-[var(--lagoon)]/60 hover:text-[var(--lagoon-deep)]"
      >
        {asked ? 'hide bytes' : 'raw bytes'}
      </button>

      {asked && (
        <div className="mt-1 text-[10px] text-[var(--sea-ink-soft)]">
          {cell.isFetching && !cell.data ? (
            'reading…'
          ) : cell.error ? (
            <span className="text-[var(--coral-deep,#b4544a)]">
              {cell.error instanceof Error ? cell.error.message : 'Could not read the bytes.'}
            </span>
          ) : !cell.data ? (
            <span>This cell is no longer there — the row may have been deleted or rekeyed.</span>
          ) : (
            <>
              <span>
                {cell.data.byteLength.toLocaleString()} bytes
                {cell.data.truncated ? ', showing the first part' : ''}
              </span>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-[rgba(0,0,0,0.03)] p-2 break-all whitespace-pre-wrap text-[10px] text-[var(--sea-ink)] dark:bg-[rgba(255,255,255,0.04)]">
                {cell.data.hex}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
