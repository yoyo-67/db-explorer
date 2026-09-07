import { useEffect, useState } from 'react'

/**
 * The paste box. Submits rather than searching as you type: every question here
 * costs a round of index lookups across the schema, and half a pasted uuid is a
 * question with no answer.
 */
export default function FindBox({
  value,
  onSubmit,
  busy,
}: {
  value: string
  onSubmit: (next: string) => void
  busy: boolean
}) {
  const [draft, setDraft] = useState(value)
  // The URL is the source of truth: arriving on a shared link, or pressing back,
  // has to show what is being searched for.
  useEffect(() => setDraft(value), [value])

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(draft.trim())
      }}
    >
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Paste an id, uuid, email or token"
        spellCheck={false}
        autoComplete="off"
        aria-label="Value to find"
        className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1.5 font-mono text-xs text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)] focus:border-[var(--lagoon)]"
      />
      <button
        type="submit"
        disabled={draft.trim().length === 0}
        className="cursor-pointer rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-xs text-[var(--sea-ink)] transition hover:bg-[var(--link-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Looking…' : 'Find'}
      </button>
    </form>
  )
}
