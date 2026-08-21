import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { $getTableTypes } from '#/server/api'
import { groupDigits, sequenceHealth } from '#/lib/inspect/sequence'
import { formatPercent } from '#/lib/inspect/stats'
import { conditionForValue } from '#/lib/inspect/value-filter'
import { hasCondition } from '#/lib/filter-model'
import type { Condition } from '#/lib/filter-model'
import type { EnumType, SequenceInfo } from '#/lib/types'

/**
 * The two things a column's type alone will not tell you: which labels an enum
 * actually allows, and how much room its sequence has left.
 *
 * Enum labels are clickable when exactly one column uses the type — then the
 * label is unambiguous as a filter. Sequence numbers are read from
 * `pg_sequences`, which observes the counter without advancing it.
 */
export default function TypesTab({
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
  const typesQuery = useQuery({
    queryKey: ['tableTypes', database, schema, table],
    queryFn: () => $getTableTypes({ data: { database, schema, table } }),
    staleTime: 5 * 60_000,
  })

  if (typesQuery.isLoading) {
    return <div className="h-32 animate-pulse rounded-lg bg-[rgba(79,184,178,0.06)]" />
  }
  if (typesQuery.error) {
    return (
      <p className="text-xs text-red-700 dark:text-red-300">
        Could not read types: {String(typesQuery.error)}
      </p>
    )
  }
  const types = typesQuery.data
  if (!types) return null

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
          Enums
        </h4>
        {types.enums.length === 0 ? (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            No column of this table uses an enum type.
          </p>
        ) : (
          types.enums.map((enumType) => (
            <EnumCard
              key={enumType.name}
              enumType={enumType}
              conditions={conditions}
              onToggleCondition={onToggleCondition}
            />
          ))
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
          Sequences
        </h4>
        {types.sequences.length === 0 ? (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            No sequence feeds a column of this table — its keys come from somewhere else.
          </p>
        ) : (
          types.sequences.map((sequence) => <SequenceCard key={sequence.name} sequence={sequence} />)
        )}
      </section>
    </div>
  )
}

function EnumCard({
  enumType,
  conditions,
  onToggleCondition,
}: {
  enumType: EnumType
  conditions: Condition[]
  onToggleCondition: (condition: Condition) => void
}) {
  // One column means a clicked label can only mean one thing. Two or more and a
  // filter would have to guess which column you meant, so the labels stay text.
  const soleColumn = enumType.columns.length === 1 ? enumType.columns[0] : null

  return (
    <div className="rounded-lg border border-[var(--line)] p-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-[12px] font-semibold text-[var(--sea-ink)]">{enumType.name}</span>
        <span className="text-[10px] text-[var(--sea-ink-soft)]">
          {enumType.labels.length} labels · {enumType.columns.join(', ')}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {enumType.labels.map((label) => {
          const candidate = soleColumn === null ? null : conditionForValue(soleColumn, label)
          const active = candidate !== null && hasCondition(conditions, candidate)
          if (!soleColumn) {
            return (
              <span
                key={label}
                title={`Used by ${enumType.columns.length} columns — filter from the column header instead`}
                className="rounded border border-[var(--line)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--sea-ink)]"
              >
                {label}
              </span>
            )
          }
          return (
            <button
              key={label}
              type="button"
              aria-pressed={active}
              onClick={() => candidate && onToggleCondition(candidate)}
              title={
                active
                  ? `Clear the filter on ${soleColumn}`
                  : `Filter the rows below to ${soleColumn} = ${label}`
              }
              className={`rounded border px-1.5 py-0.5 font-mono text-[11px] transition ${
                active
                  ? 'border-[var(--lagoon)] bg-[rgba(79,184,178,0.18)] text-[var(--lagoon-deep)]'
                  : 'border-[var(--line)] text-[var(--sea-ink)] hover:border-[var(--lagoon)] hover:bg-[rgba(79,184,178,0.08)]'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const LEVEL_STYLES: Record<string, { bar: string; text: string }> = {
  ok: { bar: 'bg-[var(--lagoon)]', text: 'text-[var(--sea-ink-soft)]' },
  watch: { bar: 'bg-[#d69e2e]', text: 'text-[#8a5a00] dark:text-[#e9c46a]' },
  critical: { bar: 'bg-red-500', text: 'text-red-700 dark:text-red-300' },
  unknown: { bar: 'bg-[rgba(23,58,64,0.25)]', text: 'text-[var(--sea-ink-soft)]' },
}

function SequenceCard({ sequence }: { sequence: SequenceInfo }) {
  const health = sequenceHealth(sequence)
  const styles = LEVEL_STYLES[health.level]
  const usedPct = health.usedFrac === null ? 0 : Math.min(100, health.usedFrac * 100)

  return (
    <div className="rounded-lg border border-[var(--line)] p-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-[12px] font-semibold text-[var(--sea-ink)]">{sequence.name}</span>
        <span className="text-[10px] text-[var(--sea-ink-soft)]">
          feeds <span className="font-mono">{sequence.column}</span> {sequence.columnType} · sequence{' '}
          {sequence.dataType}
          {sequence.cycles && ' · cycles'}
        </span>
      </div>

      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(23,58,64,0.1)]">
        <div className={`h-full rounded-full ${styles.bar}`} style={{ width: `${usedPct}%` }} />
      </div>

      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="text-[var(--sea-ink-soft)]">at</dt>
        <dd className="font-mono tabular-nums text-[var(--sea-ink)]">
          {groupDigits(sequence.lastValue)}
          {health.usedFrac !== null && (
            <span className={`ml-1.5 ${styles.text}`}>({formatPercent(health.usedFrac)} of ceiling)</span>
          )}
        </dd>

        <dt className="text-[var(--sea-ink-soft)]">ceiling</dt>
        <dd className="font-mono tabular-nums text-[var(--sea-ink)]">
          {groupDigits(health.ceiling)}
          {health.ceilingSource === 'column' && (
            <span
              className="ml-1.5 font-sans text-[var(--sea-ink-soft)]"
              title={`The sequence itself stops at ${groupDigits(sequence.maxValue)}, but a ${sequence.columnType} column cannot hold that — the column is what runs out first.`}
            >
              (limit of the {sequence.columnType} column, not the sequence)
            </span>
          )}
        </dd>

        <dt className="text-[var(--sea-ink-soft)]">left</dt>
        <dd className="font-mono tabular-nums text-[var(--sea-ink)]">{groupDigits(health.remaining)}</dd>

        <dt className="text-[var(--sea-ink-soft)]">column max</dt>
        <dd className="font-mono tabular-nums text-[var(--sea-ink)]">
          {sequence.maxSkipped ? (
            <span className="font-sans text-[var(--sea-ink-soft)]">
              {sequence.maxSkipped === 'timeout'
                ? 'not probed — MAX() ran past its 2s budget'
                : 'not probed — the query was refused'}
            </span>
          ) : (
            <>
              {groupDigits(sequence.columnMax)}
              {health.drift !== null && (
                <span className="ml-1.5 text-[var(--sea-ink-soft)]">
                  (sequence leads by {groupDigits(health.drift)})
                </span>
              )}
            </>
          )}
        </dd>
      </dl>

      {health.behindColumn && (
        <p className="mt-1.5 rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          The column already holds a value above the sequence — the next insert collides. A restore
          or a manual insert usually did this; the sequence needs setting forward.
        </p>
      )}
      {!health.behindColumn && health.level === 'critical' && (
        <p className="mt-1.5 rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          Past 90% of what this type can hold. {sequence.cycles
            ? 'It cycles, so it will wrap and collide with live keys.'
            : 'Inserts fail outright when it runs out — widen the column before then.'}
        </p>
      )}
      {health.level === 'watch' && (
        <p className="mt-1.5 text-[11px] text-[#8a5a00] dark:text-[#e9c46a]">
          Past 70% of the ceiling — worth planning a widening.
        </p>
      )}
    </div>
  )
}
