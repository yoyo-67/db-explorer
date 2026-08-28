import { useEffect, useId, useState } from 'react'
import { Check, Pencil, Plus, X } from 'lucide-react'
import type { ConnectionConfig, ConnectionPreset } from '#/lib/types'

interface ConnectionFormProps {
  onConnect: (config: ConnectionConfig, presetName?: string) => Promise<void>
  isLoading: boolean
  error: string | null
  presets: ConnectionPreset[]
  onSavePreset: (preset: ConnectionPreset) => Promise<void>
  onDeletePreset: (name: string) => Promise<void>
}

/** The connection half of a preset — everything but the name it is filed under. */
function configOf(preset: ConnectionPreset): ConnectionConfig {
  return {
    host: preset.host,
    port: preset.port,
    database: preset.database,
    user: preset.user,
    password: preset.password,
    ssl: preset.ssl,
    slug: preset.slug,
    databaseAliases: preset.databaseAliases,
  }
}

/**
 * Whether the form still holds what the preset holds.
 *
 * Compared field by field rather than by reference: this is the question "is
 * there anything to save", and it is asked on every keystroke.
 */
function sameConnection(config: ConnectionConfig, preset: ConnectionPreset): boolean {
  const saved = configOf(preset)
  return (
    config.host === saved.host &&
    config.port === saved.port &&
    config.database === saved.database &&
    config.user === saved.user &&
    config.password === saved.password &&
    Boolean(config.ssl) === Boolean(saved.ssl) &&
    (config.slug ?? '') === (saved.slug ?? '') &&
    JSON.stringify(config.databaseAliases ?? {}) === JSON.stringify(saved.databaseAliases ?? {})
  )
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
  /**
   * The preset the form is showing, as it was saved.
   *
   * Kept alongside the live config so an edit stays attached to the preset it
   * came from: the fields changing is how you correct a preset, and it used to
   * be how you silently lost it — the next save asked for a name, suggested
   * `user@host`, and left the original behind as a second entry for one server.
   */
  const [editing, setEditing] = useState<ConnectionPreset | null>(null)
  /** The preset whose chip is waiting on a confirmed Forget, if any. */
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  /** The preset whose chip is being renamed, if any. */
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  /** The name being typed into the save box, or null while it is closed. */
  const [draftName, setDraftName] = useState<string | null>(null)

  const dirty = editing !== null && !sameConnection(config, editing)
  /** Which chip is lit: the preset on screen, only while it is still that preset. */
  const selectedPresetName = editing && !dirty ? editing.name : undefined

  const update = (field: keyof ConnectionConfig, value: string | number | boolean) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }

  const applyPreset = (preset: ConnectionPreset) => {
    setConfig(configOf(preset))
    setEditing(preset)
    setDraftName(null)
    setRenaming(null)
  }

  /** Write the form back over the preset it came from. */
  const saveEdit = async () => {
    if (!editing) return
    await onSavePreset({ ...config, name: editing.name })
    setEditing({ ...config, name: editing.name })
  }

  const commitRename = async () => {
    const name = renaming?.to.trim()
    if (!renaming || !name || name === renaming.from) return setRenaming(null)

    // A preset is identified by its name, so a rename is the new entry plus the
    // old one forgotten — in that order, so a failure leaves the preset there.
    const preset = presets.find((p) => p.name === renaming.from)
    if (!preset) return setRenaming(null)
    await onSavePreset({ ...preset, name })
    await onDeletePreset(renaming.from)
    if (editing?.name === renaming.from) setEditing({ ...preset, name })
    setRenaming(null)
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
   * A new preset is named after the connection rather than after the one on
   * screen: this box exists for the entry that is *not* the preset being edited —
   * correcting that one is Save changes.
   */
  const openSaveBox = () => {
    setPendingRemoval(null)
    setRenaming(null)
    setDraftName(`${config.user}@${config.host}`)
  }

  const saveDraft = async () => {
    const name = draftName?.trim()
    if (!name) return
    await onSavePreset({ ...config, name })
    setEditing({ ...config, name })
    setDraftName(null)
  }

  const confirmRemoval = async (name: string) => {
    await onDeletePreset(name)
    setPendingRemoval(null)
    if (editing?.name === name) setEditing(null)
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
            ) : renaming?.from === preset.name ? (
              <span key={preset.name} className="inline-flex items-center gap-1.5">
                <label className="sr-only" htmlFor={fieldId('rename-preset')}>
                  New name for {preset.name}
                </label>
                <input
                  id={fieldId('rename-preset')}
                  type="text"
                  autoFocus
                  value={renaming.to}
                  onChange={(e) => setRenaming({ from: preset.name, to: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitRename()
                    }
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  className="w-40 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1.5 text-xs text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
                />
                <button
                  type="button"
                  onClick={commitRename}
                  className="inline-flex items-center gap-1 rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-3 py-1.5 text-xs font-semibold text-[var(--lagoon-deep)]"
                >
                  <Check aria-hidden className="h-3 w-3" />
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => setRenaming(null)}
                  className="px-1 text-xs text-[var(--sea-ink-soft)] underline underline-offset-2"
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
                    : editing?.name === preset.name
                      ? 'border-dashed border-[var(--lagoon)]'
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
                  aria-label={`Rename ${preset.name}`}
                  title={`Rename ${preset.name}`}
                  onClick={() => {
                    setPendingRemoval(null)
                    setDraftName(null)
                    setRenaming({ from: preset.name, to: preset.name })
                  }}
                  className="py-1.5 px-1 text-[var(--sea-ink-soft)] transition hover:text-[var(--sea-ink)]"
                >
                  <Pencil aria-hidden className="h-3 w-3" />
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
        {/* An edit in progress says whose it is and what will happen to it. The
            three ways out are all here: keep it, undo it, or keep both. */}
        {dirty && editing && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--lagoon)]/40 bg-[rgba(79,184,178,0.08)] px-3 py-2 text-xs">
            <span className="text-[var(--sea-ink)]">
              Editing <span className="font-semibold">{editing.name}</span> — unsaved changes
            </span>
            <button
              type="button"
              onClick={saveEdit}
              className="inline-flex items-center gap-1 rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-3 py-1 font-semibold text-[var(--lagoon-deep)]"
            >
              <Check aria-hidden className="h-3 w-3" />
              Save changes
            </button>
            <button
              type="button"
              onClick={() => setConfig(configOf(editing))}
              className="text-[var(--sea-ink-soft)] underline underline-offset-2 hover:text-[var(--sea-ink)]"
            >
              Revert
            </button>
            <button
              type="button"
              onClick={openSaveBox}
              className="text-[var(--sea-ink-soft)] underline underline-offset-2 hover:text-[var(--sea-ink)]"
            >
              Save as new...
            </button>
          </div>
        )}
        <p className="mt-1.5 text-xs text-[var(--sea-ink-soft)]">
          Saved to <code>local/presets.json</code>, credentials and all. A chip loads
          a preset into the form; editing the fields keeps it attached until you save
          or revert.
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

      <div>
        <label className={labelClass} htmlFor={fieldId('slug')}>
          Metadata folder <span className="font-normal text-[var(--sea-ink-soft)]">(optional)</span>
        </label>
        <input
          id={fieldId('slug')}
          type="text"
          value={config.slug ?? ''}
          onChange={(e) => update('slug', e.target.value)}
          className={inputClass}
          placeholder={config.host}
        />
        <p className="mt-1.5 text-xs text-[var(--sea-ink-soft)]">
          Which folder under <code>local/</code> holds this server's private schema
          metadata. Defaults to the host — name it yourself when the host does not
          identify the server, as two local clusters both called{' '}
          <code>localhost</code> do.
        </p>
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
