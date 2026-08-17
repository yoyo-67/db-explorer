import { useEffect, useRef, useState } from 'react'

/**
 * Copy-to-clipboard with the outcome said out loud. A copy that silently failed
 * (no clipboard permission, insecure origin) is worse than no button, so the
 * failure gets its own label rather than looking like success.
 */
export default function CopyButton({
  text,
  label = 'Copy',
  className = '',
}: {
  text: string
  label?: string
  className?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1_800)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={`rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)] ${className}`}
    >
      {state === 'copied' ? '✓ Copied' : state === 'failed' ? 'Copy blocked' : label}
    </button>
  )
}
