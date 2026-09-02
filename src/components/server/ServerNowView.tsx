import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import Panel, { PanelGroupControls, usePanelGroup } from '#/components/widgets/Panel'
import Gauge from '#/components/widgets/Gauge'
import StatRow from '#/components/widgets/StatRow'
import { $getLiveActivity } from '#/server/api'
import {
  CONCERN_TEXT,
  backendConcern,
  buildBlockingTrees,
  transactionAgeSeconds,
} from '#/lib/live/blocking'
import type { BlockingNode } from '#/lib/live/blocking'
import { bySlotRisk, replicaLagLevel, slotRisk, slotSentence } from '#/lib/live/replication'
import { formatBytes } from '#/lib/pressure/bytes'
import { formatCompactCount, formatRelativeTime } from '#/lib/inspect/format'
import type { Tone } from '#/components/widgets/tone'
import type { BackendEntry, LiveActivity } from '#/lib/live/types'

/**
 * The other half of the sheet: what the server is doing at this instant.
 *
 * Everything else this tool shows will still be true in an hour. None of this
 * will, so it polls while the sheet is open and stops the moment it closes —
 * and every panel is stamped with the read it came from rather than pretending
 * to be live.
 */
export default function ServerNowView({ open }: { open: boolean }) {
  const database = useDatabaseParam()
  const group = usePanelGroup(true)
  const activityQuery = useQuery({
    queryKey: ['liveActivity', database],
    queryFn: () => $getLiveActivity({ data: { database } }),
    enabled: open,
    // Nothing here is worth caching: a lock is gone before the render finishes.
    staleTime: 0,
    refetchInterval: open ? 5_000 : false,
  })

  if (activityQuery.isLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-[rgba(79,184,178,0.06)]" />
  }
  if (activityQuery.error) {
    return (
      <p className="text-xs text-red-700 dark:text-red-300">
        Could not read what the server is doing: {String(activityQuery.error)}
      </p>
    )
  }
  const activity = activityQuery.data
  if (!activity) return null

  const now = Date.parse(activity.takenAt)
  const trees = buildBlockingTrees(activity.backends)
  const blockedTotal = trees.reduce((total, tree) => total + tree.blockedCount, 0)
  const clients = activity.backends.filter((backend) => backend.backendType === 'client backend')
  const active = clients.filter((backend) => backend.state === 'active')
  const idleInTransaction = clients.filter(
    (backend) => backend.state === 'idle in transaction',
  )
  const longest = longestTransaction(clients, now)

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-sm font-medium text-[var(--sea-ink)]">
          {blockedTotal > 0
            ? `${blockedTotal} ${blockedTotal === 1 ? 'backend is' : 'backends are'} waiting on a lock`
            : `${active.length} active, ${clients.length} connected`}
        </p>
        <span className="text-[10px] text-[var(--sea-ink-soft)]">
          read {formatRelativeTime(activity.takenAt, Date.now())}, refreshing every 5s
        </span>
        <div className="ml-auto">
          <PanelGroupControls group={group} />
        </div>
      </header>

      {activity.maxConnections !== null && (
        <Gauge
          label="Connections"
          value={String(activity.backends.length + 1)}
          ceiling={String(activity.maxConnections)}
          fraction={(activity.backends.length + 1) / activity.maxConnections}
          tone={connectionTone((activity.backends.length + 1) / activity.maxConnections)}
          sentence={
            idleInTransaction.length > 0
              ? `${idleInTransaction.length} of them are idle inside a transaction — holding locks and holding back vacuum without running anything.`
              : undefined
          }
        />
      )}

      <Panel
        {...group.propsFor('locks')}
        title="Waiting on locks"
        summary={blockedTotal === 0 ? 'nothing is blocked' : `${blockedTotal} blocked`}
        tone={blockedTotal > 0 ? 'bad' : 'good'}
        badge={blockedTotal > 0 ? 'blocked' : 'clear'}
        rule="Built from pg_blocking_pids: the backend at the root of each tree is the one holding what everybody else is waiting for."
      >
        {trees.length === 0 ? (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            No backend is waiting behind another.
          </p>
        ) : (
          <ul className="space-y-2">
            {trees.map((tree) => (
              <li key={tree.backend.pid}>
                <BlockingTree node={tree} now={now} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        {...group.propsFor('transactions')}
        title="Long transactions"
        summary={
          longest === null
            ? 'none open'
            : `oldest ${formatDuration(transactionAgeSeconds(longest, now) ?? 0)}`
        }
        tone={longest && (transactionAgeSeconds(longest, now) ?? 0) > 300 ? 'warn' : 'good'}
        rule="Vacuum cannot remove a dead row any open transaction might still need to see. One forgotten transaction holds back cleanup on every table in the database."
      >
        <BackendList backends={clients} now={now} />
        {activity.preparedTransactions.length > 0 && (
          <div className="mt-2 rounded-lg border border-[var(--line)] bg-[rgba(214,158,46,0.08)] px-3 py-2">
            <p className="text-[11px] leading-relaxed text-[var(--sea-ink)]">
              {activity.preparedTransactions.length} prepared{' '}
              {activity.preparedTransactions.length === 1 ? 'transaction' : 'transactions'} sitting
              uncommitted. A prepared transaction survives a restart and holds its locks and its
              snapshot until somebody commits or rolls it back.
            </p>
            <ul className="mt-1 space-y-0.5">
              {activity.preparedTransactions.map((prepared) => (
                <li key={prepared.gid} className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
                  {prepared.gid} · prepared {formatRelativeTime(prepared.prepared, now)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      {(activity.slots.length > 0 || activity.replicas.length > 0) && (
        <Panel
          {...group.propsFor('replication')}
          title="Replication"
          summary={`${activity.slots.length} slots · ${activity.replicas.length} replicas`}
          tone={replicationTone(activity)}
          rule="A slot exists to stop the primary recycling WAL a consumer has not read. That is also what it does when the consumer never comes back."
        >
          <ul className="space-y-2">
            {[...activity.slots].sort(bySlotRisk).map((slot) => {
              const risk = slotRisk(slot)
              return (
                <li key={slot.name} className="space-y-0.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                    <span className="font-mono text-[var(--sea-ink)]">{slot.name}</span>
                    <span className="text-[var(--sea-ink-soft)]">{slot.slotType}</span>
                    <span
                      className={`rounded px-1 py-0.5 text-[9px] ${
                        slot.active
                          ? 'bg-[rgba(47,106,74,0.14)] text-[var(--palm)]'
                          : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                      }`}
                    >
                      {slot.active ? 'active' : 'inactive'}
                    </span>
                    {slot.retainedBytes !== null && (
                      <span className="font-mono text-[var(--sea-ink-soft)]">
                        {formatBytes(slot.retainedBytes)} WAL retained
                      </span>
                    )}
                    {slot.walStatus && (
                      <span className="text-[10px] text-[var(--sea-ink-soft)]">
                        {slot.walStatus}
                      </span>
                    )}
                  </div>
                  <p
                    className={`text-[10px] leading-relaxed ${
                      risk === 'ok' ? 'text-[var(--sea-ink-soft)]' : 'text-[#8a5a00] dark:text-[#e9c46a]'
                    }`}
                  >
                    {slotSentence(slot)}
                  </p>
                </li>
              )
            })}
            {activity.replicas.map((replica, index) => (
              <li
                key={`${replica.applicationName ?? 'replica'}-${index}`}
                className="flex flex-wrap items-baseline gap-x-2 text-[11px]"
              >
                <span className="font-mono text-[var(--sea-ink)]">
                  {replica.applicationName ?? replica.clientAddr ?? 'replica'}
                </span>
                <span className="text-[var(--sea-ink-soft)]">
                  {replica.state} · {replica.syncState}
                </span>
                {replica.replayLagBytes !== null && (
                  <span
                    className={`font-mono ${
                      replicaLagLevel(replica) === 'ok'
                        ? 'text-[var(--sea-ink-soft)]'
                        : 'text-[#8a5a00] dark:text-[#e9c46a]'
                    }`}
                  >
                    {formatBytes(replica.replayLagBytes)} behind
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {activity.progress.length > 0 && (
        <Panel
          {...group.propsFor('progress')}
          title="Maintenance running"
          summary={`${activity.progress.length} in flight`}
          rule="From the pg_stat_progress_* views — the only honest answer to how far along a vacuum or an index build is."
        >
          <ul className="space-y-2">
            {activity.progress.map((entry) => (
              <li key={`${entry.kind}-${entry.pid}`}>
                <Gauge
                  label={`${entry.kind} · ${entry.relation ?? 'unknown relation'}`}
                  value={entry.phase ?? 'running'}
                  fraction={entry.fraction}
                  tone="neutral"
                  note={entry.detail ?? undefined}
                />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {activity.counters && (
        <Panel
          {...group.propsFor('counters')}
          title="Since the counters were reset"
          summary={
            activity.counters.statsReset === null
              ? 'never reset — totals run from startup'
              : `reset ${formatRelativeTime(activity.counters.statsReset, now)}`
          }
          rule="Cumulative totals for the whole database. Useful as ratios, misleading as absolutes — they have been adding up since the last reset."
          defaultOpen={false}
        >
          <StatRow
            stats={[
              {
                label: 'Cache hit',
                value: cacheHitText(activity.counters.blocksHit, activity.counters.blocksRead),
                title: 'Blocks found in shared buffers against blocks asked of the OS',
              },
              { label: 'Commits', value: formatCompactCount(activity.counters.commits) },
              { label: 'Rollbacks', value: formatCompactCount(activity.counters.rollbacks) },
              {
                label: 'Deadlocks',
                value: formatCompactCount(activity.counters.deadlocks),
                muted: activity.counters.deadlocks === 0,
              },
              {
                label: 'Temp written',
                value: formatBytes(activity.counters.tempBytes),
                title: `${formatCompactCount(activity.counters.tempFiles)} temp files — sorts and hashes that did not fit in work_mem`,
              },
            ]}
          />
        </Panel>
      )}

      {activity.notes.length > 0 && (
        <ul className="space-y-1">
          {activity.notes.map((note) => (
            <li key={note} className="text-[10px] italic text-[var(--sea-ink-soft)]">
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BlockingTree({ node, now }: { node: BlockingNode; now: number }) {
  return (
    <div style={{ marginLeft: node.depth * 12 }} className="space-y-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
        {node.depth > 0 && <span className="text-[var(--sea-ink-soft)]">↳</span>}
        <span className="font-mono text-[var(--sea-ink)]">pid {node.backend.pid}</span>
        {node.blockedCount > 0 && (
          <span className="rounded bg-red-100 px-1 py-0.5 text-[9px] text-red-700 dark:bg-red-950 dark:text-red-300">
            blocking {node.blockedCount}
          </span>
        )}
        <span className="text-[var(--sea-ink-soft)]">
          {node.backend.state ?? 'unknown state'}
          {node.backend.waitEvent && ` · ${node.backend.waitEventType}:${node.backend.waitEvent}`}
        </span>
        <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
          {formatDuration(transactionAgeSeconds(node.backend, now) ?? 0)}
        </span>
      </div>
      {node.backend.query && (
        <p className="truncate font-mono text-[10px] text-[var(--sea-ink-soft)]" title={node.backend.query}>
          {node.backend.query}
        </p>
      )}
      {node.waiters.map((waiter) => (
        <BlockingTree key={waiter.backend.pid} node={waiter} now={now} />
      ))}
    </div>
  )
}

function BackendList({ backends, now }: { backends: BackendEntry[]; now: number }) {
  const withConcern = backends
    .map((backend) => ({ backend, concern: backendConcern(backend, 0, now) }))
    .filter((entry) => entry.concern !== null || entry.backend.state === 'active')
    .sort(
      (a, b) =>
        (transactionAgeSeconds(b.backend, now) ?? 0) - (transactionAgeSeconds(a.backend, now) ?? 0),
    )
    .slice(0, 12)

  if (withConcern.length === 0) {
    return <p className="text-[11px] text-[var(--sea-ink-soft)]">Nothing is running.</p>
  }

  return (
    <ul className="space-y-1.5">
      {withConcern.map(({ backend, concern }) => (
        <li key={backend.pid} className="space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
            <span className="font-mono text-[var(--sea-ink)]">pid {backend.pid}</span>
            <span className="text-[var(--sea-ink-soft)]">
              {backend.applicationName || backend.user || 'unknown client'}
            </span>
            <span className="text-[var(--sea-ink-soft)]">{backend.state}</span>
            <span className="ml-auto font-mono text-[10px] text-[var(--sea-ink-soft)]">
              {formatDuration(transactionAgeSeconds(backend, now) ?? 0)}
            </span>
          </div>
          {concern && (
            <p className="text-[10px] leading-relaxed text-[#8a5a00] dark:text-[#e9c46a]">
              {CONCERN_TEXT[concern]}
            </p>
          )}
          {backend.query && (
            <p className="truncate font-mono text-[10px] text-[var(--sea-ink-soft)]" title={backend.query}>
              {backend.query}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

function longestTransaction(backends: BackendEntry[], now: number): BackendEntry | null {
  let longest: BackendEntry | null = null
  let age = 0
  for (const backend of backends) {
    const candidate = transactionAgeSeconds(backend, now)
    if (candidate !== null && candidate > age) {
      age = candidate
      longest = backend
    }
  }
  return longest
}

function connectionTone(share: number): Tone {
  if (share > 0.8) return 'bad'
  if (share > 0.6) return 'warn'
  return 'good'
}

function replicationTone(activity: LiveActivity): Tone {
  if (activity.slots.some((slot) => slotRisk(slot) === 'lost' || slotRisk(slot) === 'critical')) {
    return 'bad'
  }
  if (activity.slots.some((slot) => slotRisk(slot) === 'watch')) return 'warn'
  return 'good'
}

function cacheHitText(hit: number, read: number): string {
  const total = hit + read
  if (total <= 0) return '—'
  return `${((hit / total) * 100).toFixed(1)}%`
}

/** Durations here are seconds to hours; anything longer is the finding itself. */
function formatDuration(seconds: number): string {
  if (seconds < 1) return '<1s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}
