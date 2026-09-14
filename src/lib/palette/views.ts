/**
 * The pages of the palette.
 *
 * The palette is not one list with a filter — it is a small stack of pages, the
 * way Raycast is: the root offers what you can do, and choosing something pushes
 * a page that asks the next question. Pasting an id pushes *Find*, whose rows
 * are the tables that own it; choosing one pushes *Where else*, whose rows are
 * the columns that hold it. Backspace on an empty box pops.
 *
 * The views are data, not components, so the stack (`#/lib/palette/stack`) can
 * be reasoned about and tested without a DOM, and so a title cannot drift from
 * the page it names.
 */

export type PaletteView =
  /** The root: what you can do from here. */
  | { kind: 'actions' }
  /** Every table in the schema, fuzzy-matched by name. */
  | { kind: 'tables' }
  /** Stage one of Find: the box holds the value, the rows are its owners. */
  | { kind: 'find' }
  /** Stage two: the columns referencing `owner`, and whether they hold `value`. */
  | { kind: 'reach'; value: string; owner: string }
  /** The columns of the table being read, to start a filter on one of them. */
  | { kind: 'filter'; table: string }

/**
 * One step of the trail across the top of the palette.
 *
 * A table is carried as an identifier rather than baked into the label, because
 * a table name is printed the way the reader asked for it everywhere else in
 * the app (`#/components/TableName`) and the palette is not going to be the one
 * place that disagrees.
 */
export interface PaletteCrumb {
  label: string
  table?: string
}

export function viewCrumb(view: PaletteView): PaletteCrumb {
  switch (view.kind) {
    case 'actions':
      return { label: 'Explore' }
    case 'tables':
      return { label: 'Tables' }
    case 'find':
      return { label: 'Find a value' }
    case 'reach':
      return { label: 'Where else', table: view.owner }
    case 'filter':
      return { label: 'Filter', table: view.table }
  }
}

/** The crumb as plain text — for a test, a title attribute, an aria label. */
export function viewTitle(view: PaletteView): string {
  const crumb = viewCrumb(view)
  return crumb.table ? `${crumb.label} · ${crumb.table}` : crumb.label
}

/** What the input asks for on this page — the box changes meaning per view. */
export function viewPlaceholder(view: PaletteView): string {
  switch (view.kind) {
    case 'actions':
      return 'Search, or paste an id…'
    case 'tables':
      return 'Table name…'
    case 'find':
      return 'Paste an id, uuid, email or token…'
    case 'reach':
      return 'Filter the columns holding it…'
    case 'filter':
      return 'Which column…'
  }
}

/**
 * Whether typing in the box changes what is asked of the server, rather than
 * only filtering what came back. Find is the one page where it does — which is
 * why it is the one page that waits for Enter instead of searching as you type.
 */
export function viewSubmits(view: PaletteView): boolean {
  return view.kind === 'find'
}
