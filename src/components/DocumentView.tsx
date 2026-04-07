import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { $getDocumentData } from '#/server/api'
import type { ForeignKey, JsonValue, TableInfo } from '#/lib/types'

interface DocumentViewProps {
  rootTable: TableInfo
  rootRows: Record<string, JsonValue>[]
  foreignKeys: ForeignKey[]
}

export default function DocumentView({
  rootTable,
  rootRows,
  foreignKeys,
}: DocumentViewProps) {
  const relatedTables = foreignKeys.filter(
    (fk) => fk.toTable === rootTable.name,
  )

  if (relatedTables.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-[var(--sea-ink-soft)]">
        No foreign keys reference this table.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {rootRows.map((row, i) => (
        <DocumentRow
          key={i}
          rootTable={rootTable.name}
          row={row}
          foreignKeys={foreignKeys}
        />
      ))}
    </div>
  )
}

function DocumentRow({
  rootTable,
  row,
  foreignKeys,
}: {
  rootTable: string
  row: Record<string, JsonValue>
  foreignKeys: ForeignKey[]
}) {
  const [expanded, setExpanded] = useState(false)

  const label = getRowLabel(row)
  const rootId = row['id']

  const relatedQuery = useQuery({
    queryKey: ['document', rootTable, rootId],
    queryFn: () =>
      $getDocumentData({
        data: {
          config: { rootTable, foreignKeys },
          rootId,
        },
      }),
    enabled: expanded && rootId !== undefined,
  })

  const related = relatedQuery.data?.related ?? {}

  return (
    <div className="island-shell overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface)]"
      >
        <span
          className={`text-xs text-[var(--sea-ink-soft)] transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          &#9654;
        </span>
        <span className="font-medium text-[var(--sea-ink)]">{label}</span>
        <span className="text-xs text-[var(--sea-ink-soft)]">
          id: {String(rootId ?? '?')}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--line)] px-4 py-3">
          {relatedQuery.isLoading && (
            <p className="text-sm text-[var(--sea-ink-soft)]">
              Loading related data...
            </p>
          )}

          {relatedQuery.error && (
            <p className="text-sm text-red-600">
              Error: {String(relatedQuery.error)}
            </p>
          )}

          {Object.keys(related).length === 0 && !relatedQuery.isLoading && (
            <p className="text-sm text-[var(--sea-ink-soft)]">
              No related records found.
            </p>
          )}

          {Object.entries(related).map(([tableName, rows]) => (
            <div key={tableName} className="mb-3 last:mb-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--sea-ink)]">
                  {tableName}
                </span>
                <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)]">
                  {rows.length}
                </span>
              </div>
              <div className="ml-3 space-y-1 border-l-2 border-[var(--line)] pl-3">
                {rows.map((relRow, j) => (
                  <div
                    key={j}
                    className="rounded-md bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--sea-ink-soft)]"
                  >
                    {Object.entries(relRow)
                      .slice(0, 6)
                      .map(([k, v]) => (
                        <span key={k} className="mr-3">
                          <span className="font-medium text-[var(--sea-ink)]">
                            {k}:
                          </span>{' '}
                          {formatVal(v)}
                        </span>
                      ))}
                    {Object.keys(relRow).length > 6 && (
                      <span className="text-[var(--sea-ink-soft)]">...</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function getRowLabel(row: Record<string, JsonValue>): string {
  // Try common label fields
  for (const field of ['name', 'title', 'email', 'username', 'label', 'slug']) {
    if (row[field] && typeof row[field] === 'string') {
      return row[field] as string
    }
  }
  // Fallback to first string value
  for (const val of Object.values(row)) {
    if (typeof val === 'string' && val.length > 0 && val.length < 100) {
      return val
    }
  }
  return `Row ${row['id'] ?? '?'}`
}

function formatVal(v: JsonValue): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  return s.length > 60 ? s.slice(0, 57) + '...' : s
}
