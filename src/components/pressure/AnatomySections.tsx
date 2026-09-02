import { useQuery } from '@tanstack/react-query'
import PressureSection, { CappedList, Chip, Meter, TableLink } from '#/components/pressure/PressureSection'
import CopyButton from '#/components/CopyButton'
import { $getSchemaAnatomy } from '#/server/api'
import { rankLayoutWaste, totalRecoverableBytes } from '#/lib/anatomy/row-layout'
import { REASON_TEXT, createStatisticsDdl, statsGaps } from '#/lib/anatomy/extended-stats'
import { CONCERN_TEXT as PARTITION_TEXT, partitionConcern } from '#/lib/anatomy/partitions'
import {
  disabledTriggers,
  ownerBypassPolicies,
  policiesByTable,
  triggersByTable,
  unenforcedPolicies,
  userTriggers,
} from '#/lib/anatomy/triggers'
import { byCacheMiss, cacheLevel, hitRatio, totalReads } from '#/lib/anatomy/cache'
import { freezeLevel, freezeShare } from '#/lib/physical/freeze'
import { formatBytes } from '#/lib/pressure/bytes'
import { formatCompactCount } from '#/lib/inspect/format'
import type { SchemaAnatomy } from '#/lib/anatomy/types'

/**
 * The structural half of the pressure page.
 *
 * The sections above it are wear — indexes nobody reads, vacuum falling behind,
 * a sequence running out. These are shape: rows laid out so they waste bytes,
 * freeze clocks nobody is watching, work the schema does that no query mentions,
 * and the multi-column statistics that would stop the planner guessing.
 *
 * Its own fetch rather than the pressure read's, so the page above renders while
 * this is still reading — the catalog scan behind it walks every attribute in
 * the schema.
 */
