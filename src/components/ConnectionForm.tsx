import { useEffect, useState } from 'react'
import type { ConnectionConfig, ConnectionPreset } from '#/lib/types'

interface ConnectionFormProps {
  onConnect: (config: ConnectionConfig, presetName?: string) => Promise<void>
  isLoading: boolean
  error: string | null
  presets: ConnectionPreset[]
}

export default function ConnectionForm({
  onConnect,
  isLoading,
  error,
  presets,
}: ConnectionFormProps) {
  const [config, setConfig] = useState<ConnectionConfig>({
    host: 'localhost',
    port: 5432,
    database: '',
    user: 'postgres',
    password: '',
    ssl: false,
  })
  const [selectedPresetName, setSelectedPresetName] = useState<string | undefined>()

  const update = (field: keyof ConnectionConfig, value: string | number | boolean) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
    setSelectedPresetName(undefined)
  }

  const applyPreset = (preset: ConnectionPreset) => {
    setConfig({
      host: preset.host,
      port: preset.port,
      database: preset.database,
      user: preset.user,
      password: preset.password,
      ssl: preset.ssl,
    })
    setSelectedPresetName(preset.name)
  }

  useEffect(() => {
    if (presets.length > 0 && !config.database) {
      applyPreset(presets[0])
    }
  }, [presets])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onConnect(config, selectedPresetName)
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-lg space-y-5">
      {presets.length > 0 && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--sea-ink)]">
            Presets
          </label>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset)}
                className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--sea-ink)] transition hover:border-[var(--lagoon)] hover:bg-[rgba(79,184,178,0.08)]"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1">
          <label className="mb-1.5 block text-sm font-medium text-[var(--sea-ink)]">
            Host
          </label>
          <input
            type="text"
            value={config.host}
            onChange={(e) => update('host', e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20"
            placeholder="localhost"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--sea-ink)]">
            Port
          </label>
          <input
            type="number"
            value={config.port}
            onChange={(e) => update('port', parseInt(e.target.value, 10) || 5432)}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20"
            placeholder="5432"
            required
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--sea-ink)]">
          Database
        </label>
        <input
          type="text"
          value={config.database}
          onChange={(e) => update('database', e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20"
          placeholder="mydb"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--sea-ink)]">
            User
          </label>
          <input
            type="text"
            value={config.user}
            onChange={(e) => update('user', e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20"
            placeholder="postgres"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--sea-ink)]">
            Password
          </label>
          <input
            type="password"
            value={config.password}
            onChange={(e) => update('password', e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20"
            placeholder="password"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--sea-ink-soft)]">
        <input
          type="checkbox"
          checked={config.ssl ?? false}
          onChange={(e) => update('ssl', e.target.checked)}
          className="rounded border-[var(--line)]"
        />
        Use SSL
      </label>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)] disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {isLoading ? 'Connecting...' : 'Connect'}
      </button>
    </form>
  )
}
