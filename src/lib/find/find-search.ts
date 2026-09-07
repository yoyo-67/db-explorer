import { encodeConditions } from '#/lib/filter-model'

/**
 * URL state for Find. Both stages live in the URL, so a hunt that landed
 * somewhere is a link: `?v=<value>` is the question, `&owner=<table>` is which
 * of the answers is being expanded.
 *
 * The value stays in the URL rather than in component state on purpose — the
 * thing being searched for is the whole point of the page, and a reader who
 * pastes a support ticket's id wants to send someone the result, not the form.
 */
export interface FindSearch {
  /** The value being looked for, as pasted. Absent is the empty page. */
  v?: string
  /** The owning table whose reach is expanded. */
  owner?: string
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function validateFindSearch(search: Record<string, unknown>): FindSearch {
  return { v: text(search.v), owner: text(search.owner) }
}

/**
 * The table view, filtered to the rows a reach entry counted. Reuses the filter
 * model rather than a second encoding, so the link lands on a page whose filter
 * panel shows the same condition the count applied.
 */
export function reachTableSearch(column: string, value: string): { q: string[] } {
  return {
    q: encodeConditions([
      { id: `find-${column}`, column, op: 'eq', values: [value] },
    ]),
  }
}
