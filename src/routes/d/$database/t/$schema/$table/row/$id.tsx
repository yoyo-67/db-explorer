import { createFileRoute, Link } from '@tanstack/react-router'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import LinkableValue from '#/components/LinkableValue'
import {
  $getChildCount,
  $getCrossDbRefs,
  $getRowChildren,
  $getRowDetail,
  $introspect,
} from '#/server/api'
import { useConnectionGuard } from '#/hooks/useConnectionGuard'
import { enrichColumnsWithFks } from '#/lib/fk-resolver'
import { enrichColumnsWithCrossDbRefs } from '#/lib/cross-db-refs'
import { formatJsonText } from '#/lib/json-text'
import { getRowLabel } from '#/lib/row-label'
import TableName from '#/components/TableName'
import type {
  ColumnInfo,
  ForeignKey,
  JsonValue,
  RowChildGroup,
  RowDetail,
  RowOutgoingRef,
  TableInfo,
} from '#/lib/types'

interface RowDetailSearch {
  col?: string
}

export const Route = createFileRoute('/d/$database/t/$schema/$table/row/$id')({
  component: RowDetailPage,
  validateSearch: (search: Record<string, unknown>): RowDetailSearch => ({
    col: typeof search.col === 'string' && search.col.length > 0 ? search.col : undefined,
  }),
})

