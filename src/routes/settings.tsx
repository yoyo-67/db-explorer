import { createFileRoute } from '@tanstack/react-router'
import { setSetting, useAppSettings } from '#/hooks/useAppSettings'

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
          Kept in this browser, shared by every tab. Nothing here touches the
          database or the server.
        </p>

        <Toggle
          label="Query stats HUD"
          hint="Shows the ⚡ counter in the header. While on, every open tab polls the query log once a second."
          checked={settings.queryHud}
          onChange={(next) => setSetting('queryHud', next)}
        />
      </section>
    </main>
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
