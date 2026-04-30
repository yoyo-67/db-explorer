import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { $getRowDetail, $introspect } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { getRowLabel } from '#/lib/row-label'
import type { ColumnInfo, JsonValue, RowChildGroup } from '#/lib/types'

export const Route = createFileRoute('/t/$schema/$table/row/$id')({
  component: RowDetailPage,
})

function RowDetailPage() {
  const { schema, table, id } = Route.useParams()
  const { isChecking, isConnected } = useConnectionGuard()
  const [prettyJson, setPrettyJson] = useState(true)

  const detailQuery = useQuery({
    queryKey: ['rowDetail', schema, table, id],
    queryFn: () => $getRowDetail({ data: { schema, table, rowId: id } }),
    enabled: isConnected,
    staleTime: 30_000,
  })

  const introspectQuery = useQuery({
    queryKey: ['introspect', schema],
    queryFn: () => $introspect({ data: { schema } }),
    enabled: isConnected,
    staleTime: Infinity,
  })

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

  const detail = detailQuery.data
  const fks = introspectQuery.data?.fks ?? []
  const root = detail?.root ?? null
  const label = root ? getRowLabel(root, detail?.columns ?? [], fks, table) : null

  return (
    <main className="px-4 pb-8 pt-6">
      <div className="space-y-5">
        <nav className="text-xs text-[var(--sea-ink-soft)]">
          <Link
            to="/t/$schema/$table"
            params={{ schema, table }}
            className="hover:text-[var(--lagoon-deep)]"
          >
            {schema}.{table}
          </Link>
          <span className="px-1.5">/</span>
          <span>row #{id}</span>
        </nav>

        <header className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-semibold text-[var(--sea-ink)]">
            {label ?? `Row #${id}`}
          </h1>
          <span className="text-xs text-[var(--sea-ink-soft)]">
            {schema}.{table}
          </span>
          <label className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--sea-ink-soft)]">
            <input
              type="checkbox"
              checked={prettyJson}
              onChange={(e) => setPrettyJson(e.target.checked)}
              className="rounded border-[var(--line)]"
            />
            Pretty JSON
          </label>
        </header>

        {detailQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load row: {String(detailQuery.error)}
          </div>
        )}

        {detailQuery.isLoading && (
          <div className="island-shell h-32 animate-pulse rounded-xl" />
        )}

        {detail && !root && (
          <div className="island-shell rounded-xl px-6 py-8 text-center text-sm text-[var(--sea-ink-soft)]">
            No row found with id <code className="font-mono">{id}</code>.
          </div>
        )}

        {detail && root && (
          <section className="island-shell rounded-xl">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-5 py-4 font-mono text-[13px]">
              {detail.columns.map((col) => (
                <FieldRow key={col.name} col={col} value={root[col.name]} prettyJson={prettyJson} />
              ))}
            </div>
          </section>
        )}

        {detail && detail.children.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
              Incoming references
            </h2>
            {detail.children.map((child) => (
              <ChildGroup key={child.table + child.fkColumn} schema={schema} child={child} prettyJson={prettyJson} />
            ))}
          </section>
        )}
      </div>
    </main>
  )
}

function FieldRow({
  col,
  value,
  prettyJson,
}: {
  col: ColumnInfo
  value: JsonValue | undefined
  prettyJson: boolean
}) {
  const isJson = value !== null && value !== undefined && typeof value === 'object'
  return (
    <>
      <span className="whitespace-nowrap py-0.5 text-xs font-semibold text-[var(--sea-ink-soft)]">
        {col.name}
        <span className="ml-1 text-[10px] font-normal text-[var(--sea-ink-soft)]/60">
          {col.dataType}
        </span>
      </span>
      <span className="min-w-0 break-all py-0.5 text-[var(--sea-ink)]">
        <Cell value={value} prettyJson={prettyJson} />
        {isJson && prettyJson && (
          <pre className="mt-1 overflow-x-auto rounded-md bg-[rgba(0,0,0,0.03)] p-2 text-[11px] leading-relaxed text-[var(--sea-ink)] dark:bg-[rgba(255,255,255,0.04)]">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </span>
    </>
  )
}

function Cell({ value, prettyJson }: { value: JsonValue | undefined; prettyJson: boolean }) {
  if (value === null || value === undefined) {
    return <span className="italic text-[var(--sea-ink-soft)]/50">NULL</span>
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-green-600' : 'text-red-500'}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="tabular-nums text-[var(--lagoon-deep)]">{value}</span>
  }
  if (typeof value === 'object') {
    if (prettyJson) return null
    return <span className="text-[var(--sea-ink-soft)]">{JSON.stringify(value)}</span>
  }
  return <>{String(value)}</>
}

function ChildGroup({
  schema,
  child,
  prettyJson,
}: {
  schema: string
  child: RowChildGroup
  prettyJson: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const hidden = Math.max(0, child.total - child.rows.length)

  return (
    <div className="island-shell rounded-xl">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition hover:bg-[var(--surface)]"
      >
        <span
          className={`text-[10px] text-[var(--sea-ink-soft)] transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          &#9654;
        </span>
        <Link
          to="/t/$schema/$table"
          params={{ schema, table: child.table }}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-semibold text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
        >
          {child.table}
        </Link>
        <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)]">
          {child.total}
        </span>
        <span className="text-[10px] text-[var(--sea-ink-soft)]">
          via {child.fkColumn} → {child.toColumn}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-[var(--line)] p-3">
          {child.rows.length === 0 ? (
            <p className="px-2 py-2 text-xs text-[var(--sea-ink-soft)]">No related rows.</p>
          ) : (
            child.rows.map((row, i) => (
              <ChildRow key={i} schema={schema} table={child.table} row={row} prettyJson={prettyJson} />
            ))
          )}
          {hidden > 0 && (
            <p className="px-2 py-1 text-[11px] text-[var(--sea-ink-soft)]">
              + {hidden} more not shown
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ChildRow({
  schema,
  table,
  row,
  prettyJson,
}: {
  schema: string
  table: string
  row: Record<string, JsonValue>
  prettyJson: boolean
}) {
  const id = row['id']
  return (
    <div className="rounded-lg bg-[rgba(0,0,0,0.02)] px-3 py-2 dark:bg-[rgba(255,255,255,0.03)]">
      {id !== undefined && id !== null && (
        <div className="mb-1 text-[11px] text-[var(--sea-ink-soft)]">
          <Link
            to="/t/$schema/$table/row/$id"
            params={{ schema, table, id: String(id) }}
            className="font-mono text-[var(--lagoon-deep)] hover:underline"
          >
            #{String(id)}
          </Link>
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono text-[12px]">
        {Object.entries(row).map(([key, value]) => (
          <FieldRow
            key={key}
            col={{ name: key, dataType: '', isNullable: true }}
            value={value}
            prettyJson={prettyJson}
          />
        ))}
      </div>
    </div>
  )
}