function RowDetailPage() {
  const database = useDatabaseParam()
  const { schema, table, id } = Route.useParams()
  const { col } = Route.useSearch()
  const { isChecking, isConnected } = useConnectionGuard()
  const [prettyJson, setPrettyJson] = useState(true)
  const [showEmpty, setShowEmpty] = useState(false)

  const detailQuery = useQuery({
    queryKey: ['rowDetail', database, schema, table, id, col ?? ''],
    queryFn: () =>
      $getRowDetail({ data: { database, schema, table, rowId: id, column: col } }),
    enabled: isConnected,
    staleTime: 30_000,
  })

  const introspectQuery = useQuery({
    queryKey: ['introspect', database, schema],
    queryFn: () => $introspect({ data: { database, schema } }),
    enabled: isConnected,
    staleTime: Infinity,
  })

  // Hand-written references out of this database, cached for the session: one
  // read serves the root row and every child table below it.
  const crossRefsQuery = useQuery({
    queryKey: ['crossDbRefs', database],
    queryFn: () => $getCrossDbRefs({ data: { database } }),
    enabled: isConnected,
    staleTime: Infinity,
  })
  const crossRefs = crossRefsQuery.data?.refs ?? []

  const detail = detailQuery.data
  const fks = introspectQuery.data?.fks ?? []
  const root = detail?.root ?? null
  const label = root ? getRowLabel(root, detail?.columns ?? [], fks, table) : null
  const rootTableInfo = introspectQuery.data?.tables.find((t) => t.name === table)
  const rootPkColumn = rootTableInfo?.pkColumn ?? null
  // An uncounted reference is never hidden as "empty": not counted is not zero.
  const visibleChildren = useMemo(() => {
    const all = detail?.children ?? []
    return showEmpty ? all : all.filter((c) => c.total === null || c.total > 0)
  }, [detail, showEmpty])
  const hiddenEmpty = (detail?.children.length ?? 0) - visibleChildren.length
  const uncounted = visibleChildren.filter((c) => c.total === null).length

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
            to="/d/$database/t/$schema/$table"
            params={{ database, schema, table }}
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
            {schema}.<TableName table={table} />
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
              {enrichColumnsWithCrossDbRefs(
                enrichColumnsWithFks(detail.columns, fks, table),
                crossRefs,
                { database, schema, table },
              ).map((col) => {
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
                    crossTarget={col.crossRef}
                    variant={variant}
                  />
                )
              })}
            </div>
          </section>
        )}

        {detail && detail.outgoing.length > 0 && (
          <OutgoingRefs schema={schema} outgoing={detail.outgoing} />
        )}

        {detail && detail.children.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
                Incoming references
              </h2>
              <span className="text-xs text-[var(--sea-ink-soft)]">
                {visibleChildren.length - uncounted} non-empty
                {uncounted > 0 && ` · ${uncounted} not counted`}
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
  crossTarget,
  variant = 'fk',
}: {
  col: ColumnInfo
  value: JsonValue | undefined
  prettyJson: boolean
  target?: { schema: string; table: string; column: string }
  crossTarget?: ColumnInfo['crossRef']
  variant?: 'fk' | 'pk' | 'self-pk'
}) {
  // A `text` column holding a JSON document lays out like a `jsonb` one — the
  // declared type says nothing about what was stored in it.
  const pretty = prettyJson ? formatJsonText(value) : null
  return (
    <>
      <span className="whitespace-nowrap py-0.5 text-xs font-semibold text-[var(--sea-ink-soft)]">
        {col.name}
        <span className="ml-1 text-[10px] font-normal text-[var(--sea-ink-soft)]/60">
          {col.dataType}
        </span>
      </span>
      <span className="min-w-0 break-all py-0.5 text-[var(--sea-ink)]">
        {pretty !== null ? (
          <pre className="overflow-x-auto rounded-md bg-[rgba(0,0,0,0.03)] p-2 text-[11px] leading-relaxed text-[var(--sea-ink)] dark:bg-[rgba(255,255,255,0.04)]">
            {pretty}
          </pre>
        ) : (
          <LinkableValue
            value={value}
            prettyJson={prettyJson}
            target={target}
            crossTarget={crossTarget}
            variant={variant}
          />
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
  const cols = columns.length > 0 ? columns : Object.keys(row).map((name) => (({
    name,
    dataType: ''
  }) as ColumnInfo))
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
  const database = useDatabaseParam()
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

  const outgoing = detail.outgoing.filter((o) => o.value !== null)
  if (outgoing.length > 0) {
    lines.push('', '## Outgoing references')
    for (const o of outgoing) {
      const resolves =
        o.resolves === null ? 'unchecked' : o.resolves ? 'resolves' : 'DANGLING'
      lines.push(
        `- ${o.column} → ${o.targetTable}.${o.targetColumn} = ${fmtValue(o.value)} ` +
          `[${o.basis}, ${resolves}]`,
      )
    }
  }

  // Uncounted references are listed but not fetched: the count was skipped
  // precisely because scanning them is expensive.
  const uncounted = detail.children.filter((c) => c.total === null)
  const refs = detail.children.filter((c) => c.total !== null && c.total > 0)
  if (uncounted.length > 0) {
    lines.push('', '## Incoming references, not counted')
    for (const c of uncounted) {
      lines.push(
        `- ${c.table} via ${c.fkColumn} → ${c.toColumn} [${c.basis}, ${c.countSkipped}]`,
      )
    }
  }
  if (refs.length > 0) {
    lines.push('', '## Incoming references')
    for (const c of refs) {
      const total = c.total ?? 0
      const parentValue = detail.root[c.toColumn]
      const limit = Math.min(total, MAX_REF_ROWS)
      const header = `### ${c.table} (${total}) via ${c.fkColumn} → ${c.toColumn}`
      if (parentValue === null || parentValue === undefined) {
        lines.push('', header, '(parent value null — skipped)')
        continue
      }
      let res
      try {
        res = await $getRowChildren({
          data: {
            database,
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
      if (total > limit) lines.push(`(showing first ${limit} of ${total})`)
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
  const database = useDatabaseParam()
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(1)
  const [countRequested, setCountRequested] = useState(false)
  const offset = (page - 1) * CHILD_PAGE_SIZE
  const hasParentValue = parentValue !== null && parentValue !== undefined

  // The eager batch skipped this one; count it only when asked (BUILD-SPEC §5.2).
  const countQuery = useQuery({
    queryKey: [
      'childCount',
      database,
      schema,
      child.table,
      child.fkColumn,
      String(parentValue ?? ''),
    ],
    queryFn: () =>
      $getChildCount({
        data: {
          database,
          schema,
          childTable: child.table,
          fkColumn: child.fkColumn,
          parentValue: String(parentValue ?? ''),
        },
      }),
    enabled: countRequested && child.total === null && hasParentValue,
    staleTime: 60_000,
  })

  const total = child.total ?? countQuery.data?.total ?? null
  const totalPages = Math.max(1, Math.ceil((total ?? 0) / CHILD_PAGE_SIZE))
  // Expanding an uncounted reference still fetches its first page: the page is a
  // LIMIT, which is cheap, unlike the COUNT(*) that was skipped.
  const canFetch = expanded && total !== 0 && hasParentValue

  const rowsQuery = useQuery({
    queryKey: [
      'rowChildren',
      database,
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
          database,
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

  const crossRefsQuery = useQuery({
    queryKey: ['crossDbRefs', database],
    queryFn: () => $getCrossDbRefs({ data: { database } }),
    staleTime: Infinity,
  })
  const crossRefs = crossRefsQuery.data?.refs ?? []

  const rows = rowsQuery.data?.rows ?? []
  const childColumns = rowsQuery.data?.columns ?? childTableInfo?.columns ?? []
  const enrichedChildColumns = useMemo(
    () =>
      enrichColumnsWithCrossDbRefs(
        enrichColumnsWithFks(childColumns, fks, child.table),
        crossRefs,
        { database, schema, table: child.table },
      ),
    [childColumns, fks, child.table, crossRefs, database, schema],
  )
  const childPkColumn = childTableInfo?.pkColumn ?? null
  const start = total === 0 ? 0 : offset + 1
  const end = total === null ? offset + rows.length : Math.min(total, offset + rows.length)

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
          to="/d/$database/t/$schema/$table"
          params={{ database, schema, table: child.table }}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-semibold text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
        >
          <TableName table={child.table} />
        </Link>
        {total !== null ? (
          <span className="rounded-full bg-[rgba(79,184,178,0.14)] px-2 py-0.5 text-xs tabular-nums text-[var(--lagoon-deep)]">
            {total.toLocaleString()}
          </span>
        ) : (
          <CountOnDemand
            skipped={child.countSkipped}
            state={
              !countRequested
                ? 'idle'
                : countQuery.isFetching
                  ? 'busy'
                  : countQuery.data?.timedOut
                    ? 'timeout'
                    : countQuery.error
                      ? 'error'
                      : 'idle'
            }
            disabled={!hasParentValue}
            onCount={(e) => {
              e.stopPropagation()
              setCountRequested(true)
            }}
          />
        )}
        <span className="text-[10px] text-[var(--sea-ink-soft)]">
          via {child.fkColumn} → {child.toColumn}
        </span>
        {child.basis !== 'declared' && (
          <span
            className="rounded-full border border-dashed border-[var(--line)] px-1.5 text-[10px] text-[var(--sea-ink-soft)]"
            title={
              child.basis === 'model'
                ? 'Django relation with no database constraint — authoritative, but unenforced.'
                : 'Inferred from the column name, where no Django relation described it.'
            }
          >
            {child.basis}
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-[var(--line)] p-3">
          {total === 0 ? (
            <p className="px-2 py-2 text-xs text-[var(--sea-ink-soft)]">No related rows.</p>
          ) : !hasParentValue ? (
            <p className="px-2 py-2 text-xs text-[var(--sea-ink-soft)]">
              The referenced value on this row is null, so nothing can point at it.
            </p>
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
          {(total === null ? rows.length === CHILD_PAGE_SIZE : total > CHILD_PAGE_SIZE) && (
            <div className="flex items-center justify-end gap-2 px-2 pt-1 text-[11px] text-[var(--sea-ink-soft)]">
              <span>
                {start}–{end} of {total === null ? 'an uncounted total' : total}
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
                {page} / {total === null ? '?' : totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => (total === null ? p + 1 : Math.min(totalPages, p + 1)))}
                disabled={
                  rowsQuery.isFetching ||
                  (total === null ? rows.length < CHILD_PAGE_SIZE : page >= totalPages)
                }
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

const COUNT_SKIP_HINT: Record<string, string> = {
  unindexed:
    'Not counted: the referencing column has no index, so COUNT(*) would scan the whole table. 45% of inferred columns are unindexed.',
  large:
    'Not counted: the referencing table is estimated at or above the 100k-row exact-count threshold. The estimate is pg_class.reltuples, which is what stops a never-analyzed table reading as empty.',
  timeout: 'Not counted: the eager batch ran out of its time budget.',
}

/**
 * "Not counted" says so, and offers to count this one table. Never a zero — a
 * skipped count and an empty reference are different facts.
 */
function CountOnDemand({
  skipped,
  state,
  disabled,
  onCount,
}: {
  skipped: RowChildGroup['countSkipped']
  state: 'idle' | 'busy' | 'timeout' | 'error'
  disabled: boolean
  onCount: (e: React.MouseEvent) => void
}) {
  if (disabled) {
    return (
      <span className="rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--sea-ink-soft)]">
        parent value null
      </span>
    )
  }
  const label =
    state === 'busy'
      ? 'counting…'
      : state === 'timeout'
        ? 'timed out'
        : state === 'error'
          ? 'count failed'
          : 'not counted · count'
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onCount}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onCount(e as unknown as React.MouseEvent)
      }}
      title={skipped ? COUNT_SKIP_HINT[skipped] : undefined}
      className="cursor-pointer rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]"
    >
      {label}
    </span>
  )
}

/**
 * The steerable hops out of this row (BUILD-SPEC §2.2). These are primary-key
 * lookups, so they are counted exactly and eagerly — and a dangling one is worth
 * saying out loud, since an inferred edge carries no database constraint to stop
 * it happening.
 */
function OutgoingRefs({
  schema,
  outgoing,
}: {
  schema: string
  outgoing: RowOutgoingRef[]
}) {
  const database = useDatabaseParam()
  const set = outgoing.filter((o) => o.value !== null)
  const dangling = set.filter((o) => o.resolves === false)
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
          Outgoing references
        </h2>
        <span className="text-xs text-[var(--sea-ink-soft)]">
          {set.length} of {outgoing.length} set
          {dangling.length > 0 && ` · ${dangling.length} dangling`}
        </span>
      </div>
      <div className="island-shell rounded-xl">
        <ul className="divide-y divide-[var(--line)]/60">
          {outgoing.map((o) => (
            <li
              key={o.column}
              className="flex flex-wrap items-baseline gap-x-2 px-4 py-1.5 font-mono text-[11px]"
            >
              <span className="text-[var(--sea-ink-soft)]">{o.column}</span>
              <span className="text-[var(--sea-ink-soft)]">→</span>
              {o.value !== null && o.resolves !== false ? (
                <Link
                  to="/d/$database/t/$schema/$table/row/$id"
                  params={{ database, schema, table: o.targetTable, id: String(o.value) }}
                  search={o.targetColumn !== 'id' ? { col: o.targetColumn } : {}}
                  className="text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
                >
                  {o.targetTable}.{o.targetColumn}
                </Link>
              ) : (
                <span className="text-[var(--sea-ink)]">
                  {o.targetTable}.{o.targetColumn}
                </span>
              )}
              <span className="break-all text-[var(--sea-ink-soft)]">
                = {o.value === null ? 'null' : String(o.value)}
              </span>
              {o.basis !== 'declared' && (
                <span className="rounded-full border border-dashed border-[var(--line)] px-1.5 text-[10px] not-italic text-[var(--sea-ink-soft)]">
                  {o.basis}
                </span>
              )}
              {o.resolves === false && (
                <span
                  className="rounded-full bg-red-500/15 px-1.5 text-[10px] text-red-500"
                  title="No row in the target table has this value. An inferred edge has no constraint behind it, so this can happen."
                >
                  dangling
                </span>
              )}
              {o.resolves === null && o.value !== null && (
                <span
                  className="text-[10px] text-[var(--sea-ink-soft)]/70"
                  title="The existence check did not complete within its time budget."
                >
                  unchecked
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
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
  const database = useDatabaseParam()
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
            to="/d/$database/t/$schema/$table/row/$id"
            params={{ database, schema, table, id: String(pkValue) }}
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
