import { useCallback, useId, useMemo, useState } from 'react'
import { TONE_SOFT, TONE_TEXT } from '#/components/widgets/tone'
import type { Tone } from '#/components/widgets/tone'

/**
 * A panel that says what it is before it says anything else, and that can be
 * shut.
 *
 * Same contract as the pressure page's sections — title, a summary, the rule
 * that put things in it — with two additions the anatomy panels need: a tone,
 * because some of these are findings and some are only facts, and a collapse,
 * because a reader who has taken in the byte ruler wants it out of the way
 * rather than scrolled past.
 *
 * Open state is the caller's if it passes `open`, and the panel's own otherwise —
 * so a single panel needs no wiring and a page of them can still be opened and
 * shut together.
 */
export default function Panel({
  title,
  summary,
  rule,
  tone = 'neutral',
  badge,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  actions,
  children,
}: {
  title: string
  /** The one-line answer, shown next to the title and when collapsed. */
  summary?: string
  /** What makes something appear here — the argument, not the conclusion. */
  rule?: string
  tone?: Tone
  /** A short status word, coloured by tone. */
  badge?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const panelId = useId()

  const toggle = () => {
    const next = !open
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <section className="island-shell overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-[var(--line)] px-4 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 text-left"
        >
          <span
            aria-hidden
            className={`text-[10px] leading-none text-[var(--sea-ink-soft)] transition-transform ${
              open ? 'rotate-90' : ''
            }`}
          >
            ▶
          </span>
          <span className="text-sm font-semibold text-[var(--sea-ink)]">{title}</span>
          {badge && (
            <span
              className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${TONE_SOFT[tone]} ${TONE_TEXT[tone]}`}
            >
              {badge}
            </span>
          )}
          {summary && (
            <span className="min-w-0 truncate text-[11px] text-[var(--sea-ink-soft)]">
              {summary}
            </span>
          )}
        </button>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </header>
      {open && (
        <div id={panelId} className="min-w-0 px-4 py-3">
          {rule && (
            <p className="mb-2.5 text-[11px] leading-relaxed text-[var(--sea-ink-soft)]">{rule}</p>
          )}
          {children}
        </div>
      )}
    </section>
  )
}

export interface PanelGroup {
  /** Spread onto a `Panel` to put it under the group's control. */
  propsFor: (id: string) => { open: boolean; onOpenChange: (open: boolean) => void }
  expandAll: () => void
  collapseAll: () => void
}

/**
 * Panels that answer to one pair of buttons.
 *
 * State is stored as the exceptions to `allOpen` rather than as a list of open
 * ids, so a panel that has never been touched follows the group and a panel the
 * reader shut stays shut until the group is moved again.
 */
export function usePanelGroup(defaultOpen = true): PanelGroup {
  const [allOpen, setAllOpen] = useState(defaultOpen)
  const [exceptions, setExceptions] = useState<Set<string>>(() => new Set())

  const propsFor = useCallback(
    (id: string) => ({
      open: exceptions.has(id) ? !allOpen : allOpen,
      onOpenChange: () =>
        setExceptions((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        }),
    }),
    [allOpen, exceptions],
  )

  return useMemo(
    () => ({
      propsFor,
      expandAll: () => {
        setAllOpen(true)
        setExceptions(new Set())
      },
      collapseAll: () => {
        setAllOpen(false)
        setExceptions(new Set())
      },
    }),
    [propsFor],
  )
}

/** Every panel on a page, opened or shut together. */
export function PanelGroupControls({ group }: { group: PanelGroup }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={group.expandAll}
        className="rounded border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]"
      >
        Expand all
      </button>
      <button
        type="button"
        onClick={group.collapseAll}
        className="rounded border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]"
      >
        Shrink all
      </button>
    </div>
  )
}
