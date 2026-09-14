/**
 * How many rows a table page shows, and how that choice survives a page change.
 *
 * A fixed list rather than a free number: the size is part of the URL, and the
 * server clamps anything above 500 anyway (`#/server/functions`), so offering
 * the four sizes anyone actually wants keeps the control a row of buttons
 * instead of another text field to get wrong.
 */

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500] as const

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number]

export const DEFAULT_PAGE_SIZE: PageSize = 50

export function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value)
}

/** A URL's page size, or nothing — an unknown number is not honoured, because
 *  a size the buttons cannot show is a control that disagrees with the page. */
export function parsePageSize(raw: unknown): PageSize | undefined {
  const n = Number(raw)
  return Number.isFinite(n) && isPageSize(n) ? (n as PageSize) : undefined
}

/**
 * Which page to land on when the size changes.
 *
 * Anchored on the first row currently shown rather than reset to page 1: going
 * from 50 to 100 on page 8 is a request to see more of what is on screen, and
 * being thrown back to the top of the table is not that. Row 351 of page 8 at
 * 50 is on page 4 at 100, and that is where this goes.
 */
export function pageForNewSize(page: number, oldSize: number, newSize: number): number {
  const firstRow = Math.max(0, (Math.max(1, page) - 1) * oldSize)
  return Math.floor(firstRow / newSize) + 1
}
