import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import CopyButton from '#/components/CopyButton'
import { Chip, Meter } from '#/components/pressure/PressureSection'
import { formatCompactCount } from '#/lib/inspect/format'
import { formatPercent } from '#/lib/inspect/stats'
import {
  cacheHitRatio,
  collapseWhitespace,
  formatMs,
  queryKind,
  rowsPerCall,
  shareOfTime,
} from '#/lib/queries/stats'
import type { QueryStatEntry } from '#/lib/types'

/** Below this, a heavy statement is reading from disk rather than from memory. */
const LOW_CACHE_HIT = 0.9

/**
 * One statement. Collapsed it is a single line of normalized SQL and the numbers
 * that ranked it; expanded it is the whole statement, formatted as
 * `pg_stat_statements` stored it, with the constants still as `$n` placeholders.
 */
export default function QueryRow({
  entry,
  rank,
  totalMs,
}: {
  entry: QueryStatEntry
  rank: number
  totalMs: number
}) {
  const [open, setOpen] = useState(false)
  const share = shareOfTime(entry.totalMs, totalMs)
  const hitRatio = cacheHitRatio(entry)
  const perCall = rowsPerCall(entry)
  const kind = queryKind(entry.query)
  const preview = collapseWhitespace(entry.query)

  return (
    <div className="border-b border-[var(--line)]/40 py-2">
      <div className="flex items-start gap-2">
        <span className="w-6 shrink-0 pt-0.5 text-right tabular-nums text-[11px] text-[var(--sea-ink-soft)]">
          {rank}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="block w-full text-left"
            title={open ? 'Collapse' : 'Show the whole statement'}
          >
            <code
              className={`block font-mono text-[12px] text-[var(--sea-ink)] ${
                open ? 'whitespace-pre-wrap break-all' : 'truncate'
              }`}
            >
              {open ? entry.query : preview}
            </code>
          </button>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--sea-ink-soft)]">
            <Chip title={`Statement kind: ${kind}`}>{kind}</Chip>
            <span className="tabular-nums">
              <span className="font-medium text-[var(--sea-ink)]">{formatMs(entry.totalMs)}</span>{' '}
              total
            </span>
            <span className="tabular-nums">{formatPercent(share)} of all time</span>
            <span className="tabular-nums">{formatCompactCount(entry.calls)} calls</span>
            <span
              className="tabular-nums"
              title={`min ${formatMs(entry.minMs)} · max ${formatMs(entry.maxMs)} · stddev ${formatMs(entry.stddevMs)}`}
            >
              {formatMs(entry.meanMs)} mean
            </span>
            <span className="tabular-nums">
              {formatCompactCount(entry.rows)} rows
              {perCall !== null && ` · ${formatCompactCount(perCall)}/call`}
            </span>
            {hitRatio !== null && (
              <span
                className="tabular-nums"
                title={`${formatCompactCount(entry.sharedBlksHit)} blocks from cache, ${formatCompactCount(entry.sharedBlksRead)} from disk`}
              >
                {formatPercent(hitRatio)} cached
              </span>
            )}
            {hitRatio !== null && hitRatio < LOW_CACHE_HIT && entry.sharedBlksRead > 0 && (
              <Chip tone="warn" title="Most of its blocks came from disk rather than shared buffers">
                reads from disk
              </Chip>
            )}
            {entry.ioReadMs !== null && entry.ioReadMs > 0 && (
              <span className="tabular-nums" title="Time spent waiting on disk reads">
                {formatMs(entry.ioReadMs)} I/O wait
              </span>
            )}
            {entry.role && <span>as {entry.role}</span>}
          </div>

          <Meter
            title={`${formatPercent(share)} of all execution time`}
            segments={[{ pct: share * 100, className: 'bg-[var(--lagoon)]', label: 'share' }]}
          />

          {open && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <CopyButton text={entry.query} label="Copy SQL" />
              <Link
                to="/console"
                search={{ sql: `EXPLAIN ${entry.query}` }}
                className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] no-underline hover:bg-[rgba(79,184,178,0.1)]"
                title="Open the console with EXPLAIN in front of this statement. Its placeholders still need real values."
              >
                EXPLAIN in console
              </Link>
              <span className="text-[10px] text-[var(--sea-ink-soft)]">
                queryid {entry.queryId} · placeholders (`$1`) are the normalizer's, not yours —
                replace them before running
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
