import { useEffect, useId, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { ConnectionConfig, ConnectionPreset } from '#/lib/types'

interface ConnectionFormProps {
  onConnect: (config: ConnectionConfig, presetName?: string) => Promise<void>
  isLoading: boolean
  error: string | null
  presets: ConnectionPreset[]
  onSavePreset: (preset: ConnectionPreset) => Promise<void>
  onDeletePreset: (name: string) => Promise<void>
}

const inputClass =
  'w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[var(--lagoon)] focus:ring-2 focus:ring-[var(--lagoon)]/20'
const labelClass = 'mb-1.5 block text-sm font-medium text-[var(--sea-ink)]'

export default function ConnectionForm({
  onConnect,
  isLoading,
  error,
  presets,
  onSavePreset,
  onDeletePreset,
}: ConnectionFormProps) {
  const ids = useId()
  const fieldId = (field: string) => `${ids}-${field}`

  const [config, setConfig] = useState<ConnectionConfig>({
    host: 'localhost',
    port: 5432,
    database: '',
    user: 'postgres',
    password: '',
    ssl: false,
  })
  const [selectedPresetName, setSelectedPresetName] = useState<string | undefined>()
  /** The preset whose chip is waiting on a confirmed Forget, if any. */
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  /** The name being typed into the save box, or null while it is closed. */
  const [draftName, setDraftName] = useState<string | null>(null)

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

  /**
   * Saving over the selected preset is the ordinary way to correct one, so its
   * own name is the suggestion when a chip is active. Otherwise the connection
   * describes itself better than an empty box does.
   */
  const openSaveBox = () => {
    setPendingRemoval(null)
    setDraftName(selectedPresetName ?? `${config.user}@${config.host}`)
  }

  const saveDraft = async () => {
    const name = draftName?.trim()
    if (!name) return
    await onSavePreset({ ...config, name })
    setSelectedPresetName(name)
    setDraftName(null)
  }

  const confirmRemoval = async (name: string) => {
    await onDeletePreset(name)
    setPendingRemoval(null)
    if (selectedPresetName === name) setSelectedPresetName(undefined)
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-lg space-y-5">
      <div>
        <span className={labelClass}>Presets</span>
        <div className="flex flex-wrap items-center gap-2">
          {presets.map((preset) =>
            pendingRemoval === preset.name ? (
              <span
                key={preset.name}
                className="inline-flex items-center gap-2 rounded-full border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
              >
                Forget {preset.name}?
                <button
                  type="button"
                  onClick={() => confirmRemoval(preset.name)}
                  className="font-semibold underline underline-offset-2"
                >
                  Forget
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRemoval(null)}
                  className="text-[var(--sea-ink-soft)] underline underline-offset-2"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <span
                key={preset.name}
                className={`inline-flex items-center rounded-full border bg-[var(--surface)] transition hover:border-[var(--lagoon)] ${
                  selectedPresetName === preset.name
                    ? 'border-[var(--lagoon)] bg-[rgba(79,184,178,0.12)]'
                    : 'border-[var(--line)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="rounded-l-full py-1.5 pl-3 pr-1.5 text-xs font-medium text-[var(--sea-ink)]"
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${preset.name}`}
                  title={`Remove ${preset.name}`}
                  onClick={() => setPendingRemoval(preset.name)}
                  className="rounded-r-full py-1.5 pl-1 pr-2.5 text-[var(--sea-ink-soft)] transition hover:text-red-600"
                >
                  <X aria-hidden className="h-3 w-3" />
                </button>
              </span>
            ),
          )}

          {draftName === null ? (
            <button
              type="button"
              onClick={openSaveBox}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--sea-ink-soft)] transition hover:border-[var(--lagoon)] hover:text-[var(--sea-ink)]"
            >
              <Plus aria-hidden className="h-3 w-3" />
              Save current
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <label className="sr-only" htmlFor={fieldId('preset-name')}>
                Preset name
              </label>
              <input
                id={fieldId('preset-name')}
                type="text"
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveDraft()
                  }
                  if (e.key === 'Escape') setDraftName(null)
                }}
                placeholder="Preset name"
                className="w-40 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1.5 text-xs text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
              />
              <button
                type="button"
                onClick={saveDraft}
                className="inline-flex items-center gap-1 rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-3 py-1.5 text-xs font-semibold text-[var(--lagoon-deep)]"
              >
                <Check aria-hidden className="h-3 w-3" />
                Save
              </button>
              <button
                type="button"
                onClick={() => setDraftName(null)}
                className="px-1 text-xs text-[var(--sea-ink-soft)] underline underline-offset-2"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs text-[var(--sea-ink-soft)]">
          Saved to <code>local/presets.json</code>, credentials and all.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1">
          <label className={labelClass} htmlFor={fieldId('host')}>
            Host
          </label>
          <input
            id={fieldId('host')}
            type="text"
            value={config.host}
            onChange={(e) => update('host', e.target.value)}
            className={inputClass}
            placeholder="localhost"
            required
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={fieldId('port')}>
            Port
          </label>
          <input
            id={fieldId('port')}
            type="number"
            value={config.port}
            onChange={(e) => update('port', parseInt(e.target.value, 10) || 5432)}
            className={inputClass}
            placeholder="5432"
            required
          />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor={fieldId('database')}>
          Database
        </label>
        <input
          id={fieldId('database')}
          type="text"
          value={config.database}
          onChange={(e) => update('database', e.target.value)}
          className={inputClass}
          placeholder="mydb"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} htmlFor={fieldId('user')}>
            User
          </label>
          <input
            id={fieldId('user')}
            type="text"
            value={config.user}
            onChange={(e) => update('user', e.target.value)}
            className={inputClass}
            placeholder="postgres"
            required
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={fieldId('password')}>
            Password
          </label>
          <input
            id={fieldId('password')}
            type="password"
            value={config.password}
            onChange={(e) => update('password', e.target.value)}
            className={inputClass}
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
        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)] disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {isLoading && (
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {isLoading ? 'Connecting...' : 'Connect'}
      </button>
      {isLoading && (
        <p aria-live="polite" className="text-center text-xs text-[var(--sea-ink-soft)]">
          Opening the connection and reading the schema...
        </p>
      )}
    </form>
  )
}
