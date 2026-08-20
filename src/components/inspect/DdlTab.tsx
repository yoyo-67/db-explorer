import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import CopyButton from '#/components/CopyButton'
import { $getTableDdl } from '#/server/api'
import type { DdlIndex, TableDdl } from '#/lib/types'

/**
 * The table as DDL, reconstructed from the catalog: columns with their real
 * declared types (`format_type`, not information_schema's widened names),
 * constraints and comments as Postgres itself renders them.
 *
 * The statements are ordered to be replayable — constraints inside the
 * `CREATE TABLE`, then the indexes no constraint already created, then comments.
 * The full index list is shown separately so a constraint-backed index the SQL
 * deliberately omits is still visible.
 */
export default function DdlTab({ schema, table }: { schema: string; table: string }) {
  const database = useDatabaseParam()
  const ddlQuery = useQuery({
    queryKey: ['tableDdl', database, schema, table],
    queryFn: () => $getTableDdl({ data: { database, schema, table } }),
    staleTime: 5 * 60_000,
  })

  if (ddlQuery.isLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-[rgba(79,184,178,0.06)]" />
  }
  if (ddlQuery.error) {
    return (
      <p className="text-xs text-red-700 dark:text-red-300">
        Could not read the definition: {String(ddlQuery.error)}
      </p>
    )
  }
  const ddl = ddlQuery.data
  if (!ddl) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--sea-ink-soft)]">
        <span>{ddl.columns.length} columns</span>
        <span aria-hidden>·</span>
        <span>{ddl.constraints.length} constraints</span>
        <span aria-hidden>·</span>
        <span>{ddl.indexes.length} indexes</span>
        <CopyButton text={ddl.sql} label="Copy DDL" className="ml-auto" />
      </div>

      <pre className="max-h-[26rem] overflow-auto rounded-lg border border-[var(--line)] bg-[rgba(0,0,0,0.03)] p-3 font-mono text-[12px] leading-relaxed text-[var(--sea-ink)] dark:bg-[rgba(255,255,255,0.04)]">
        {ddl.sql}
      </pre>

      <IndexList indexes={ddl.indexes} />
      <MissingComments ddl={ddl} />
    </div>
  )
}

function IndexList({ indexes }: { indexes: DdlIndex[] }) {
  if (indexes.length === 0) {
    return (
      <p className="text-[11px] text-[var(--sea-ink-soft)]">
        No indexes at all — every filter on this table is a sequential scan.
      </p>
    )
  }
  return (
    <div className="space-y-1">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
        Indexes
      </h4>
      <ul className="space-y-1">
        {indexes.map((index) => (
          <li key={index.name} className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
            <span className="font-mono font-medium text-[var(--sea-ink)]">{index.name}</span>
            {index.isPrimary && <Tag>primary</Tag>}
            {index.isUnique && !index.isPrimary && <Tag>unique</Tag>}
            {index.constraintBacked && (
              <Tag title="Created by a constraint — the DDL above emits the constraint instead">
                from constraint
              </Tag>
            )}
            <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--sea-ink-soft)]" title={index.definition}>
              {index.definition}
            </code>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A schema nobody documented is a schema you have to read the code for — worth
 *  saying once, quietly, rather than leaving the reader to notice. */
function MissingComments({ ddl }: { ddl: TableDdl }) {
  const documented = ddl.columns.filter((c) => c.comment).length
  if (ddl.tableComment && documented === ddl.columns.length) return null
  return (
    <p className="text-[10px] text-[var(--sea-ink-soft)]/80">
      {ddl.tableComment ? 'Table is described' : 'No table comment'} ·{' '}
      {documented} of {ddl.columns.length} columns have a comment
    </p>
  )
}

function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="rounded bg-[rgba(79,184,178,0.12)] px-1 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]"
    >
      {children}
    </span>
  )
}
