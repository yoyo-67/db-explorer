import { useEffect } from 'react'
import { parseScale, TEXT_SCALE_KEY } from '#/lib/text-scale'

/**
 * Keeps the document at the stored text size.
 *
 * The head script sets the zoom before paint, and hydrating the document
 * reconciles `<html>` and takes that inline style with it — the same way it
 * takes the theme class. The theme at least came back when the menu mounted its
 * toggle; the size never did, because the control only reads the stored value.
 * So the size, like the palette, is owned by something always mounted.
 */
export default function TextScaleSync() {
  useEffect(() => {
    try {
      document.documentElement.style.zoom = String(
        parseScale(window.localStorage.getItem(TEXT_SCALE_KEY)),
      )
    } catch {
      /* private mode — the default size is the honest fallback */
    }
  }, [])

  return null
}
