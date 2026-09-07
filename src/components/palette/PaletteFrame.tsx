import { useEffect, useRef } from 'react'
import TableName from '#/components/TableName'
import type { PaletteCrumb } from '#/lib/palette/views'

/**
 * The floating window: backdrop, card, breadcrumb, the one input, and the key
 * hints along the bottom.
 *
 * All chrome, no knowledge of what is being searched. The input is the only
 * focusable thing inside on purpose — every key the palette answers is handled
 * here, so there is never a state where the arrow keys go somewhere else.
 */
export default function PaletteFrame({
  breadcrumb,
  placeholder,
  query,
  onQuery,
  onKeyDown,
  onClose,
  status,
  footer,
  children,
}: {
  /** Root first. The last entry is the page being shown. */
  breadcrumb: PaletteCrumb[]
  placeholder: string
  query: string
  onQuery: (next: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onClose: () => void
  /** Right of the breadcrumb: what the page is doing — searching, counting. */
  status?: string
  footer: React.ReactNode
  children: React.ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)

  // The palette is opened by a chord, so it has to arrive focused; a pushed page
  // re-focuses through the same effect because the box's meaning changed.
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [breadcrumb.length])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Explore"
    >
      {/* Click-away closes. The backdrop is dark in both themes: the palette is
          a thing over the page, not a part of it. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px]"
      />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-3 pt-2 pb-1 text-[10px] text-[var(--sea-ink-soft)]">
          {breadcrumb.map((crumb, index) => (
            <span
              key={`${crumb.label}-${crumb.table ?? ''}-${index}`}
              className="flex items-center gap-1.5"
            >
              {index > 0 && <span aria-hidden>›</span>}
              <span
                className={
                  index === breadcrumb.length - 1
                    ? 'font-semibold text-[var(--sea-ink)]'
                    : undefined
                }
              >
                {crumb.label}
                {crumb.table && (
                  <>
                    {' · '}
                    <TableName table={crumb.table} />
                  </>
                )}
              </span>
            </span>
          ))}
          {status && <span className="ml-auto tabular-nums">{status}</span>}
        </div>

        <div className="border-b border-[var(--line)] px-3">
          <input
            ref={input}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            aria-label={breadcrumb[breadcrumb.length - 1]?.label}
            className="w-full bg-transparent py-3 font-mono text-sm text-[var(--sea-ink)] outline-none placeholder:font-sans placeholder:text-[var(--sea-ink-soft)]"
          />
        </div>

        {children}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--sea-ink-soft)]">
          {footer}
        </div>
      </div>
    </div>
  )
}

/** One key hint. Spelled the way the key is printed on the key. */
export function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1 py-px font-sans text-[10px] text-[var(--sea-ink)]">
        {keys}
      </kbd>
      {label}
    </span>
  )
}
