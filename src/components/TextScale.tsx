import { useEffect, useState } from 'react'
import {
  DEFAULT_SCALE,
  TEXT_SCALE_KEY,
  isLargest,
  isSmallest,
  parseScale,
  scaleDown,
  scaleLabel,
  scaleUp,
} from '#/lib/text-scale'

/**
 * Bigger / smaller text, remembered per browser.
 *
 * The stored value is applied by a script in the document head before paint, so
 * this component only has to catch up with what is already on screen — reading
 * it in an effect rather than during render keeps the server's HTML and the
 * first client render identical.
 */
function applyScale(scale: number) {
  document.documentElement.style.zoom = String(scale)
}

export default function TextScale() {
  const [scale, setScale] = useState(DEFAULT_SCALE)

  useEffect(() => {
    setScale(parseScale(window.localStorage.getItem(TEXT_SCALE_KEY)))
  }, [])

  const change = (next: number) => {
    setScale(next)
    applyScale(next)
    try {
      window.localStorage.setItem(TEXT_SCALE_KEY, String(next))
    } catch {
      /* private mode — the size still applies for this page */
    }
  }

  return (
    <div
      className="flex items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)]"
      role="group"
      aria-label="Text size"
    >
      <Step
        onClick={() => change(scaleDown(scale))}
        disabled={isSmallest(scale)}
        label="Smaller text"
      >
        A−
      </Step>
      <button
        type="button"
        onClick={() => change(DEFAULT_SCALE)}
        title={`Text size ${scaleLabel(scale)} — click to reset`}
        className="min-w-[3.1rem] px-1 py-1 text-xs font-semibold text-[var(--sea-ink-soft)] tabular-nums hover:text-[var(--sea-ink)]"
      >
        {scaleLabel(scale)}
      </button>
      <Step
        onClick={() => change(scaleUp(scale))}
        disabled={isLargest(scale)}
        label="Larger text"
      >
        A+
      </Step>
    </div>
  )
}

function Step({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="px-2.5 py-1 text-sm font-semibold text-[var(--sea-ink)] disabled:opacity-35"
    >
      {children}
    </button>
  )
}
