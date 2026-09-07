import { useEffect, useRef } from 'react'
import TableName from '#/components/TableName'
import { opensNewTab } from '#/lib/link-click'
import { groupRows } from '#/lib/palette/rows'
import type { PaletteRowModel } from '#/lib/palette/rows'

/**
 * The rows, grouped, with one of them selected.
 *
 * Selection is the caller's state rather than this component's: the keyboard
 * lives on the input, which never loses focus, so the list is told what is
 * selected instead of tracking it. Its own job is to keep that row visible and
 * to run the row that is clicked.
 */
export default function PaletteList({
  rows,
  selected,
  onSelect,
  empty,
}: {
  rows: PaletteRowModel[]
  selected: number
  onSelect: (index: number) => void
  /** What to say when there is nothing — never an empty box. */
  empty: React.ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)

  // Arrow keys move the selection off screen on a long list; the list follows.
  useEffect(() => {
    const node = container.current?.querySelector<HTMLElement>('[data-selected="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [selected, rows])

  if (rows.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-[var(--sea-ink-soft)]">{empty}</div>
    )
  }

  let index = -1
  return (
    <div ref={container} className="max-h-[52vh] overflow-y-auto px-1.5 py-1.5">
      {groupRows(rows).map(([group, groupRowsInOrder]) => (
        <div key={group} className="pb-1">
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold tracking-wide text-[var(--sea-ink-soft)] uppercase">
            {group}
          </p>
          <ul role="listbox" aria-label={group}>
            {groupRowsInOrder.map((row) => {
              index += 1
              const position = index
              const active = position === selected
              return (
                <li key={row.id}>
                  {/* An anchor when the row has a destination, so the browser's
                      own new-tab gestures keep working; a button when it only
                      pushes another palette page. */}
                  <Row
                    href={row.href}
                    active={active}
                    // Pointer moves the selection rather than only highlighting,
                    // so Enter always runs what looks chosen.
                    onMouseMove={() => onSelect(position)}
                    onClick={(event) => {
                      // The browser is taking it to a new tab; do not also
                      // navigate this one.
                      if (row.href && opensNewTab(event)) return
                      event.preventDefault()
                      row.run()
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-xs ${
                          row.muted
                            ? 'text-[var(--sea-ink-soft)]'
                            : 'font-medium text-[var(--sea-ink)]'
                        }`}
                      >
                        {row.table ? (
                          <>
                            <TableName table={row.table} />
                            {row.column && (
                              <span className="font-mono text-[var(--sea-ink-soft)]">
                                .{row.column}
                              </span>
                            )}
                          </>
                        ) : (
                          row.title
                        )}
                      </span>
                      {row.hint && (
                        <span className="block truncate text-[10px] text-[var(--sea-ink-soft)]">
                          {row.hint}
                        </span>
                      )}
                    </span>
                    {row.meta && (
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--sea-ink-soft)]">
                        {row.meta}
                      </span>
                    )}
                  </Row>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The row's clickable body: a link where there is somewhere to go. */
function Row({
  href,
  active,
  onMouseMove,
  onClick,
  children,
}: {
  href?: string
  active: boolean
  onMouseMove: () => void
  onClick: (event: React.MouseEvent) => void
  children: React.ReactNode
}) {
  const className = `flex w-full cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 text-left no-underline transition ${
    active ? 'bg-[rgba(79,184,178,0.16)]' : 'hover:bg-[var(--link-bg-hover)]'
  }`
  if (href) {
    return (
      <a
        href={href}
        role="option"
        aria-selected={active}
        data-selected={active}
        onMouseMove={onMouseMove}
        onClick={onClick}
        className={className}
      >
        {children}
      </a>
    )
  }
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-selected={active}
      onMouseMove={onMouseMove}
      onClick={onClick}
      className={className}
    >
      {children}
    </button>
  )
}
