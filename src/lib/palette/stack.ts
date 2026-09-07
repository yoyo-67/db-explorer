import { viewCrumb } from '#/lib/palette/views'
import type { PaletteCrumb, PaletteView } from '#/lib/palette/views'

/**
 * The palette's page stack, and the text typed on each page.
 *
 * The query lives per entry rather than once for the whole palette so that
 * popping back restores what you had typed — you drilled into a table from a
 * half-typed filter, and coming back to an empty box would read as a bug. It is
 * also why the stack is a value: every transition here is one function with one
 * answer, testable without a keyboard.
 */

export interface PaletteEntry {
  view: PaletteView
  query: string
}

export type PaletteStack = readonly PaletteEntry[]

export function initialStack(): PaletteStack {
  return [{ view: { kind: 'actions' }, query: '' }]
}

/** The page on top. Never undefined: the root cannot be popped. */
export function current(stack: PaletteStack): PaletteEntry {
  return stack[stack.length - 1] ?? { view: { kind: 'actions' }, query: '' }
}

export function setQuery(stack: PaletteStack, query: string): PaletteStack {
  return [...stack.slice(0, -1), { ...current(stack), query }]
}

/** Push a page, with the box starting empty unless the caller seeds it. */
export function push(
  stack: PaletteStack,
  view: PaletteView,
  query = '',
): PaletteStack {
  return [...stack, { view, query }]
}

export function canPop(stack: PaletteStack): boolean {
  return stack.length > 1
}

export function pop(stack: PaletteStack): PaletteStack {
  return canPop(stack) ? stack.slice(0, -1) : stack
}

/** The trail across the top, root first. */
export function breadcrumb(stack: PaletteStack): PaletteCrumb[] {
  return stack.map((entry) => viewCrumb(entry.view))
}
