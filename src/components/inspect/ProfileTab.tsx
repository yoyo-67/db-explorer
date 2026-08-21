import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { $getTableProfile } from '#/server/api'
import { formatCompactCount, formatRelativeTime, isStaleAnalyze, truncateValue } from '#/lib/inspect/format'
import {
  commonValueCoverage,
  dominantValue,
  estimateDistinct,
  formatPercent,
  topValues,
} from '#/lib/inspect/stats'
import { conditionForValue, isFilterableValue } from '#/lib/inspect/value-filter'
import { hasCondition } from '#/lib/filter-model'
import type { Condition } from '#/lib/filter-model'
import type { ColumnProfile, TableProfile } from '#/lib/types'

const TOP_VALUE_LIMIT = 6

/**
 * What the planner knows about each column, and nothing else. Every number here
 * comes from the last ANALYZE, so the panel costs the same on a billion rows as
 * on none — and says how old the numbers are instead of implying they are live.
 *
 * The common values are buttons: clicking one filters the rows below to it,
 * which turns the estimate into something you can go and look at.
 */
export default function ProfileTab({
  schema,
  table,
  conditions,
  onToggleCondition,
}: {
  schema: string
  table: string
  conditions: Condition[]
  onToggleCondition: (condition: Condition) => void
}) {
  const database = useDatabaseParam()
  const profileQuery = useQuery({
    queryKey: ['tableProfile', database, schema, table],
    queryFn: () => $getTableProfile({ data: { database, schema, table } }),
    staleTime: 5 * 60_000,
  })

  if (profileQuery.isLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-[rgba(79,184,178,0.06)]" />
  }
  if (profileQuery.error) {
    return (
      <p className="text-xs text-red-700 dark:text-red-300">
        Could not read column statistics: {String(profileQuery.error)}
      </p>
    )
  }
  const profile = profileQuery.data
  if (!profile) return null

  return (
    <div className="space-y-3">
      <StatsFreshness profile={profile} />
      {/* The cells do not wrap (a truncated column name or range is worse than a
          scrollbar), so the table is allowed to outgrow the panel and scroll
          inside it rather than widening the page. */}
      <div className="min-w-0 overflow-x-auto">
        <table className="w-max min-w-full border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-[var(--line)] text-[10px] uppercase tracking-wider text-[var(--sea-ink-soft)]">
              <th className="py-1.5 pr-3 font-semibold">Column</th>
              <th className="py-1.5 pr-3 font-semibold">Nulls</th>
              <th className="py-1.5 pr-3 font-semibold">Distinct</th>
              <th className="py-1.5 pr-3 font-semibold">Common values</th>
              <th className="py-1.5 font-semibold">Range</th>
            </tr>
          </thead>
          <tbody>
            {profile.columns.map((column) => (
              <ColumnRow
                key={column.name}
                column={column}
                estimatedRows={profile.estimatedRows}
                conditions={conditions}
                onToggleCondition={onToggleCondition}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The panel's honesty line: whose numbers these are and how old. */
function StatsFreshness({ profile }: { profile: TableProfile }) {
  const now = Date.now()
  const stale = isStaleAnalyze(profile.lastAnalyze, now)
  const neverAnalyzed = profile.lastAnalyze === null

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--sea-ink-soft)]">
      <span>
        ~<span className="font-semibold text-[var(--sea-ink)]">{formatCompactCount(profile.estimatedRows)}</span> rows
      </span>
      <span aria-hidden>·</span>
      <span>{profile.columns.length} columns</span>
      <span aria-hidden>·</span>
      <span
        className={
          stale
            ? 'rounded bg-[rgba(214,158,46,0.16)] px-1.5 py-0.5 font-medium text-[#8a5a00] dark:text-[#e9c46a]'
            : ''
        }
        title={profile.lastAnalyze ?? 'This table has never been analyzed'}
      >
        {neverAnalyzed
          ? 'never analyzed — no statistics to read'
          : `analyzed ${formatRelativeTime(profile.lastAnalyze, now)}${stale ? ' — estimates may have drifted' : ''}`}
      </span>
      <span aria-hidden>·</span>
      <span>planner estimates, no rows read</span>
    </p>
  )
}

function ColumnRow({
  column,
  estimatedRows,
  conditions,
  onToggleCondition,
}: {
  column: ColumnProfile
  estimatedRows: number
  conditions: Condition[]
  onToggleCondition: (condition: Condition) => void
}) {
  const stats = column.stats
  const distinct = stats ? estimateDistinct(stats.nDistinctRaw, estimatedRows) : null
  const skewed = stats ? dominantValue(stats.commonValues) : null

  return (
    <tr className="border-b border-[var(--line)]/40 align-top">
      <td className="whitespace-nowrap py-2 pr-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="whitespace-nowrap font-mono font-semibold text-[var(--sea-ink)]">
            {column.name}
          </span>
          {column.isPrimaryKey && <Badge title="Primary key">pk</Badge>}
          {!column.isPrimaryKey && column.indexed && (
            <Badge title="Leading column of an index — filtering on it is cheap">idx</Badge>
          )}
          {column.notNull && <Badge title="Declared NOT NULL">not null</Badge>}
          {skewed && (
            <Badge title={`One value covers ${formatPercent(skewed.freq)} of the rows — an index here buys little`}>
              skewed
            </Badge>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-[var(--sea-ink-soft)]/80">{column.dataType}</div>
        {column.comment && (
          <div className="mt-0.5 max-w-[24rem] text-[11px] text-[var(--sea-ink-soft)]">{column.comment}</div>
        )}
      </td>

      {stats === null ? (
        <td colSpan={4} className="py-2 text-[11px] italic text-[var(--sea-ink-soft)]">
          no statistics for this column — never analyzed, or not visible to this user
        </td>
      ) : (
        <>
          <td className="py-2 pr-3 whitespace-nowrap">
            <NullMeter fraction={stats.nullFrac} />
          </td>
          <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-[var(--sea-ink)]">
            {distinct?.kind === 'unknown' ? (
              <span className="text-[var(--sea-ink-soft)]">unknown</span>
            ) : distinct?.kind === 'unique' ? (
              <span title="Every row differs (n_distinct = -1)">all distinct</span>
            ) : (
              <span title={distinct?.kind === 'ratio' ? 'A fraction of the row estimate' : 'An absolute estimate'}>
                ~{formatCompactCount(distinct?.count ?? -1)}
              </span>
            )}
          </td>
          <td className="py-2 pr-3">
            <CommonValues
              column={column.name}
              stats={stats}
              conditions={conditions}
              onToggleCondition={onToggleCondition}
            />
          </td>
          <td className="whitespace-nowrap py-2 font-mono text-[11px] text-[var(--sea-ink-soft)]">
            {stats.range ? (
              <span title={`${stats.range.low} … ${stats.range.high}`}>
                {truncateValue(stats.range.low, 18)} … {truncateValue(stats.range.high, 18)}
              </span>
            ) : (
              <span className="opacity-60">—</span>
            )}
          </td>
        </>
      )}
    </tr>
  )
}

function CommonValues({
  column,
  stats,
  conditions,
  onToggleCondition,
}: {
  column: string
  stats: NonNullable<ColumnProfile['stats']>
  conditions: Condition[]
  onToggleCondition: (condition: Condition) => void
}) {
  const values = topValues(stats.commonValues, TOP_VALUE_LIMIT)
  if (values.length === 0) {
    return <span className="text-[11px] text-[var(--sea-ink-soft)]/70">no repeated values recorded</span>
  }
  const coverage = commonValueCoverage(stats.commonValues)

  return (
    // Bounded so the chips wrap onto a second line instead of stretching the
    // column — this is the one cell whose content has no natural width.
    <div className="w-[22rem] max-w-[22rem] space-y-1">
      <div className="flex flex-wrap gap-1">
        {values.map((value) => {
          const candidate = conditionForValue(column, value.value)
          const active = hasCondition(conditions, candidate)
          const disabled = !isFilterableValue(value.value)
          const shown = value.value === null ? 'NULL' : truncateValue(value.value)
          return (
            <button
              key={`${value.value}`}
              type="button"
              disabled={disabled}
              onClick={() => onToggleCondition(candidate)}
              aria-pressed={active}
              title={
                disabled
                  ? 'This value cannot be expressed as a filter'
                  : `${value.value === null ? 'NULL' : value.value} — ${formatPercent(value.freq)} of rows. ${
                      active ? 'Click to clear the filter.' : 'Click to filter the rows below to it.'
                    }`
              }
              className={`group flex max-w-full items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[11px] transition ${
                active
                  ? 'border-[var(--lagoon)] bg-[rgba(79,184,178,0.18)] text-[var(--lagoon-deep)]'
                  : 'border-[var(--line)] text-[var(--sea-ink)] hover:border-[var(--lagoon)] hover:bg-[rgba(79,184,178,0.08)]'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span
                className={
                  value.value === null
                    ? 'italic opacity-70'
                    : 'max-w-[16rem] truncate break-all'
                }
              >
                {shown}
              </span>
              <span className="tabular-nums text-[10px] text-[var(--sea-ink-soft)]">
                {formatPercent(value.freq, 0)}
              </span>
            </button>
          )
        })}
      </div>
      {stats.commonValues.length > 0 && (
        <p className="text-[10px] text-[var(--sea-ink-soft)]/80">
          top {stats.commonValues.length} cover {formatPercent(coverage)} of rows
          {stats.commonValues.length > values.length && ` · ${stats.commonValues.length - values.length} more not shown`}
        </p>
      )}
    </div>
  )
}

/** Nulls as a bar, because "3.4%" and "34%" look alike in a dense table. */
function NullMeter({ fraction }: { fraction: number }) {
  const pct = Math.min(100, Math.max(0, fraction * 100))
  return (
    <div className="w-24" title={`${formatPercent(fraction)} of rows are NULL`}>
      <div className="tabular-nums text-[var(--sea-ink)]">{formatPercent(fraction)}</div>
      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-[rgba(23,58,64,0.1)]">
        <div
          className="h-full rounded-full bg-[var(--lagoon)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function Badge({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <span
      title={title}
      className="rounded bg-[rgba(79,184,178,0.12)] px-1 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]"
    >
      {children}
    </span>
  )
}
