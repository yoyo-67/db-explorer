import { useMemo, useRef, useState } from 'react'
import TableName, { useTableNameText } from '#/components/TableName'
import { useModelNames } from '#/hooks/useModelNames'
import { searchTableChoices, type TableChoice } from '#/lib/indexes/ranking'

/**
 * Narrow the page to one table, by typing rather than by scrolling.
 *
 * A `<select>` cannot do either half of what this page needs: its options are
 * plain strings, so a table could only be printed as its identifier — never as
 * the model name the rest of the app prints beside it — and on a schema with
 * hundreds of indexed tables the only way to reach one is to scroll for it.
 *
 * The chosen table is exact, so this is a picker over a known list, not a
 * search box: what is typed narrows the offered rows and is thrown away on
 * pick. Only `criteria.table` reaches the URL.
 */
export default function TablePicker({
  tables,
  selected,
  onSelect,
}: {
  tables: TableChoice[]
  selected: string | null
  onSelect: (table: string | null) => void
}) {
  const models = useModelNames()
  const nameText = useTableNameText()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  /** Which row Enter would pick. Reset on every keystroke, because the list is. */
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const hits = useMemo(
    () => searchTableChoices(tables, query, models),
    [tables, query, models],
  )

  function pick(table: string | null) {
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
    onSelect(table)
  }

  if (selected !== null) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-[10px] text-[var(--sea-ink-soft)]">table</span>
        <span
          title={nameText(selected)}
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--sea-ink)]"
        >
          <TableName table={selected} />
        </span>
        <button
          type="button"
          onClick={() => pick(null)}
          className="shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]"
        >
          every table
        </button>
      </div>
    )
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onFocus={() => setOpen(true)}
        // The list closes on a pick or on Escape, not on blur: a mouse-down on a
        // row blurs the input before its click ever lands.
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setQuery('')
            setOpen(false)
            inputRef.current?.blur()
            return
          }
          if (!open || hits.length === 0) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((i) => (i + 1) % hits.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((i) => (i - 1 + hits.length) % hits.length)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const hit = hits[Math.min(active, hits.length - 1)]
            if (hit) pick(hit.table)
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls="index-table-picker"
        placeholder={`every table (${tables.length}) — type to narrow`}
        aria-label="Show indexes on one table"
        className="w-full min-w-0 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-[11px] text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
      />

      {open && (
        <ul
          id="index-table-picker"
          role="listbox"
          className="absolute z-20 mt-1 max-h-[320px] w-full overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] py-0.5 shadow-lg"
        >
          {hits.length === 0 ? (
            <li className="px-2 py-1.5 text-[11px] text-[var(--sea-ink-soft)]">
              No table on this page matches.
            </li>
          ) : (
            hits.map((hit, i) => (
              <li key={hit.table} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    pick(hit.table)
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-[11px] ${
                    i === active ? 'bg-[var(--chip-bg)]' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[var(--sea-ink)]">
                    <TableName table={hit.table} />
                  </span>
                  <span className="shrink-0 tabular-nums text-[10px] text-[var(--sea-ink-soft)]">
                    {hit.count}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
