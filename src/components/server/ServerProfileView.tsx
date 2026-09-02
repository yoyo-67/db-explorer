import { useQuery } from '@tanstack/react-query'
import { useDatabaseParam } from '#/hooks/useDatabase'
import Panel, { PanelGroupControls, usePanelGroup } from '#/components/widgets/Panel'
import Gauge from '#/components/widgets/Gauge'
import { $getServerProfile } from '#/server/api'
import {
  SETTING_MEANING,
  bySettingInterest,
  formatSetting,
  profileSentence,
  settingWeight,
} from '#/lib/server-profile/settings'
import { formatRelativeTime } from '#/lib/inspect/format'
import type { SettingEntry } from '#/lib/server-profile/types'

/**
 * The server as a decision rather than a list.
 *
 * `pg_settings` holds some 350 rows and nearly all of them are noise. What is
 * worth reading is the handful somebody changed — those are the numbers the
 * planner was reading when it chose the plan on the query board — and the
 * handful that matter enough to show even at their default, because knowing
 * `random_page_cost` is still 4 explains more bad plans than anything else here.
 */
export default function ServerProfileView() {
  const database = useDatabaseParam()
  const group = usePanelGroup(true)
  const profileQuery = useQuery({
    queryKey: ['serverProfile', database],
    queryFn: () => $getServerProfile({ data: { database } }),
    // The shape of a server changes when somebody restarts it, not while a page
    // is open. Re-reading it on every mount would be re-reading it for nothing.
    staleTime: 10 * 60_000,
  })

  if (profileQuery.isLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-[rgba(79,184,178,0.06)]" />
  }
  if (profileQuery.error) {
    return (
      <p className="text-xs text-red-700 dark:text-red-300">
        Could not read the server profile: {String(profileQuery.error)}
      </p>
    )
  }
  const profile = profileQuery.data
  if (!profile) return null

  const drift = profile.collationDrift
  const localeDrift =
    profile.locale &&
    profile.locale.collationVersion &&
    profile.locale.actualCollationVersion &&
    profile.locale.collationVersion !== profile.locale.actualCollationVersion

  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <p className="text-sm font-medium text-[var(--sea-ink)]">{profileSentence(profile)}</p>
        <p className="text-[11px] text-[var(--sea-ink-soft)]">
          {shortVersion(profile.serverVersion)}
          {profile.startedAt && ` · up since ${formatRelativeTime(profile.startedAt, Date.now())}`}
          {profile.isInRecovery && ' · in recovery (read replica)'}
        </p>
        <div className="pt-1">
          <PanelGroupControls group={group} />
        </div>
      </header>

      {(drift.length > 0 || localeDrift) && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/50">
          <p className="text-[11px] font-medium text-red-800 dark:text-red-200">
            Collation version has moved under this database.
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-red-800/90 dark:text-red-200/90">
            Every index on a text column was built with the sort order of the old library version.
            After an operating system upgrade changes that order, those indexes can silently miss
            rows. Reindexing text indexes is the fix; nothing warns about it at query time.
          </p>
          {localeDrift && profile.locale && (
            <p className="mt-1 font-mono text-[10px] text-red-800/80 dark:text-red-200/80">
              database {profile.locale.collate}: recorded {profile.locale.collationVersion}, library
              now {profile.locale.actualCollationVersion}
            </p>
          )}
          {drift.slice(0, 6).map((entry) => (
            <p
              key={`${entry.schema}.${entry.name}`}
              className="font-mono text-[10px] text-red-800/80 dark:text-red-200/80"
            >
              {entry.name}: recorded {entry.recordedVersion ?? '—'}, library now{' '}
              {entry.actualVersion ?? '—'}
            </p>
          ))}
        </div>
      )}

      {profile.maxConnections !== null && profile.usedConnections !== null && (
        <Gauge
          label="Connections"
          value={String(profile.usedConnections)}
          ceiling={String(profile.maxConnections)}
          fraction={profile.usedConnections / profile.maxConnections}
          tone={
            profile.usedConnections / profile.maxConnections > 0.8
              ? 'bad'
              : profile.usedConnections / profile.maxConnections > 0.6
                ? 'warn'
                : 'good'
          }
          sentence="Each connection is a process, not a thread. The ceiling is what a pooler must stay under, never a target."
        />
      )}

      <Panel
        {...group.propsFor('changed')}
        title="Changed from default"
        summary={`${profile.changed.length} settings`}
        rule="Every setting whose running value differs from what the Postgres binary ships with. These, and only these, are what makes this server behave unlike a stock one."
        tone="neutral"
      >
        {profile.changed.length === 0 ? (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            Stock configuration — nothing has been changed from the built-in defaults.
          </p>
        ) : (
          <SettingList settings={[...profile.changed].sort(bySettingInterest)} showDefault />
        )}
      </Panel>

      <Panel
        {...group.propsFor('notable')}
        title="Still at default"
        summary={`${profile.notable.length} worth knowing`}
        rule="Planner and memory knobs nobody touched. They are here because the default is a decision too — a stock random_page_cost on an SSD is what makes the planner avoid the index you built."
        defaultOpen={false}
      >
        <SettingList settings={profile.notable} showDefault={false} />
      </Panel>

      <Panel
        {...group.propsFor('extensions')}
        title="Extensions"
        summary={`${profile.extensions.length} installed`}
        rule="What this database can do that stock Postgres cannot."
        defaultOpen={false}
      >
        <ul className="flex flex-wrap gap-1.5">
          {profile.extensions.map((extension) => (
            <li
              key={extension.name}
              title={`${extension.name} ${extension.version} in schema ${extension.schema}${
                extension.availableVersion
                  ? ` — ${extension.availableVersion} is available on disk`
                  : ''
              }`}
              className="rounded bg-[rgba(79,184,178,0.12)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--lagoon-deep)]"
            >
              {extension.name} {extension.version}
              {extension.availableVersion && ' ↑'}
            </li>
          ))}
        </ul>
      </Panel>

      {profile.locale && (
        <Panel
          {...group.propsFor('locale')}
          title="Locale"
          summary={profile.locale.collate}
          rule="The sort order every text index was built under, and the encoding every string is stored in."
          defaultOpen={false}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <Row label="Encoding" value={profile.locale.encoding} />
            <Row label="Collate" value={profile.locale.collate} />
            <Row label="Ctype" value={profile.locale.ctype} />
            {profile.locale.localeProvider && (
              <Row
                label="Provider"
                value={profile.locale.localeProvider === 'i' ? 'ICU' : 'libc'}
              />
            )}
          </dl>
        </Panel>
      )}

      {profile.sessionSet.length > 0 && (
        <Panel
          {...group.propsFor('session')}
          title="Set by this session"
          summary={`${profile.sessionSet.length} settings`}
          rule="What this tool asked for on the way in — a read-only transaction characteristic and a statement timeout among them. Listed apart so none of it is mistaken for the server's own shape."
          defaultOpen={false}
          tone="muted"
        >
          <SettingList settings={profile.sessionSet} showDefault={false} />
        </Panel>
      )}

      {profile.notes.length > 0 && (
        <ul className="space-y-1">
          {profile.notes.map((note) => (
            <li key={note} className="text-[10px] italic text-[var(--sea-ink-soft)]">
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--sea-ink-soft)]">{label}</dt>
      <dd className="font-mono text-[var(--sea-ink)]">{value}</dd>
    </>
  )
}

const WEIGHT_LABELS: Record<ReturnType<typeof settingWeight>, string> = {
  planner: 'planner',
  memory: 'memory',
  autovacuum: 'autovacuum',
  wal: 'WAL',
  other: '',
}

function SettingList({
  settings,
  showDefault,
}: {
  settings: SettingEntry[]
  showDefault: boolean
}) {
  return (
    <ul className="space-y-2">
      {settings.map((setting) => {
        const weight = settingWeight(setting.name)
        const meaning = SETTING_MEANING[setting.name] ?? setting.shortDesc
        return (
          <li key={setting.name} className="space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-[11px] text-[var(--sea-ink)]">{setting.name}</span>
              <span className="font-mono text-[11px] font-medium text-[var(--lagoon-deep)]">
                {formatSetting(setting)}
              </span>
              {showDefault && setting.bootValue !== null && (
                <span
                  className="font-mono text-[10px] text-[var(--sea-ink-soft)]"
                  title="What the Postgres binary ships with"
                >
                  ← {formatSetting({ ...setting, setting: setting.bootValue })}
                </span>
              )}
              {WEIGHT_LABELS[weight] && (
                <span className="rounded bg-[rgba(79,184,178,0.12)] px-1 py-0.5 text-[9px] uppercase tracking-wide text-[var(--lagoon-deep)]">
                  {WEIGHT_LABELS[weight]}
                </span>
              )}
              {setting.pendingRestart && (
                <span className="rounded bg-[rgba(214,158,46,0.18)] px-1 py-0.5 text-[9px] text-[#8a5a00] dark:text-[#e9c46a]">
                  needs restart
                </span>
              )}
            </div>
            {meaning && (
              <p className="text-[10px] leading-relaxed text-[var(--sea-ink-soft)]">{meaning}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** `PostgreSQL 15.4 on aarch64-...` is a paragraph; the first three words are the fact. */
function shortVersion(version: string): string {
  const match = version.match(/^PostgreSQL\s+([\d.]+\S*)/)
  return match ? `PostgreSQL ${match[1]}` : version.slice(0, 60)
}