export default function AnatomySections({
  database,
  schema,
  enabled,
}: {
  database: string
  schema: string
  enabled: boolean
}) {
  const anatomyQuery = useQuery({
    queryKey: ['schemaAnatomy', database, schema],
    queryFn: () => $getSchemaAnatomy({ data: { database, schema } }),
    enabled,
    staleTime: 5 * 60_000,
  })

  if (anatomyQuery.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((n) => (
          <div key={n} className="island-shell h-24 animate-pulse rounded-xl" />
        ))}
      </div>
    )
  }
  if (anatomyQuery.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        Could not read the schema&rsquo;s structure: {String(anatomyQuery.error)}
      </div>
    )
  }
  const anatomy = anatomyQuery.data
  if (!anatomy) return null

  return (
    <>
      <RowLayoutSection anatomy={anatomy} />
      <FreezeSection anatomy={anatomy} />
      <StatsGapSection anatomy={anatomy} />
      <HiddenWorkSection anatomy={anatomy} />
      {anatomy.partitions.length > 0 && <PartitionSection anatomy={anatomy} />}
      <CacheSection anatomy={anatomy} />
      {anatomy.notes.length > 0 && (
        <ul className="space-y-1 px-1">
          {anatomy.notes.map((note) => (
            <li key={note} className="text-[10px] italic text-[var(--sea-ink-soft)]">
              {note}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function RowLayoutSection({ anatomy }: { anatomy: SchemaAnatomy }) {
  const wastes = rankLayoutWaste(anatomy.layouts)
  const recoverable = totalRecoverableBytes(wastes)

  return (
    <PressureSection
      id="layout"
      title="Row layout"
      count={
        wastes.length === 0
          ? 'nothing worth rewriting'
          : `${wastes.length} tables · ${formatBytes(recoverable)} recoverable`
      }
      rule="Columns are stored in the order they were added, each padded forward to its type's alignment. Listed here when reordering them widest-first would save at least a twentieth of the row."
    >
      <CappedList
        items={wastes}
        cap={10}
        keyOf={(waste) => waste.table}
        empty="Every table in this schema is already packed as tightly as its column order allows."
        render={(waste) => (
          <div className="space-y-1 py-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
              <TableLink schema={anatomy.schema} table={waste.table} />
              <Chip tone="warn">
                −{waste.saving.bytesPerRow} B/row
              </Chip>
              <span className="text-[var(--sea-ink-soft)]">
                {waste.currentRowBytes} B → {waste.packedRowBytes} B
              </span>
              <span className="ml-auto font-mono text-[var(--sea-ink-soft)]">
                {formatBytes(waste.saving.totalBytes)} across{' '}
                {formatCompactCount(waste.estimatedRows)} rows
              </span>
            </div>
            <Meter
              title={`${(waste.saving.share * 100).toFixed(0)}% of the row is alignment padding`}
              segments={[
                {
                  pct: (waste.packedRowBytes / waste.currentRowBytes) * 100,
                  className: 'bg-[var(--lagoon)]',
                  label: 'used',
                },
                {
                  pct: waste.saving.share * 100,
                  className: 'bg-[#d69e2e]',
                  label: 'padding',
                },
              ]}
            />
            {waste.estimated && (
              <p className="text-[10px] italic text-[var(--sea-ink-soft)]">
                Variable-length widths come from the last ANALYZE, so this is an estimate.
              </p>
            )}
          </div>
        )}
      />
      <p className="mt-2 text-[10px] text-[var(--sea-ink-soft)]">
        Open a table&rsquo;s <strong>Physical</strong> tab (under Advanced) to see the row drawn
        byte by byte. Postgres cannot reorder columns in place, so this is only worth collecting
        where a table is due a rewrite anyway.
      </p>
    </PressureSection>
  )
}

function FreezeSection({ anatomy }: { anatomy: SchemaAnatomy }) {
  const ranked = [...anatomy.freeze]
    .map((entry) => ({
      entry,
      share: freezeShare(entry.frozenAge, entry.freezeMaxAge) ?? 0,
      level: freezeLevel(entry.frozenAge, entry.freezeMaxAge),
    }))
    .sort((a, b) => b.share - a.share)
  const pressing = ranked.filter((item) => item.level === 'urgent' || item.level === 'watch')

  return (
    <PressureSection
      id="freeze"
      title="Freeze age"
      count={
        pressing.length === 0
          ? 'every table well inside its budget'
          : `${pressing.length} past half their budget`
      }
      rule="Every transaction ages every unfrozen table by one. At autovacuum_freeze_max_age an anti-wraparound vacuum fires whether the table wanted one or not — it cannot be cancelled, and it reads the whole table."
    >
      <CappedList
        items={pressing.length > 0 ? pressing : ranked.slice(0, 5)}
        cap={12}
        keyOf={(item) => item.entry.table}
        empty="No freeze ages recorded for this schema."
        render={(item) => (
          <div className="space-y-1 py-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
              <TableLink schema={anatomy.schema} table={item.entry.table} />
              {item.level === 'urgent' && <Chip tone="bad">anti-wraparound soon</Chip>}
              {item.level === 'watch' && <Chip tone="warn">past half</Chip>}
              <span className="text-[var(--sea-ink-soft)]">
                {formatCompactCount(item.entry.frozenAge ?? 0)} of{' '}
                {formatCompactCount(item.entry.freezeMaxAge)} transactions
              </span>
              <span className="ml-auto font-mono text-[var(--sea-ink-soft)]">
                {formatBytes(item.entry.totalBytes)}
              </span>
            </div>
            <Meter
              title={`${(item.share * 100).toFixed(0)}% of the freeze budget used`}
              segments={[
                {
                  pct: item.share * 100,
                  className:
                    item.level === 'urgent'
                      ? 'bg-red-500'
                      : item.level === 'watch'
                        ? 'bg-[#d69e2e]'
                        : 'bg-[var(--lagoon)]',
                  label: 'age',
                },
              ]}
            />
          </div>
        )}
      />
    </PressureSection>
  )
}

function StatsGapSection({ anatomy }: { anatomy: SchemaAnatomy }) {
  const gaps = statsGaps(anatomy.statsCandidates, anatomy.extendedStats)

  return (
    <PressureSection
      id="stats"
      title="Columns the planner treats as independent"
      count={
        gaps.length === 0
          ? `${anatomy.extendedStats.length} statistics objects, no gaps found`
          : `${gaps.length} column sets with no extended statistics`
      }
      rule="Postgres estimates a multi-column filter by multiplying each column's selectivity, as if they were unrelated. Where a multicolumn index or a composite key says they are not, the estimate comes out low — and a low estimate is how a nested loop gets chosen for a million rows."
    >
      <CappedList
        items={gaps}
        cap={10}
        keyOf={(gap) => `${gap.table}:${gap.columns.join(',')}`}
        empty="Every declared column set already has extended statistics."
        render={(gap) => (
          <div className="space-y-1 py-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
              <TableLink schema={anatomy.schema} table={gap.table} />
              <span className="font-mono text-[var(--sea-ink)]">({gap.columns.join(', ')})</span>
              <Chip>{gap.reason.replace(/-/g, ' ')}</Chip>
              <CopyButton
                text={createStatisticsDdl(anatomy.schema, gap)}
                label="Copy CREATE STATISTICS"
                className="ml-auto"
              />
            </div>
            <p className="text-[10px] leading-relaxed text-[var(--sea-ink-soft)]">
              {gap.source} — {REASON_TEXT[gap.reason]}.
            </p>
          </div>
        )}
      />
      <p className="mt-2 text-[10px] text-[var(--sea-ink-soft)]">
        A statistics object is only a candidate: it costs an ANALYZE to maintain, and it pays only
        where the columns really are correlated. Check an estimate against the row count before
        creating one.
      </p>
    </PressureSection>
  )
}

function HiddenWorkSection({ anatomy }: { anatomy: SchemaAnatomy }) {
  const triggers = userTriggers(anatomy.triggers)
  const byTable = triggersByTable(anatomy.triggers)
  const disabled = disabledTriggers(anatomy.triggers)
  const policies = policiesByTable(anatomy.policies)
  const unenforced = unenforcedPolicies(anatomy.policies)
  const ownerBypass = ownerBypassPolicies(anatomy.policies)
  const tables = [...new Set([...byTable.keys(), ...policies.keys()])].sort()

  return (
    <PressureSection
      id="hidden-work"
      title="Work no query mentions"
      count={
        tables.length === 0
          ? 'no triggers, no policies'
          : `${triggers.length} triggers · ${anatomy.policies.length} policies on ${tables.length} tables`
      }
      rule="A trigger runs on every write to its table and appears in no statement that fires it. A row-level security policy narrows what a SELECT returns without saying so. Both are the first place to look when a table writes slower, or reads emptier, than its definition suggests."
    >
      <CappedList
        items={tables}
        cap={12}
        keyOf={(table) => table}
        empty="Nothing in this schema does work behind a statement's back."
        render={(table) => {
          const tableTriggers = byTable.get(table) ?? []
          const tablePolicies = policies.get(table) ?? []
          const constraintCount = anatomy.constraintTriggerCounts[table] ?? 0
          return (
            <div className="space-y-1 py-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
                <TableLink schema={anatomy.schema} table={table} />
                {tableTriggers.length > 0 && (
                  <Chip tone={tableTriggers.length > 2 ? 'warn' : 'neutral'}>
                    {tableTriggers.length} {tableTriggers.length === 1 ? 'trigger' : 'triggers'}
                  </Chip>
                )}
                {tablePolicies.length > 0 && (
                  <Chip tone={tablePolicies.some((policy) => !policy.rowSecurityEnabled) ? 'bad' : 'neutral'}>
                    {tablePolicies.length} RLS {tablePolicies.length === 1 ? 'policy' : 'policies'}
                  </Chip>
                )}
                {constraintCount > 0 && (
                  <span className="text-[10px] text-[var(--sea-ink-soft)]">
                    + {constraintCount} foreign-key triggers Postgres maintains itself
                  </span>
                )}
              </div>
              {tableTriggers.map((trigger) => (
                <p key={trigger.name} className="text-[10px] text-[var(--sea-ink-soft)]">
                  <span className="font-mono">{trigger.name}</span> — {trigger.timing} →{' '}
                  <span className="font-mono">{trigger.functionName}</span>
                  {!trigger.enabled && ' · disabled'}
                </p>
              ))}
              {tablePolicies.map((policy) => (
                <p key={policy.name} className="text-[10px] text-[var(--sea-ink-soft)]">
                  <span className="font-mono">{policy.name}</span> — {policy.command} for{' '}
                  {policy.roles.length > 0 ? policy.roles.join(', ') : 'every role'}
                  {policy.using && <span className="font-mono"> · USING {policy.using}</span>}
                </p>
              ))}
            </div>
          )
        }}
      />
      {(unenforced.length > 0 || ownerBypass.length > 0 || disabled.length > 0) && (
        <div className="mt-2 space-y-1">
          {unenforced.length > 0 && (
            <p className="text-[11px] leading-relaxed text-red-700 dark:text-red-300">
              {unenforced.length}{' '}
              {unenforced.length === 1 ? 'policy is' : 'policies are'} defined on a table that never
              had row-level security enabled. They read like protection in the DDL and do nothing at
              runtime.
            </p>
          )}
          {ownerBypass.length > 0 && (
            <p className="text-[11px] leading-relaxed text-[#8a5a00] dark:text-[#e9c46a]">
              {ownerBypass.length}{' '}
              {ownerBypass.length === 1 ? 'policy applies' : 'policies apply'} to a table whose owner
              bypasses them — RLS is enabled but not forced, and most applications connect as the
              owner.
            </p>
          )}
          {disabled.length > 0 && (
            <p className="text-[11px] leading-relaxed text-[#8a5a00] dark:text-[#e9c46a]">
              {disabled.length} disabled {disabled.length === 1 ? 'trigger' : 'triggers'} — still
              defined, never fired.
            </p>
          )}
        </div>
      )}
    </PressureSection>
  )
}

function PartitionSection({ anatomy }: { anatomy: SchemaAnatomy }) {
  return (
    <PressureSection
      id="partitions"
      title="Partitioned tables"
      count={`${anatomy.partitions.length} parents`}
      rule="One relation to a query, many to the storage. What is worth seeing is where the two disagree: a default partition collecting rows nothing claimed, or one partition holding everything so pruning buys nothing."
    >
      <CappedList
        items={anatomy.partitions}
        cap={8}
        keyOf={(entry) => entry.table}
        empty="No partitioned tables in this schema."
        render={(entry) => {
          const concern = partitionConcern(entry)
          return (
            <div className="space-y-1 py-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
                <TableLink schema={anatomy.schema} table={entry.table} />
                <Chip>{entry.strategy}</Chip>
                <span className="font-mono text-[var(--sea-ink-soft)]">{entry.key}</span>
                <span className="text-[var(--sea-ink-soft)]">
                  {entry.partitionCount} partitions
                </span>
                <span className="ml-auto font-mono text-[var(--sea-ink-soft)]">
                  {formatBytes(entry.totalBytes)}
                </span>
              </div>
              {concern && (
                <p className="text-[10px] leading-relaxed text-[#8a5a00] dark:text-[#e9c46a]">
                  {PARTITION_TEXT[concern]}
                </p>
              )}
              <ul className="space-y-0.5">
                {entry.partitions.slice(0, 4).map((partition) => (
                  <li key={partition.name} className="text-[10px] text-[var(--sea-ink-soft)]">
                    <span className="font-mono">{partition.name}</span> · {formatBytes(partition.bytes)}{' '}
                    · {formatCompactCount(partition.estimatedRows)} rows
                    <span className="font-mono"> {partition.bounds}</span>
                  </li>
                ))}
                {entry.partitions.length > 4 && (
                  <li className="text-[10px] text-[var(--sea-ink-soft)]">
                    + {entry.partitions.length - 4} more
                  </li>
                )}
              </ul>
            </div>
          )
        }}
      />
    </PressureSection>
  )
}

function CacheSection({ anatomy }: { anatomy: SchemaAnatomy }) {
  const ranked = [...anatomy.cache]
    .filter((entry) => cacheLevel(entry) !== 'untouched')
    .sort(byCacheMiss)
  const cold = ranked.filter((entry) => cacheLevel(entry) === 'cold')

  return (
    <PressureSection
      id="cache"
      title="Read from memory, or from the disk"
      count={
        ranked.length === 0
          ? 'no table read enough to judge'
          : `${cold.length} tables under 90% served from shared buffers`
      }
      rule="Blocks found in Postgres's own buffers against blocks it had to ask the operating system for. A miss here is not necessarily a disk seek — the OS may still have had the page — so read this as where the pressure is, not as a grade."
    >
      <CappedList
        items={ranked}
        cap={10}
        keyOf={(entry) => entry.table}
        empty="No table in this schema has been read enough since the counters reset for the ratio to mean anything."
        render={(entry) => {
          const ratio = hitRatio(entry) ?? 0
          const level = cacheLevel(entry)
          return (
            <div className="space-y-1 py-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
                <TableLink schema={anatomy.schema} table={entry.table} />
                {level === 'cold' && <Chip tone="warn">reading from disk</Chip>}
                <span className="font-mono text-[var(--sea-ink-soft)]">
                  {(ratio * 100).toFixed(1)}% from memory
                </span>
                <span className="ml-auto text-[var(--sea-ink-soft)]">
                  {formatCompactCount(totalReads(entry))} blocks fetched
                </span>
              </div>
              <Meter
                segments={[
                  { pct: ratio * 100, className: 'bg-[var(--lagoon)]', label: 'hit' },
                  {
                    pct: (1 - ratio) * 100,
                    className: level === 'cold' ? 'bg-[#d69e2e]' : 'bg-[rgba(23,58,64,0.2)]',
                    label: 'read',
                  },
                ]}
              />
            </div>
          )
        }}
      />
    </PressureSection>
  )
}
