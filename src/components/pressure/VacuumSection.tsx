import PressureSection, { CappedList, Chip, Meter, TableLink } from '#/components/pressure/PressureSection'
import { formatCompactCount, formatRelativeTime } from '#/lib/inspect/format'
import { formatPercent } from '#/lib/inspect/stats'
import {
  byVacuumPressure,
  deadRatio,
  lastAnalyzedAt,
  lastVacuumedAt,
  vacuumLevel,
} from '#/lib/pressure/vacuum'
import type { SchemaPressure, TableVacuumEntry } from '#/lib/types'

/**
 * Vacuum debt: the rows updates and deletes left behind, and whether autovacuum
 * is keeping up. A table past its own trigger while still holding the dead rows
 * is the interesting case — autovacuum is disabled, starved, or blocked.
 */
export default function VacuumSection({ pressure }: { pressure: SchemaPressure }) {
  const { schema, vacuum } = pressure
  const ranked = [...vacuum].sort(byVacuumPressure)
  const overdue = ranked.filter((entry) => vacuumLevel(entry) === 'overdue').length
  const watch = ranked.filter((entry) => vacuumLevel(entry) === 'watch').length

  return (
    <PressureSection
      id="vacuum"
      title="Vacuum debt"
      count={`${overdue} past their trigger · ${watch} worth watching`}
      rule="Dead tuples against each table's own autovacuum trigger (threshold + scale factor × rows, per-table settings included)."
    >
      <CappedList
        items={ranked}
        keyOf={(entry) => entry.table}
        empty="No statistics rows for this schema."
        render={(entry) => <VacuumRow schema={schema} entry={entry} />}
      />
    </PressureSection>
  )
}

const LEVEL_CHIP = {
  overdue: { tone: 'bad' as const, label: 'past trigger' },
  watch: { tone: 'warn' as const, label: 'watch' },
  ok: null,
  unknown: null,
}

function VacuumRow({ schema, entry }: { schema: string; entry: TableVacuumEntry }) {
  const level = vacuumLevel(entry)
  const ratio = deadRatio(entry)
  const chip = LEVEL_CHIP[level]
  const now = Date.now()
  const vacuumed = lastVacuumedAt(entry)
  const analyzed = lastAnalyzedAt(entry)

  return (
    <div className="space-y-1 py-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
        <TableLink schema={schema} table={entry.table} />
        {chip && (
          <Chip
            tone={chip.tone}
            title={
              entry.vacuumThreshold === null
                ? 'Autovacuum is switched off for this table'
                : `${formatCompactCount(entry.deadTuples)} dead against a trigger of ${formatCompactCount(entry.vacuumThreshold)}`
            }
          >
            {chip.label}
          </Chip>
        )}
        <span className="tabular-nums text-[var(--sea-ink)]">
          {formatCompactCount(entry.deadTuples)} dead
        </span>
        {ratio !== null && (
          <span className="tabular-nums text-[10px] text-[var(--sea-ink-soft)]">
            {formatPercent(ratio)} of tuples
          </span>
        )}
        <span className="text-[10px] text-[var(--sea-ink-soft)]">
          {entry.vacuumThreshold === null
            ? 'autovacuum off'
            : `trigger ${formatCompactCount(entry.vacuumThreshold)}`}
        </span>
        <span className="ml-auto text-[10px] text-[var(--sea-ink-soft)]">
          vacuumed {formatRelativeTime(vacuumed, now)} · analyzed {formatRelativeTime(analyzed, now)}
          {entry.modsSinceAnalyze > 0 &&
            ` · ${formatCompactCount(entry.modsSinceAnalyze)} changes since`}
        </span>
      </div>
      {ratio !== null && (
        <Meter
          title={`${formatPercent(ratio)} of this table's tuples are dead`}
          segments={[
            {
              pct: ratio * 100,
              className: level === 'overdue' ? 'bg-red-500' : 'bg-[#d69e2e]',
              label: 'dead',
            },
          ]}
        />
      )}
    </div>
  )
}
