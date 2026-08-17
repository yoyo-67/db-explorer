import CopyButton from '#/components/CopyButton'
import PressureSection, { CappedList, Chip, TableLink } from '#/components/pressure/PressureSection'
import { formatCompactCount, formatRelativeTime } from '#/lib/inspect/format'
import {
  analyzeFindings,
  analyzeSql,
  analyzeState,
  isBlindAndLarge,
} from '#/lib/pressure/analyze'
import { lastAnalyzedAt } from '#/lib/pressure/vacuum'
import type { SchemaPressure, TableVacuumEntry } from '#/lib/types'

/**
 * Tables the planner cannot see properly. A never-analyzed table plans against
 * built-in defaults — which is how a join over millions of rows ends up as a
 * nested loop — and a table changed heavily since its last analyze is the
 * softer version of the same thing.
 *
 * Read off statistics this page already fetched; no extra query.
 */
export default function AnalyzeSection({ pressure }: { pressure: SchemaPressure }) {
  const { schema, vacuum } = pressure
  const findings = analyzeFindings(vacuum)
  const never = findings.filter((entry) => analyzeState(entry) === 'never')
  const blind = never.filter((entry) => isBlindAndLarge(entry))

  return (
    <PressureSection
      id="analyze"
      title="Planner blind spots"
      count={`${never.length} never analyzed · ${blind.length} of them large enough to matter`}
      rule="Never-analyzed tables first, then tables with more changed rows than autoanalyze waits for (threshold + scale factor × rows)."
    >
      <div className="space-y-2">
        {blind.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] text-[var(--sea-ink-soft)]">
              One statement for every large table with no statistics:
            </p>
            <CopyButton
              text={blind.map((entry) => analyzeSql(schema, entry.table)).join('\n')}
              label={`Copy ${blind.length} ANALYZE statements`}
            />
          </div>
        )}
        <CappedList
          items={findings}
          keyOf={(entry) => entry.table}
          empty="Every table here has statistics, and none has drifted past its autoanalyze trigger."
          render={(entry) => <AnalyzeRow schema={schema} entry={entry} />}
        />
      </div>
    </PressureSection>
  )
}

function AnalyzeRow({ schema, entry }: { schema: string; entry: TableVacuumEntry }) {
  const state = analyzeState(entry)
  const analyzed = lastAnalyzedAt(entry)
  const rows = Math.max(entry.liveTuples, entry.estimatedRows > 0 ? entry.estimatedRows : 0)

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
      <TableLink schema={schema} table={entry.table} />
      {state === 'never' && (
        <Chip
          tone={isBlindAndLarge(entry) ? 'bad' : 'warn'}
          title={
            isBlindAndLarge(entry)
              ? 'Large enough that planning against the built-in defaults will go wrong'
              : 'No statistics, but small enough that it plans fine either way'
          }
        >
          never analyzed
        </Chip>
      )}
      {state === 'stale' && (
        <Chip
          tone="warn"
          title={`${formatCompactCount(entry.modsSinceAnalyze)} rows changed against a trigger of ${formatCompactCount(entry.analyzeThreshold ?? 0)}`}
        >
          past its analyze trigger
        </Chip>
      )}
      {state === 'unmanaged' && (
        <Chip title="Autovacuum is switched off for this table, so nothing will analyze it on its own">
          autovacuum off
        </Chip>
      )}
      <span className="tabular-nums text-[var(--sea-ink-soft)]">
        ~{formatCompactCount(rows)} rows
      </span>
      {entry.modsSinceAnalyze > 0 && (
        <span className="tabular-nums text-[10px] text-[var(--sea-ink-soft)]">
          {formatCompactCount(entry.modsSinceAnalyze)} changes unanalyzed
        </span>
      )}
      <span className="text-[10px] text-[var(--sea-ink-soft)]">
        analyzed {formatRelativeTime(analyzed, Date.now())}
      </span>
      <CopyButton text={analyzeSql(schema, entry.table)} label="Copy ANALYZE" className="ml-auto" />
    </div>
  )
}
