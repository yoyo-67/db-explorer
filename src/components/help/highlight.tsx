import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * The link between a clause of SQL and the pixels it produced.
 *
 * One id is active at a time, set by hovering (or focusing) either side. Both
 * the mock and the walkthrough read the same id, so pointing at a column header
 * lights up the `SELECT` line that fetched it, and pointing at the `SELECT` line
 * lights up the column header. Nothing is highlighted until something is
 * pointed at — a page that starts lit reads as a page with an error on it.
 */

interface HighlightState {
  activeId: string | null
  setActiveId: (id: string | null) => void
}

const HighlightContext = createContext<HighlightState>({
  activeId: null,
  setActiveId: () => {},
})

export function HighlightProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const value = useMemo(() => ({ activeId, setActiveId }), [activeId])
  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>
}

export function useHighlight(): HighlightState {
  return useContext(HighlightContext)
}

/** Props that make any element a highlight target for `stepId`. */
export function highlightProps(stepId: string, state: HighlightState) {
  return {
    onMouseEnter: () => state.setActiveId(stepId),
    onMouseLeave: () => state.setActiveId(null),
    onFocus: () => state.setActiveId(stepId),
    onBlur: () => state.setActiveId(null),
  }
}

/**
 * A piece of the mock that a clause produced. Wraps its children in a span so it
 * can sit inside a table cell or a heading without disturbing the layout.
 */
export function Marked({
  step,
  children,
  className = '',
}: {
  step: string
  children: ReactNode
  className?: string
}) {
  const state = useHighlight()
  const on = state.activeId === step
  return (
    <span
      {...highlightProps(step, state)}
      tabIndex={0}
      className={`rounded-[3px] outline-none transition-colors ${
        on
          ? 'bg-[rgba(79,184,178,0.28)] ring-1 ring-[var(--lagoon-deep)]'
          : 'hover:bg-[rgba(79,184,178,0.12)]'
      } ${className}`}
    >
      {children}
    </span>
  )
}
