import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  $dropDatabase,
  $getDatabaseAliases,
  $getDatabases,
  $renameDatabase,
  $setDatabaseAlias,
} from '#/server/api'
import { useConnectionState } from '#/hooks/useConnectionStatus'
import { useDatabase } from '#/hooks/useDatabase'

/**
 * The three things you do to a database rather than inside one: rename it, point
 * it at another database's private metadata, and drop it.
 *
 * It lives on the settings page rather than in the header, where the picker is:
 * the picker moves you between databases many times a session, this changes the
 * server and is reached for once. A drop asks for the name in full — the
 * statement is irreversible, and a restore and its original usually differ by a
 * suffix.
 *
 * Everything here is scoped to the connection in play. An alias is kept on the
 * saved preset, so an ad-hoc connection is told to save itself first rather than
 * being handed a control that silently forgets.
 */
export default function DatabaseAdmin() {
  const state = useConnectionState()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const viewing = useDatabase()

  /** The row with an editor open, and which editor: only one at a time. */
  const [editing, setEditing] = useState<{ database: string; kind: 'rename' | 'drop' } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const databasesQuery = useQuery({
    queryKey: ['databases'],
    queryFn: () => $getDatabases(),
    staleTime: 60_000,
    enabled: state === 'connected',
  })
  const aliasesQuery = useQuery({
    queryKey: ['databaseAliases'],
    queryFn: () => $getDatabaseAliases(),
    staleTime: 60_000,
    enabled: state === 'connected',
  })

  if (state !== 'connected') {
    return (
      <p className="py-4 text-xs text-[var(--sea-ink-soft)]">
        Connect to a server to manage its databases.
      </p>
    )
  }

  const databases = databasesQuery.data ?? []
  const aliases = aliasesQuery.data?.aliases ?? {}
  const savedAs = aliasesQuery.data?.savedAs ?? null

  const startEdit = (database: string, kind: 'rename' | 'drop') => {
    setEditing({ database, kind })
    setDraft(kind === 'rename' ? database : '')
    setError(null)
    setNote(null)
  }

  /** Run one server change, then put the panel back in a resting state. */
  const run = async (database: string, work: () => Promise<string | null>) => {
    setBusy(database)
    setError(null)
    setNote(null)
    try {
      const said = await work()
      setEditing(null)
      setNote(said)
      await queryClient.invalidateQueries({ queryKey: ['databases'] })
      await queryClient.invalidateQueries({ queryKey: ['databaseAliases'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const commitRename = (from: string) =>
    run(from, async () => {
      const to = draft.trim()
      if (!to || to === from) return null
      const result = await $renameDatabase({ data: { from, to } })

      // The URL names the database, so a page open on it has to follow the
      // rename or it is pointed at something that no longer exists.
      if (viewing === from) navigate({ to: '/d/$database', params: { database: to } })
      return result.metadataMoved
        ? `Renamed to ${to}, and its metadata folder moved with it.`
        : `Renamed to ${to}.`
    })

  const commitDrop = (database: string) =>
    run(database, async () => {
      await $dropDatabase({ data: { database } })

      // Nothing to read there any more: leave for a database that still exists.
      if (viewing === database) {
        const next = databases.find((db) => db.name !== database && db.canConnect)
        if (next) navigate({ to: '/d/$database', params: { database: next.name } })
      }
      return `Dropped ${database}. Its metadata folder under local/ was left in place.`
    })

  const commitAlias = (database: string, value: string) => {
    const aliasFor = value.trim() || null
    if ((aliases[database] ?? null) === aliasFor) return
    void run(database, async () => {
      await $setDatabaseAlias({ data: { database, aliasFor } })

      // Every catalog, schema map and cross-database rule on screen was read
      // under the old alias.
      await queryClient.invalidateQueries()
      return aliasFor ? `${database} now reads the metadata of ${aliasFor}.` : 'Alias cleared.'
    })
  }

  return (
    <div className="py-2">
      {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
      {note && !error && <p className="mb-3 text-xs text-[var(--lagoon-deep)]">{note}</p>}

      <ul className="divide-y divide-[var(--line)]/70">
        {databases.map((db) => {
          const rowBusy = busy === db.name
          const rowEditing = editing?.database === db.name ? editing.kind : null

          return (
            <li key={db.name} className="py-3 first:pt-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="min-w-[12rem] flex-1 truncate text-sm text-[var(--sea-ink)]">
                  {db.name}
                  {db.isCurrent && (
                    <span className="ml-2 text-xs text-[var(--sea-ink-soft)]">session</span>
                  )}
                  {!db.canConnect && (
                    <span className="ml-2 text-xs text-[var(--sea-ink-soft)]">no access</span>
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    disabled={rowBusy}
                    onClick={() => startEdit(db.name, 'rename')}
                    className="cursor-pointer text-xs text-[var(--sea-ink-soft)] underline underline-offset-2 hover:text-[var(--sea-ink)] disabled:opacity-50"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={rowBusy}
                    onClick={() => startEdit(db.name, 'drop')}
                    className="cursor-pointer text-xs text-red-500 underline underline-offset-2 hover:text-red-600 disabled:opacity-50"
                  >
                    Drop
                  </button>
                </div>
              </div>

              {rowEditing === 'rename' && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void commitRename(db.name)
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label={`New name for ${db.name}`}
                    className="min-w-[14rem] flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg-base)] px-2.5 py-1.5 text-sm text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
                  />
                  <button
                    type="submit"
                    disabled={rowBusy || !draft.trim() || draft.trim() === db.name}
                    className="cursor-pointer rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--sea-ink)] disabled:opacity-50"
                  >
                    {rowBusy ? 'Renaming...' : 'Rename'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="cursor-pointer px-1 text-xs text-[var(--sea-ink-soft)] underline underline-offset-2"
                  >
                    Cancel
                  </button>
                </form>
              )}

              {rowEditing === 'drop' && (
                <form
                  className="mt-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void commitDrop(db.name)
                  }}
                >
                  <p className="mb-1.5 text-xs text-[var(--sea-ink-soft)]">
                    Dropping <span className="text-[var(--sea-ink)]">{db.name}</span> deletes it and
                    every row in it. This cannot be undone — type the name to confirm.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label={`Type ${db.name} to confirm dropping it`}
                      placeholder={db.name}
                      className="min-w-[14rem] flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg-base)] px-2.5 py-1.5 text-sm text-[var(--sea-ink)] outline-none focus:border-red-500"
                    />
                    <button
                      type="submit"
                      disabled={rowBusy || draft.trim() !== db.name}
                      className="cursor-pointer rounded-lg border border-red-500/60 px-3 py-1.5 text-xs text-red-500 disabled:opacity-50"
                    >
                      {rowBusy ? 'Dropping...' : `Drop ${db.name}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="cursor-pointer px-1 text-xs text-[var(--sea-ink-soft)] underline underline-offset-2"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <AliasField
                database={db.name}
                aliasFor={aliases[db.name] ?? ''}
                savedAs={savedAs}
                disabled={rowBusy}
                onCommit={commitAlias}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The alias for one database, as its own field so typing in it does not re-render
 * the whole list on every keystroke.
 *
 * Committed on blur or Enter rather than per keystroke: a half-typed database
 * name is a folder nobody has written about, and saving it would empty the lens
 * until the rest arrived.
 */
function AliasField({
  database,
  aliasFor,
  savedAs,
  disabled,
  onCommit,
}: {
  database: string
  aliasFor: string
  savedAs: string | null
  disabled: boolean
  onCommit: (database: string, value: string) => void
}) {
  const [value, setValue] = useState(aliasFor)

  // The server is the record; a change made elsewhere — or refused — shows here.
  useEffect(() => setValue(aliasFor), [aliasFor])

  if (!savedAs) {
    return (
      <p className="mt-1.5 text-xs text-[var(--sea-ink-soft)]">
        Save this connection as a preset to give its databases aliases.
      </p>
    )
  }

  return (
    <label className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--sea-ink-soft)]">
      <span className="shrink-0">stands in for</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(database, value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit(database, value)
          }
          if (e.key === 'Escape') setValue(aliasFor)
        }}
        placeholder="itself"
        aria-label={`Database ${database} stands in for`}
        className="min-w-[14rem] flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg-base)] px-2.5 py-1 text-xs text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)] disabled:opacity-50"
      />
    </label>
  )
}
