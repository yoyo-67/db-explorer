/**
 * The open/closed state of the sidebar's groups, as arithmetic rather than as
 * UI. The set of open groups is remembered per browser and outlives any one
 * schema, so "open everything" and "close everything" have to be careful about
 * which names they are allowed to touch.
 */

/**
 * Groups a toggle-all has anything to say about: the named ones, drawn with a
 * disclosure arrow.
 *
 * A solo table has no group of its own and is always drawn open, so counting it
 * would make "all expanded" unreachable and leave the button stuck on
 * "Expand all" forever.
 */
export function togglableGroupNames(
  groups: readonly { name: string }[],
): string[] {
  return groups.filter((g) => g.name !== '').map((g) => g.name)
}

/** With nothing to toggle there is nothing to call expanded — the button is not
 *  drawn at all in that case, and this keeps it from claiming otherwise. */
export function allGroupsExpanded(
  expanded: ReadonlySet<string>,
  names: readonly string[],
): boolean {
  return names.length > 0 && names.every((name) => expanded.has(name))
}

/**
 * The next set of open groups after a toggle-all.
 *
 * Only the names on screen are added or removed: a group filtered out of view,
 * or one belonging to a schema this sidebar is not showing, keeps whatever state
 * the reader left it in rather than being closed by a button that never listed
 * it.
 */
export function toggleAllGroups(
  expanded: ReadonlySet<string>,
  names: readonly string[],
): Set<string> {
  const next = new Set(expanded)
  if (allGroupsExpanded(expanded, names)) {
    for (const name of names) next.delete(name)
    return next
  }
  for (const name of names) next.add(name)
  return next
}
