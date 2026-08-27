import { setThemeMode, useThemeMode } from '#/hooks/useTheme'
import { nextThemeMode } from '#/lib/theme'

/**
 * One button through light → dark → auto.
 *
 * A reader of the theme store and nothing more: the palette is applied by
 * {@link ThemeSync} on the document, so this can sit inside a menu that only
 * mounts when opened without the page's colours depending on that.
 */
export default function ThemeToggle() {
  const mode = useThemeMode()

  const label =
    mode === 'auto'
      ? 'Theme mode: auto (system). Click to switch to light mode.'
      : `Theme mode: ${mode}. Click to switch mode.`

  return (
    <button
      type="button"
      onClick={() => setThemeMode(nextThemeMode(mode))}
      aria-label={label}
      title={label}
      className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
    >
      {mode === 'auto' ? 'Auto' : mode === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}
