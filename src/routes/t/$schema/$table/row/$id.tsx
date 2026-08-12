import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import LinkableValue from '#/components/LinkableValue'
import { $getRowChildren, $getRowDetail, $introspect } from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { enrichColumnsWithFks } from '#/lib/fk-resolver'
import { getRowLabel } from '#/lib/row-label'
import type {
  ColumnInfo,
  ForeignKey,
  JsonValue,
  RowChildGroup,
  RowDetail,
  TableInfo,
} from '#/lib/types'

interface RowDetailSearch {
  col?: string
}

export const Route = createFileRoute('/t/$schema/$table/row/$id')({
  component: RowDetailPage,
  validateSearch: (search: Record<string, unknown>): RowDetailSearch => ({
    col: typeof search.col === 'string' && search.col.length > 0 ? search.col : undefined,
  }),
})

function RowDetailPage() {
  const { schema, table, id } = Route.useParams()
  const { col } = Route.useSearch()
  const { isChecking, isConnected } = useConnectionGuard()
  const [prettyJson, setPrettyJson] = useState(true)
  const [showEmpty, setShowEmpty] = useState(false)

  const detailQuery = useQuery({
    queryKey: ['rowDetail', schema, table, id, col ?? ''],
    queryFn: () =>
      $getRowDetail({ data: { schema, table, rowId: id, column: col } }),
    enabled: isConnected,
    staleTime: 30_000,
  })

  const introspectQuery = useQuery({
    queryKey: ['introspect', schema],
    queryFn: () => $introspect({ data: { schema } }),
    enabled: isConnected,
    staleTime: Infinity,
  })

  const detail = detailQuery.data
  const fks = introspectQuery.data?.fks ?? []
  const root = detail?.root ?? null
  const label = root ? getRowLabel(root, detail?.columns ?? [], fks, table) : null
  const rootTableInfo = introspectQuery.data?.tables.find((t) => t.name === table)
  const rootPkColumn = rootTableInfo?.pkColumn ?? null
  const visibleChildren = useMemo(() => {
    const all = detail?.children ?? []
    return showEmpty ? all : all.filter((c) => c.total > 0)
  }, [detail, showEmpty])
  const hiddenEmpty = (detail?.children.length ?? 0) - visibleChildren.length

  if (isChecking) {
    return (
      <div className="p-8 text-center text-sm text-[var(--sea-ink-soft)]">
        Checking connection...
      </div>
    )
  }
  if (!isConnected) return null

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
          <div className="ml-auto flex items-center gap-3">
            {detail && (
              <CopyPageButton
                detail={detail}
                schema={schema}
                table={table}
                id={id}
                label={label}
              />
            )}
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--sea-ink-soft)]">
              <input
                type="checkbox"
                checked={prettyJson}
                onChange={(e) => setPrettyJson(e.target.checked)}
                className="rounded border-[var(--line)]"
              />
              Pretty JSON
            </label>
          </div>
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
              {enrichColumnsWithFks(detail.columns, fks, table).map((col) => {
                const isPk = !!rootPkColumn && col.name === rootPkColumn
                const target = col.references
                  ? { schema, ...col.references }
                  : undefined
                const variant: 'fk' | 'self-pk' = isPk ? 'self-pk' : 'fk'
                return (
                  <FieldRow
                    key={col.name}
                    col={col}
                    value={root[col.name]}
                    prettyJson={prettyJson}
                    target={target}
                    variant={variant}
                  />
                )
              })}
            </div>
          </section>
        )}

        {detail && detail.children.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
                Incoming references
              </h2>
              <span className="text-xs text-[var(--sea-ink-soft)]">
                {visibleChildren.length} non-empty
                {hiddenEmpty > 0 && ` · ${hiddenEmpty} empty hidden`}
              </span>
              {hiddenEmpty > 0 && (
                <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--sea-ink-soft)]">
                  <input
                    type="checkbox"
                    checked={showEmpty}
                    onChange={(e) => setShowEmpty(e.target.checked)}
                    className="rounded border-[var(--line)]"
                  />
                  Show empty references
                </label>
              )}
            </div>
            {visibleChildren.length === 0 ? (
              <p className="text-xs text-[var(--sea-ink-soft)]">No related rows in any child table.</p>
            ) : (
              visibleChildren.map((child) => {
                const parentValue = root ? root[child.toColumn] : null
                const childTableInfo = introspectQuery.data?.tables.find(
                  (t) => t.name === child.table,
                )
                return (
                  <ChildGroup
                    key={child.table + child.fkColumn}
                    schema={schema}
                    child={child}
                    parentValue={parentValue}
                    prettyJson={prettyJson}
                    childTableInfo={childTableInfo}
                    fks={fks}
                  />
                )
              })
            )}
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
  target,
  variant = 'fk',
}: {
  col: ColumnInfo
  value: JsonValue | undefined
  prettyJson: boolean
  target?: { schema: string; table: string; column: string }
  variant?: 'fk' | 'pk' | 'self-pk'
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
        <LinkableValue
          value={value}
          prettyJson={prettyJson}
          target={target}
          variant={variant}
        />
        {isJson && prettyJson && (
          <pre className="mt-1 overflow-x-auto rounded-md bg-[rgba(0,0,0,0.03)] p-2 text-[11px] leading-relaxed text-[var(--sea-ink)] dark:bg-[rgba(255,255,255,0.04)]">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </span>
    </>
  )
}

/** Long values (e.g. bytea hex, big JSON) are truncated so the dump stays
 *  readable when pasted into an LLM. */
const MAX_VALUE_CHARS = 300
/** Max reference rows fetched per child table for the dump. */
const MAX_REF_ROWS = 50

/** Serialize a single value for the LLM-friendly text dump. */
function fmtValue(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return 'NULL'
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (s.length > MAX_VALUE_CHARS) {
    return `${s.slice(0, MAX_VALUE_CHARS)}…[+${s.length - MAX_VALUE_CHARS} chars]`
  }
  return s
}

function fmtRow(columns: ColumnInfo[], row: Record<string, JsonValue>, indent = ''): string[] {
  const cols = columns.length > 0 ? columns : Object.keys(row).map((name) => ({ name, dataType: '' }) as ColumnInfo)
  return cols.map((c) => `${indent}${c.name} (${c.dataType}): ${fmtValue(row[c.name])}`)
}

/**
 * Build a plain-text dump of the row detail page for pasting into an LLM:
 * root row fields plus every non-empty incoming reference. Reference rows are
 * fetched on demand (they lazy-load per group in the UI), capped per table.
 */
async function buildRowText(
  detail: RowDetail,
  schema: string,
  table: string,
  id: string,
  label: string | null,
): Promise<string> {
  const lines: string[] = []
  lines.push(`# ${schema}.${table} — row ${id}`)
  if (label) lines.push(`label: ${label}`)
  lines.push('', '## Row')
  if (detail.root) {
    lines.push(...fmtRow(detail.columns, detail.root))
  } else {
    lines.push('(no row found)')
    return lines.join('\n')
  }

  const refs = detail.children.filter((c) => c.total > 0)
  if (refs.length > 0) {
    lines.push('', '## Incoming references')
    for (const c of refs) {
      const parentValue = detail.root[c.toColumn]
      const limit = Math.min(c.total, MAX_REF_ROWS)
      const header = `### ${c.table} (${c.total}) via ${c.fkColumn} → ${c.toColumn}`
      if (parentValue === null || parentValue === undefined) {
        lines.push('', header, '(parent value null — skipped)')
        continue
      }
      let res
      try {
        res = await $getRowChildren({
          data: {
            schema,
            childTable: c.table,
            fkColumn: c.fkColumn,
            parentValue: String(parentValue),
            limit,
            offset: 0,
          },
        })
      } catch {
        lines.push('', header, '(failed to load rows)')
        continue
      }
      lines.push('', header)
      if (c.total > limit) lines.push(`(showing first ${limit} of ${c.total})`)
      res.rows.forEach((row, i) => {
        lines.push(`- [${i + 1}]`)
        lines.push(...fmtRow(res.columns ?? [], row, '  '))
      })
    }
  }
  return lines.join('\n')
}

function CopyPageButton({
  detail,
  schema,
  table,
  id,
  label,
}: {
  detail: RowDetail
  schema: string
  table: string
  id: string
  label: string | null
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  return (
    <button
      type="button"
      disabled={state === 'busy'}
      onClick={async () => {
        setState('busy')
        try {
          const text = await buildRowText(detail, schema, table, id, label)
          await navigator.clipboard.writeText(text)
          setState('done')
          setTimeout(() => setState('idle'), 1500)
        } catch {
          setState('idle')
        }
      }}
      className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2.5 py-1 text-xs text-[var(--sea-ink)] transition hover:bg-[var(--surface)] disabled:opacity-50"
      title="Copy row + references as text for pasting into an LLM"
    >
      {state === 'busy' ? 'Copying…' : state === 'done' ? 'Copied ✓' : 'Copy for LLM'}
    </button>
  )
}

const CHILD_PAGE_SIZE = 25

function ChildGroup({
  schema,
  child,
  parentValue,
  prettyJson,
  childTableInfo,
  fks,
}: {
  schema: string
  child: RowChildGroup
  parentValue: JsonValue | null
  prettyJson: boolean
  childTableInfo?: TableInfo
  fks: ForeignKey[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(1)
  const offset = (page - 1) * CHILD_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(child.total / CHILD_PAGE_SIZE))
  const canFetch =
    expanded &&
    child.total > 0 &&
    parentValue !== null &&
    parentValue !== undefined

  const rowsQuery = useQuery({
    queryKey: [
      'rowChildren',
      schema,
      child.table,
      child.fkColumn,
      String(parentValue ?? ''),
      page,
      CHILD_PAGE_SIZE,
    ],
    queryFn: () =>
      $getRowChildren({
        data: {
          schema,
          childTable: child.table,
          fkColumn: child.fkColumn,
          parentValue: String(parentValue ?? ''),
          limit: CHILD_PAGE_SIZE,
          offset,
        },
      }),
    enabled: canFetch,
    staleTime: 30_000,
  })

  const rows = rowsQuery.data?.rows ?? []
  const childColumns = rowsQuery.data?.columns ?? childTableInfo?.columns ?? []
  const enrichedChildColumns = useMemo(
    () => enrichColumnsWithFks(childColumns, fks, child.table),
    [childColumns, fks, child.table],
  )
  const childPkColumn = childTableInfo?.pkColumn ?? null
  const start = child.total === 0 ? 0 : offset + 1
  const end = Math.min(child.total, offset + rows.length)

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
          {child.total === 0 ? (
            <p className="px-2 py-2 text-xs text-[var(--sea-ink-soft)]">No related rows.</p>
          ) : rowsQuery.isLoading ? (
            <p className="px-2 py-2 text-xs text-[var(--sea-ink-soft)]">Loading rows...</p>
          ) : rowsQuery.error ? (
            <p className="px-2 py-2 text-xs text-red-500">
              Failed to load rows: {String(rowsQuery.error)}
            </p>
          ) : (
            rows.map((row, i) => (
              <ChildRow
                key={offset + i}
                schema={schema}
                table={child.table}
                row={row}
                prettyJson={prettyJson}
                columns={enrichedChildColumns}
                pkColumn={childPkColumn}
              />
            ))
          )}
          {child.total > CHILD_PAGE_SIZE && (
            <div className="flex items-center justify-end gap-2 px-2 pt-1 text-[11px] text-[var(--sea-ink-soft)]">
              <span>
                {start}–{end} of {child.total}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || rowsQuery.isFetching}
                className="rounded border border-[var(--line)] px-1.5 py-0.5 hover:bg-[var(--surface-strong)] disabled:opacity-30"
              >
                ‹
              </button>
              <span className="tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || rowsQuery.isFetching}
                className="rounded border border-[var(--line)] px-1.5 py-0.5 hover:bg-[var(--surface-strong)] disabled:opacity-30"
              >
                ›
              </button>
            </div>
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
  columns,
  pkColumn,
}: {
  schema: string
  table: string
  row: Record<string, JsonValue>
  prettyJson: boolean
  columns: ColumnInfo[]
  pkColumn: string | null
}) {
  const renderableColumns =
    columns.length > 0
      ? columns
      : Object.keys(row).map(
          (name): ColumnInfo => ({ name, dataType: '', isNullable: true }),
        )
  const pkValue = pkColumn ? row[pkColumn] : undefined
  return (
    <div className="rounded-lg bg-[rgba(0,0,0,0.02)] px-3 py-2 dark:bg-[rgba(255,255,255,0.03)]">
      {pkColumn && pkValue !== undefined && pkValue !== null && (
        <div className="mb-1 text-[11px] text-[var(--sea-ink-soft)]">
          <Link
            to="/t/$schema/$table/row/$id"
            params={{ schema, table, id: String(pkValue) }}
            search={pkColumn !== 'id' ? { col: pkColumn } : {}}
            className="font-mono text-[var(--lagoon-deep)] hover:underline"
          >
            #{String(pkValue)}
          </Link>
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono text-[12px]">
        {renderableColumns.map((col) => {
          const isPk = !!pkColumn && col.name === pkColumn
          const target = col.references
            ? { schema, ...col.references }
            : isPk
              ? { schema, table, column: col.name }
              : undefined
          const variant: 'fk' | 'pk' = isPk ? 'pk' : 'fk'
          return (
            <FieldRow
              key={col.name}
              col={col}
              value={row[col.name]}
              prettyJson={prettyJson}
              target={target}
              variant={variant}
            />
          )
        })}
      </div>
    </div>
  )
}
