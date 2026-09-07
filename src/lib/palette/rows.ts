/**
 * One row of the palette, whatever page produced it.
 *
 * Every page — commands, tables, owners of an id, columns holding it — renders
 * the same row shape, so the list, the keyboard and the selection are written
 * once. What a row *does* is a closure the page provides: the list never learns
 * about routing, and a page never learns about selection.
 */

export interface PaletteRowModel {
  id: string
  /** Plain text of the row, for matching and for the accessible name. */
  title: string
  /**
   * The row is about this table, so the list prints it the way the rest of the
   * app does — identifier or model first, per the reader's setting
   * (`#/components/TableName`). Without this a palette row would be the one
   * place in the app spelling a table differently from the sidebar.
   */
  table?: string
  /** Printed after the table name, for a row about one of its columns. */
  column?: string
  /** Small text on the right — a row count, a type, a count of hits. */
  meta?: string
  /** One line under the title. */
  hint?: string
  /** Heading this row sits under. */
  group: string
  /** Dimmed: present, and not the answer — a column nothing was counted for. */
  muted?: boolean
  /**
   * Where the row goes, as a URL, when it goes anywhere.
   *
   * Present so the row can be a real anchor: middle-click, `⌘`-click and "open
   * in a new tab" then work on it the way they work on every other link in the
   * app (`#/lib/link-click`), instead of being swallowed by a click handler.
   */
  href?: string
  /** What `↵` and a plain click do. */
  run: () => void
  /**
   * What `⇥` does — the row's follow-up question, when it has one. An owner row
   * opens the row itself; where else the id appears is one keystroke further,
   * rather than a second row competing with the first.
   */
  runAlt?: () => void
  /** Names the follow-up in the footer, so the key is discoverable. */
  altLabel?: string
}

/** Group rows for rendering, in first-appearance order. */
export function groupRows<T extends { group: string }>(rows: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = groups.get(row.group)
    if (bucket) bucket.push(row)
    else groups.set(row.group, [row])
  }
  return [...groups.entries()]
}

/**
 * Move the selection, wrapping at both ends.
 *
 * Wrapping rather than clamping because the list is short and the keyboard is
 * the point: pressing down at the bottom to reach the top is one key instead of
 * eight. An empty list keeps selection at zero, which renders as no highlight.
 */
export function moveSelection(current: number, count: number, delta: number): number {
  if (count <= 0) return 0
  return (((current + delta) % count) + count) % count
}
