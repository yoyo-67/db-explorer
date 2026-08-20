import { createFileRoute } from '@tanstack/react-router'
import { setSetting, useAppSettings } from '#/hooks/useAppSettings'
import { STATEMENT_TIMEOUT_CHOICES } from '#/lib/app-settings'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

function SettingsPage() {
  const settings = useAppSettings()

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in rounded-[2rem] px-6 py-10 sm:px-10 sm:py-12">
        <p className="island-kicker mb-3">Settings</p>
        <h1 className="display-title mb-5 max-w-3xl text-3xl leading-[1.08] font-bold tracking-tight text-[var(--sea-ink)] sm:text-4xl">
          This browser
        </h1>
        <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)]">
          Kept in this browser, shared by every tab. The last two are sent on to
          the server, which is the only place a query log or a timeout can
          actually be enforced.
        </p>

        <div className="space-y-3">
          <Toggle
            label="Query stats HUD"
            hint="Shows the ⚡ counter in the header. While on, the server logs every query it runs and each open tab polls that log once a second."
            checked={settings.queryHud}
            onChange={(next) => setSetting('queryHud', next)}
          />

          <Choice
            label="Query timeout"
            hint="Every query runs under this statement_timeout. A query that reaches it is cancelled and the page says so, which is the point: a scan nobody is waiting for should give the connection back."
            value={settings.statementTimeoutMs}
            options={STATEMENT_TIMEOUT_CHOICES.map((ms) => ({
              value: ms,
              label: ms < 60_000 ? `${ms / 1000} seconds` : `${ms / 60_000} minutes`,
            }))}
            onChange={(next) => setSetting('statementTimeoutMs', next)}
          />
        </div>
      </section>
    </main>
  )
}

function Choice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint: string
  value: number
  options: Array<{ value: number; label: string }>
  onChange: (next: number) => void
}) {
  return (
    <label className="flex max-w-2xl cursor-pointer items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3">
      <span className="flex-1">
        <span className="block text-sm font-medium text-[var(--sea-ink)]">{label}</span>
        <span className="block text-xs text-[var(--sea-ink-soft)]">{hint}</span>
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 rounded-lg border border-[var(--line)] bg-[var(--bg-base)] px-2 py-1 text-sm text-[var(--sea-ink)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex max-w-2xl cursor-pointer items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-[var(--lagoon)]"
      />
      <span>
        <span className="block text-sm font-medium text-[var(--sea-ink)]">{label}</span>
        <span className="block text-xs text-[var(--sea-ink-soft)]">{hint}</span>
      </span>
    </label>
  )
}
