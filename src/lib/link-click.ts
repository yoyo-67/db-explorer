/**
 * When a click on a link-shaped thing belongs to the browser, not to us.
 *
 * Half the lens is SVG, so its nodes and stubs used to navigate from an `onClick`
 * handler — which quietly took ctrl-click, middle-click and "Open link in a new
 * tab" away from every one of them. The fix is a real anchor everywhere plus this
 * one predicate: the handler bails out and lets the default happen whenever the
 * click asked for a new tab or window.
 */
export interface ClickIntent {
  /** Cmd on macOS, and the modifier browsers use for "new tab" there. */
  metaKey?: boolean
  ctrlKey?: boolean
  /** With ctrl/cmd this is "new tab, foreground"; alone it is "new window". */
  shiftKey?: boolean
  altKey?: boolean
  /** 0 = primary, 1 = middle ("new tab" on its own, via auxclick). */
  button?: number
}

export function opensNewTab(e: ClickIntent): boolean {
  return (
    e.button === 1 ||
    !!e.metaKey ||
    !!e.ctrlKey ||
    !!e.shiftKey ||
    !!e.altKey
  )
}
