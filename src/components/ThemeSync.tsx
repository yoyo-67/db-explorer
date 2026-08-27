import { useEffect } from 'react'
import { syncThemeToDocument, useThemeMode } from '#/hooks/useTheme'

/**
 * Keeps the document painted in the stored theme, from the moment the app is
 * running to whenever the reader or their operating system changes its mind.
 *
 * Rendered by the document itself and drawing nothing, because the one thing it
 * has to be is always mounted. The head script paints the first frame; hydrating
 * the document then reconciles `<html>` and takes the class it added with it, so
 * something that outlives hydration has to put it back. That used to be the
 * theme toggle, which lives inside the header menu — a dark reader got a light
 * page until they opened that menu.
 */
export default function ThemeSync() {
  const mode = useThemeMode()

  // After hydration, and again whenever the stored mode changes — including a
  // change made in another tab.
  useEffect(() => {
    syncThemeToDocument()
  }, [mode])

  // `auto` keeps following the system, so a laptop that flips at sunset flips
  // the page with it. An explicit choice deliberately does not listen.
  useEffect(() => {
    if (mode !== 'auto') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => syncThemeToDocument()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [mode])

  return null
}
