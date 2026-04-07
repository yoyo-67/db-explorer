import { useState } from 'react'
import type { DocumentCollection, JsonValue } from '#/lib/types'

interface DocumentViewProps {
  collection: DocumentCollection
  filter: string
  prettyJson: boolean
}

export default function DocumentView({
  collection,
  filter,
  prettyJson,
}: DocumentViewProps) {
  const { rootTable, relatedTables, documents } = collection

  const filteredDocs = filter
    ? documents.filter((doc) => {
        const text = JSON.stringify(doc).toLowerCase()
        return text.includes(filter.toLowerCase())
      })
    : documents

  if (filteredDocs.length === 0 && filter) return null

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-bold text-[var(--sea-ink)]">{rootTable}</h2>
        <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2.5 py-0.5 text-xs font-medium text-[var(--lagoon-deep)]">
          {filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}
        </span>
        {relatedTables.length > 0 && (
          <span className="text-xs text-[var(--sea-ink-soft)]">
            + {relatedTables.map((t) => t.name).join(', ')}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {filteredDocs.map((doc, i) => (
          <DocumentCard
            key={i}
            rootTable={rootTable}
            doc={doc}
            prettyJson={prettyJson}
          />
        ))}
      </div>
    </div>
  )
}

function DocumentCard({
  rootTable,
  doc,
  prettyJson,
}: {
  rootTable: string
  doc: { root: Record<string, JsonValue>; related: Record<string, Record<string, JsonValue>[]> }
  prettyJson: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const label = getRowLabel(doc.root)
  const rootId = doc.root['id']
  const hasRelated = Object.values(doc.related).some((rows) => rows.length > 0)

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
        <span className="rounded bg-[rgba(79,184,178,0.1)] px-2 py-0.5 text-xs font-medium text-[var(--lagoon-deep)]">
          {rootTable}
        </span>
        <span className="font-semibold text-[var(--sea-ink)]">{label}</span>
        {rootId !== undefined && (
          <span className="font-mono text-xs text-[var(--sea-ink-soft)]">
            #{String(rootId)}
          </span>
        )}
        {hasRelated && (
          <span className="ml-auto text-xs text-[var(--sea-ink-soft)]">
            {Object.entries(doc.related)
              .filter(([, rows]) => rows.length > 0)
              .map(([t, rows]) => `${rows.length} ${t}`)
              .join(', ')}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-[var(--line)]">
          {/* Root row fields */}
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-5 py-3 font-mono text-[13px]">
            {Object.entries(doc.root).map(([key, value]) => (
              <FieldRow key={key} fieldKey={key} value={value} prettyJson={prettyJson} />
            ))}
          </div>

          {/* Related data */}
          {Object.entries(doc.related).map(([tableName, rows]) => {
            if (rows.length === 0) return null
            return (
              <RelatedSection
                key={tableName}
                tableName={tableName}
                rows={rows}
                prettyJson={prettyJson}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function FieldRow({
  fieldKey,
  value,
  prettyJson,
}: {
  fieldKey: string
  value: JsonValue
  prettyJson: boolean
}) {
  const isJson = value !== null && typeof value === 'object'

  return (
    <>
      <span className="whitespace-nowrap py-0.5 text-xs font-semibold text-[var(--sea-ink-soft)]">
        {fieldKey}
      </span>
      <span className="min-w-0 py-0.5">
        <CellValue value={value} prettyJson={prettyJson} />
        {isJson && prettyJson && (
          <pre className="mt-1 overflow-x-auto rounded-md bg-[rgba(0,0,0,0.03)] p-2 text-[11px] leading-relaxed text-[var(--sea-ink)] dark:bg-[rgba(255,255,255,0.04)]">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </span>
    </>
  )
}

function RelatedSection({
  tableName,
  rows,
  prettyJson,
}: {
  tableName: string
  rows: Record<string, JsonValue>[]
  prettyJson: boolean
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="border-t border-[var(--line)]/60">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-5 py-2 text-left transition hover:bg-[var(--surface)]"
      >
        <span
          className={`text-[10px] text-[var(--sea-ink-soft)] transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          &#9654;
        </span>
        <span className="text-sm font-semibold text-[var(--sea-ink)]">{tableName}</span>
        <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)]">
          {rows.length}
        </span>
      </button>

      {expanded && (
        <div className="ml-5 space-y-2 border-l-2 border-[var(--lagoon)]/20 pb-3 pl-4">
          {rows.map((row, j) => (
            <div
              key={j}
              className="rounded-lg bg-[rgba(0,0,0,0.02)] px-4 py-2 dark:bg-[rgba(255,255,255,0.03)]"
            >
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono text-[12px]">
                {Object.entries(row).map(([key, value]) => (
                  <FieldRow key={key} fieldKey={key} value={value} prettyJson={prettyJson} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CellValue({ value, prettyJson }: { value: JsonValue; prettyJson: boolean }) {
  if (value === null || value === undefined) {
    return <span className="italic text-[var(--sea-ink-soft)]/50">null</span>
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-green-600' : 'text-red-500'}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="tabular-nums text-[var(--lagoon-deep)]">{value}</span>
  }
  if (typeof value === 'object') {
    if (prettyJson) return null // rendered as <pre> block in FieldRow
    return <span className="text-[var(--sea-ink-soft)]">{JSON.stringify(value)}</span>
  }
  const s = String(value)
  if (s.length > 120) {
    return <span title={s}>{s.slice(0, 117)}...</span>
  }
  return <>{s}</>
}

function getRowLabel(row: Record<string, JsonValue>): string {
  for (const field of ['name', 'title', 'email', 'username', 'label', 'slug']) {
    if (row[field] && typeof row[field] === 'string') {
      return row[field] as string
    }
  }
  for (const val of Object.values(row)) {
    if (typeof val === 'string' && val.length > 0 && val.length < 100) {
      return val
    }
  }
  return `Row ${row['id'] ?? '?'}`
}
