import PressureSection, { CappedList, Chip, Meter, TableLink } from '#/components/pressure/PressureSection'
import { formatPercent } from '#/lib/inspect/stats'
import { groupDigits, sequenceHealth } from '#/lib/inspect/sequence'
import type { SchemaPressure, SchemaSequenceEntry } from '#/lib/types'

/**
 * Every sequence in the schema, tightest headroom first, measured against
 * whichever ceiling binds: its own `max_value`, or what the column it feeds can
 * hold. The second is usually the real one — a `bigint` sequence on an `integer`
 * column runs out four billion values early.
 *
 * No `MAX(column)` probe here, so drift is not shown: it is one query per
 * sequence, affordable for a single table (the inspector does it) and not for a
 * whole schema. Open the table's Types tab for that.
 */
export default function SequenceSection({ pressure }: { pressure: SchemaPressure }) {
  const { schema, sequences } = pressure
  const ranked = [...sequences].sort((a, b) => {
    const left = sequenceHealth(a).usedFrac
    const right = sequenceHealth(b).usedFrac
    return (right ?? -1) - (left ?? -1)
  })
  const pressing = ranked.filter((entry) => {
    const level = sequenceHealth(entry).level
    return level === 'critical' || level === 'watch'
  }).length

  return (
    <PressureSection
      id="sequences"
      title="Sequence headroom"
      count={
        pressing > 0
          ? `${pressing} of ${sequences.length} past 70% of their ceiling`
          : `${sequences.length} sequences, all with room`
      }
      rule="Consumed share of the tighter of two ceilings: the sequence's own maximum, and the largest value its column's type can hold."
    >
      <CappedList
        items={ranked}
        cap={10}
        keyOf={(entry) => `${entry.table}.${entry.name}`}
        empty="No sequence feeds any column in this schema."
        render={(entry) => <SequenceRow schema={schema} entry={entry} />}
      />
    </PressureSection>
  )
}

function SequenceRow({ schema, entry }: { schema: string; entry: SchemaSequenceEntry }) {
  const health = sequenceHealth(entry)
  const critical = health.level === 'critical'
  const watch = health.level === 'watch'

  return (
    <div className="space-y-1 py-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
        <TableLink schema={schema} table={entry.table} />
        <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
          {entry.column} {entry.columnType}
        </span>
        {health.usedFrac !== null && (
          <span className="tabular-nums font-medium text-[var(--sea-ink)]">
            {formatPercent(health.usedFrac)}
          </span>
        )}
        <span className="tabular-nums text-[10px] text-[var(--sea-ink-soft)]">
          {groupDigits(entry.lastValue)} of {groupDigits(health.ceiling)}
        </span>
        {health.ceilingSource === 'column' && (
          <Chip
            title={`The sequence stops at ${groupDigits(entry.maxValue)}, but a ${entry.columnType} column cannot hold that — the column runs out first.`}
          >
            {entry.columnType} column limits it
          </Chip>
        )}
        {critical && <Chip tone="bad">past 90%</Chip>}
        {watch && <Chip tone="warn">past 70%</Chip>}
        {entry.cycles && <Chip tone="warn" title="Wraps around instead of failing — it will collide with live keys">cycles</Chip>}
        {health.usedFrac === null && (
          <span className="text-[10px] text-[var(--sea-ink-soft)]">
            no readable value — the sequence may not be visible to this user
          </span>
        )}
      </div>
      {health.usedFrac !== null && (
        <Meter
          title={`${groupDigits(health.remaining)} values left`}
          segments={[
            {
              pct: health.usedFrac * 100,
              className: critical ? 'bg-red-500' : watch ? 'bg-[#d69e2e]' : 'bg-[var(--lagoon)]',
              label: 'used',
            },
          ]}
        />
      )}
    </div>
  )
}
