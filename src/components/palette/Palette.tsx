import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import type { NavigateOptions } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import PaletteFrame, { KeyHint } from '#/components/palette/PaletteFrame'
import PaletteList from '#/components/palette/PaletteList'
import { findHotkeyAltLabel, findHotkeyLabel, isFindHotkey } from '#/lib/find/hotkey'
import { skipExplanation } from '#/lib/find/reach-plan'
import type { ReachSkip } from '#/lib/find/reach-plan'
import { reachTableSearch } from '#/lib/find/find-search'
import { opensNewTab } from '#/lib/link-click'
import { tableFromPathname } from '#/lib/lens-links'
import { defaultOpForType, encodeConditions, operatorsForType } from '#/lib/filter-model'
import { buildColumnEntries, confidentColumnMatches, searchColumns } from '#/lib/column-search'
import type { ColumnEntry } from '#/lib/column-search'
import { rootRows } from '#/lib/palette/actions'
import type { PaletteRoute } from '#/lib/palette/actions'
import {
  breadcrumb as breadcrumbOf,
  canPop,
  current,
  initialStack,
  pop,
  push,
  setQuery,
} from '#/lib/palette/stack'
import { moveSelection } from '#/lib/palette/rows'
import { confidentTableMatches } from '#/lib/palette/table-matches'
import type { ColumnInfo } from '#/lib/types'
import type { PaletteRowModel } from '#/lib/palette/rows'
import { viewPlaceholder, viewSubmits } from '#/lib/palette/views'
import { fuzzySearch } from '#/lib/fuzzy'
import { useActiveSchema } from '#/hooks/useActiveSchema'
import { useConnectionStatus } from '#/hooks/useConnectionStatus'
import { useDatabase } from '#/hooks/useDatabase'
import { useModelNames } from '#/hooks/useModelNames'
import { useTableNameText } from '#/components/TableName'
import { $findValueOwners, $findValueReach, $introspect } from '#/server/api'

/**
 * The palette: a floating window over any page, opened by a chord, with pages
 * of its own.
 *
 * It exists for one motion the app could not do before — an id turns up
 * somewhere and you want to know where it lives, without losing the page you
 * are reading. Pasting one straight into the box offers it as the first row;
 * choosing it pushes the owners of that id, and choosing an owner pushes the
 * columns that hold it. Everything else in here (tables, the app's own pages) is
 * the same motion applied to things that were already only a click away.
 *
 * This component owns three things and delegates the rest: the chord, the page
 * stack (`#/lib/palette/stack`), and the mapping from a chosen row to a typed
 * router call. What each page offers is a list of `PaletteRowModel`s built
 * below; how they look is `PaletteList`; the window itself is `PaletteFrame`.
 */
export default function Palette() {
  const [open, setOpen] = useState(false)
  const [stack, setStack] = useState(initialStack())
  const [selected, setSelected] = useState(0)
  /**
   * The value Find has actually been asked about, as opposed to the one being
   * typed. Find is the one page whose typing costs a round of index lookups
   * across every candidate key, so it waits to be told.
   */
  const [submitted, setSubmitted] = useState<string | null>(null)

  const navigate = useNavigate()
  const router = useRouter()

  /**
   * One destination, twice over: the navigation and the URL for it.
   *
   * Generic so each call keeps its route's own parameter checking, and paired so
   * a row's link and its Enter can never point at different places.
   */
  const destination = useCallback(
    (options: NavigateOptions) => ({
      go: () => navigate(options),
      href: router.buildLocation(options).href,
    }),
    [navigate, router],
  )
  const database = useDatabase()
  const schema = useActiveSchema()
  const connected = useConnectionStatus().data?.connected ?? false
  /** The table on screen, if the page is about one — what *Filter this table*
   *  acts on. Read from the path for the same reason the database is. */
  const activeTable = useRouterState({
    select: (state) => tableFromPathname(state.location.pathname),
  })
  const models = useModelNames()
  /** The app's one way of spelling a table name, for the rows' plain text. */
  const nameOf = useTableNameText()
  const entry = current(stack)
  const view = entry.view
  const query = entry.query

  const close = useCallback(() => {
    setOpen(false)
    // Reopening lands on the root: the stack is a train of thought, and the one
    // from ten minutes ago is not this one. What was typed is not worth keeping
    // either — the next thing pasted is a different id.
    setStack(initialStack())
    setSubmitted(null)
    setSelected(0)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isFindHotkey(event)) return
      // Capture and cancel: `⌘J` is Chrome's Downloads shortcut, and this page
      // means something else by it. An extension holding the same chord through
      // `chrome.commands` is dispatched above the page and cannot be stopped
      // here — which is why `⌘K` opens the palette too.
      event.preventDefault()
      event.stopPropagation()
      setOpen((wasOpen) => !wasOpen)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  // A pushed or popped page starts at the top of its own list.
  useEffect(() => setSelected(0), [stack.length, query])

  /**
   * Where a command row goes. Returns the pair, so a command is a link like
   * everything else — `⌘↵` on *Schema lens* opens it beside what you are
   * reading, which is most of why you looked it up mid-task.
   *
   * A route needing a schema returns nothing when there is none rather than
   * guessing at one; the row is not offered in that state either.
   */
  const routeDestination = useCallback(
    (route: PaletteRoute) => {
      switch (route) {
        case 'tables':
          return database ? destination({ to: '/d/$database', params: { database } }) : null
        case 'columns':
          return database && schema
            ? destination({
                to: '/d/$database/columns/$schema',
                params: { database, schema },
                search: {},
              })
            : null
        case 'console':
          return database
            ? destination({ to: '/d/$database/console', params: { database } })
            : null
        case 'queries':
          return database
            ? destination({ to: '/d/$database/queries', params: { database } })
            : null
        case 'lens':
          return database && schema
            ? destination({
                to: '/d/$database/lens/$schema',
                params: { database, schema },
                search: {},
              })
            : null
        case 'find':
          return database && schema
            ? destination({
                to: '/d/$database/find/$schema',
                params: { database, schema },
                search: {},
              })
            : null
        case 'pressure':
          return database && schema
            ? destination({
                to: '/d/$database/pressure/$schema',
                params: { database, schema },
              })
            : null
        case 'indexes':
          return database && schema
            ? destination({
                to: '/d/$database/indexes/$schema',
                params: { database, schema },
                search: {},
              })
            : null
        case 'flows':
          return destination({ to: '/flow' })
        case 'help':
          return destination({ to: '/help' })
        case 'settings':
          return destination({ to: '/settings' })
      }
    },
    [database, destination, schema],
  )

  // ── What each page offers ────────────────────────────────────────────────
  const tablesQuery = useQuery({
    queryKey: ['introspect', database, schema],
    queryFn: () => $introspect({ data: { database: database!, schema } }),
    staleTime: Infinity,
    // The root needs it as well: a typed table name is answered there, and the
    // key is the sidebar's, so this is usually a cache hit rather than a read.
    enabled:
      open &&
      connected &&
      (view.kind === 'tables' ||
        view.kind === 'columns' ||
        view.kind === 'actions' ||
        view.kind === 'filter') &&
      !!database,
  })

  const ownersQuery = useQuery({
    queryKey: ['findValueOwners', database, schema, submitted],
    queryFn: () =>
      $findValueOwners({ data: { database: database!, schema, value: submitted! } }),
    staleTime: 60_000,
    enabled:
      open && connected && view.kind === 'find' && !!database && (submitted ?? '').length > 0,
  })

  const reachQuery = useQuery({
    queryKey: [
      'findValueReach',
      database,
      schema,
      view.kind === 'reach' ? view.value : null,
      view.kind === 'reach' ? view.owner : null,
    ],
    queryFn: () =>
      $findValueReach({
        data: {
          database: database!,
          schema,
          value: view.kind === 'reach' ? view.value : '',
          owner: view.kind === 'reach' ? view.owner : '',
        },
      }),
    staleTime: 60_000,
    enabled: open && connected && view.kind === 'reach' && !!database,
  })

  /**
   * One column of a table, as a row that starts a filter on it.
   *
   * Shared by the *Filter* page and the root: typing a column name on the root
   * reaches the filter directly, so the common case — you know which column you
   * want to narrow by — costs one page instead of two.
   */
  const filterRow = useCallback(
    (tableName: string, column: ColumnInfo): PaletteRowModel => {
      const to =
        database && schema
          ? destination({
              to: '/d/$database/t/$schema/$table',
              params: { database, schema, table: tableName },
              search: { fp: true, fc: column.name },
            })
          : null
      return {
        id: `filter:${tableName}.${column.name}`,
        title: column.name,
        table: tableName,
        column: column.name,
        hint: `${defaultOpForType(column.dataType)} — ${operatorsForType(column.dataType).length} operators${column.isNullable ? ', nullable' : ''}`,
        meta: column.dataType,
        group: 'Filter by column',
        href: to?.href,
        run: () => {
          close()
          to?.go()
        },
      }
    },
    [close, database, destination, schema],
  )

  /** The columns of whichever table is on screen, for both pages that offer them. */
  const columnsOf = useCallback(
    (tableName: string | undefined): ColumnInfo[] =>
      tableName
        ? (tablesQuery.data?.tables.find((t) => t.name === tableName)?.columns ?? [])
        : [],
    [tablesQuery.data],
  )

  /** Every column in the schema, for column hits. Introspection only — the
   *  palette offers where a column is, not what the catalog says about it. */
  const columnEntries = useMemo(
    () =>
      tablesQuery.data ? buildColumnEntries(tablesQuery.data.tables, undefined, undefined) : [],
    [tablesQuery.data],
  )

  /**
   * One column somewhere in the schema, as a row: `↵` opens its table, `⇥` opens
   * it filtered to rows where the column is set — "show me the rows that use it"
   * is the usual next question once you've found which table has it.
   */
  const columnRow = useCallback(
    (entry: ColumnEntry): PaletteRowModel => {
      const open =
        database && schema
          ? destination({
              to: '/d/$database/t/$schema/$table',
              params: { database, schema, table: entry.table },
              search: {},
            })
          : null
      const set =
        database && schema
          ? destination({
              to: '/d/$database/t/$schema/$table',
              params: { database, schema, table: entry.table },
              search: {
                q: encodeConditions([
                  { id: `palette-${entry.column}`, column: entry.column, op: 'notNull', values: [] },
                ]),
              },
            })
          : null
      return {
        id: `column:${entry.table}.${entry.column}`,
        title: `${nameOf(entry.table)}.${entry.column}`,
        table: entry.table,
        column: entry.column,
        meta: entry.dataType,
        group: 'Columns',
        href: open?.href,
        run: () => {
          close()
          open?.go()
        },
        runAlt: () => {
          close()
          set?.go()
        },
        altLabel: 'where set',
      }
    },
    [close, database, destination, nameOf, schema],
  )

  /** The last row of any column list: the same query on the survey page. */
  const allColumnsRow = useCallback(
    (count: number, typed: string): PaletteRowModel | null => {
      if (!database || !schema || count === 0) return null
      const name = typed.trim()
      const to = destination({
        to: '/d/$database/columns/$schema',
        params: { database, schema },
        search: name ? { name } : {},
      })
      return {
        id: 'columns:all',
        title: `All ${count.toLocaleString('en-US')} matching columns →`,
        hint: 'With type, references, index and statistics',
        group: 'Columns',
        href: to.href,
        run: () => {
          close()
          to.go()
        },
      }
    },
    [close, database, destination, schema],
  )


  const rows = useMemo<PaletteRowModel[]>(() => {
    switch (view.kind) {
      case 'actions': {
        const commands = rootRows({ database, schema, table: activeTable }, query).map((action) => {
          const to =
            action.target.kind === 'route' ? routeDestination(action.target.route) : null
          return {
            id: action.id,
            title: action.title,
            hint: action.hint,
            group: action.group,
            href: to?.href,
            run: () => {
              const target = action.target
              if (target.kind === 'route') {
                close()
                to?.go()
                return
              }
              setSubmitted(target.query ?? null)
              setStack((previous) => push(previous, target.view, target.query ?? ''))
            },
          }
        })

        // A typed table name beats every command: it is the more specific thing
        // to have meant, and the matcher only offers a name it is sure of.
        const tables = confidentTableMatches(
          (tablesQuery.data?.tables ?? []).map((table) => ({
            name: table.name,
            model: models[table.name] ?? null,
            rowCount: table.rowCount,
          })),
          query,
        ).map((table) => {
          const to =
            database && schema
              ? destination({
                  to: '/d/$database/t/$schema/$table',
                  params: { database, schema, table: table.name },
                  search: {},
                })
              : null
          return {
            id: `open:${table.name}`,
            title: nameOf(table.name),
            table: table.name,
            meta:
              table.rowCount === null || table.rowCount === undefined
                ? undefined
                : `~${table.rowCount.toLocaleString('en-US')}`,
            group: 'Tables',
            href: to?.href,
            run: () => {
              close()
              to?.go()
            },
          }
        })

        // A column of the table being read, matched the same way a table name
        // is — `urlname` finds `url_name` — so narrowing the rows on screen is
        // reachable from what you type rather than only from the Filter page.
        const columns = activeTable
          ? confidentTableMatches(columnsOf(activeTable), query, 4).map((column) =>
              filterRow(activeTable, column),
            )
          : []

        // Columns anywhere in the schema — the same gate a table name passes —
        // minus the table on screen, whose columns are already offered above as
        // filters.
        const elsewhere = confidentColumnMatches(columnEntries, query, {
          excludeTable: activeTable,
        }).map(columnRow)
        const allHits =
          elsewhere.length > 0 ? searchColumns(columnEntries, { name: query }).length : 0
        const more = allHits > elsewhere.length ? allColumnsRow(allHits, query) : null

        const pasted = commands.filter((row) => row.id.startsWith('paste:'))
        const rest = commands.filter((row) => !row.id.startsWith('paste:'))
        return [...pasted, ...tables, ...columns, ...elsewhere, ...(more ? [more] : []), ...rest]
      }

      case 'tables': {
        const tables = tablesQuery.data?.tables ?? []
        const matched =
          query.trim().length === 0
            ? tables
            : fuzzySearch(tables, query, (table) => table.name).map((hit) => hit.item)
        return matched.slice(0, 60).map((table) => {
          const to =
            database && schema
              ? destination({
                  to: '/d/$database/t/$schema/$table',
                  params: { database, schema, table: table.name },
                  search: {},
                })
              : null
          return {
            id: `table:${table.name}`,
            title: nameOf(table.name),
            table: table.name,
            meta:
              table.rowCount === null
                ? undefined
                : `~${table.rowCount.toLocaleString('en-US')}`,
            group: 'Tables',
            href: to?.href,
            run: () => {
              close()
              to?.go()
            },
          }
        })
      }

      case 'columns': {
        const matched =
          query.trim().length === 0 ? columnEntries : searchColumns(columnEntries, { name: query })
        const shown = matched.slice(0, 60).map(columnRow)
        const all = matched.length > 60 ? allColumnsRow(matched.length, query) : null
        return all ? [...shown, all] : shown
      }

      case 'find': {
        const owners = ownersQuery.data
        if (!owners) return []
        if (owners.gateReason !== null) {
          // The gate's candidate list is the page: picking one is the answer the
          // shape could not give.
          const candidates =
            query.trim().length === 0
              ? owners.candidates
              : fuzzySearch(owners.candidates, query, (candidate) => candidate.table).map(
                  (hit) => hit.item,
                )
          return candidates.slice(0, 60).map((candidate) => {
            const to =
              database && schema
                ? destination({
                    to: '/d/$database/t/$schema/$table/row/$id',
                    params: {
                      database,
                      schema,
                      table: candidate.table,
                      id: owners.value,
                    },
                  })
                : null
            return {
              id: `candidate:${candidate.table}`,
              title: nameOf(candidate.table),
              table: candidate.table,
              hint: `${candidate.pkColumn} ${candidate.pkType}`,
              meta: `~${candidate.rowCount.toLocaleString('en-US')}`,
              group: 'Which table is it from?',
              href: to?.href,
              run: () => {
                close()
                to?.go()
              },
              runAlt: () =>
                setStack((previous) =>
                  push(previous, {
                    kind: 'reach',
                    value: owners.value,
                    owner: candidate.table,
                  }),
                ),
              altLabel: 'where else',
            }
          })
        }
        return owners.owners.map((owner) => {
          const to =
            database && schema
              ? destination({
                  to: '/d/$database/t/$schema/$table/row/$id',
                  params: { database, schema, table: owner.table, id: owners.value },
                })
              : null
          return {
            id: `owner:${owner.table}`,
            title: nameOf(owner.table),
            table: owner.table,
            hint: `${owner.pkColumn} ${owner.pkType} — the row itself; ⇥ for where else it appears`,
            meta: `~${owner.rowCount.toLocaleString('en-US')}`,
            group: 'Owner',
            href: to?.href,
            // The row itself is what someone pasting an id came for; the
            // reference list is the follow-up question, one key further.
            run: () => {
              close()
              to?.go()
            },
            runAlt: () =>
              setStack((previous) =>
                push(previous, { kind: 'reach', value: owners.value, owner: owner.table }),
              ),
            altLabel: 'where else',
          }
        })
      }

      case 'filter': {
        const columns = columnsOf(view.table)
        const matched =
          query.trim().length === 0
            ? columns
            : fuzzySearch(columns, query, (column) => `${column.name} ${column.dataType}`).map(
                (hit) => hit.item,
              )
        return matched.slice(0, 60).map((column) => filterRow(view.table, column))
      }

      case 'reach': {
        const reach = reachQuery.data
        if (!reach) return []
        const matched =
          query.trim().length === 0
            ? reach.entries
            : fuzzySearch(
                reach.entries,
                query,
                (item) => `${item.fromTable} ${item.fromColumn}`,
              ).map((hit) => hit.item)
        const hits = matched.filter((item) => (item.total ?? 0) > 0)
        const zero = matched.filter((item) => item.total === 0)
        const unknown = matched.filter((item) => item.total === null)
        return [...hits, ...zero, ...unknown].map((item) => {
          const to =
            database && schema
              ? destination({
                  to: '/d/$database/t/$schema/$table',
                  params: { database, schema, table: item.fromTable },
                  search: reachTableSearch(item.fromColumn, reach.value),
                })
              : null
          return ({
          id: `reach:${item.fromTable}.${item.fromColumn}`,
          title: `${nameOf(item.fromTable)}.${item.fromColumn}`,
          table: item.fromTable,
          column: item.fromColumn,
          hint:
            item.total === null
              ? item.countSkipped === 'timeout'
                ? 'Not counted — the count ran out of time. Open the rows to ask again.'
                : item.countSkipped
                  ? `Not counted — ${skipExplanation(item.countSkipped as ReachSkip)}`
                  : 'Not counted.'
              : `${item.basis} · of ~${item.rowCount.toLocaleString('en-US')} rows`,
          meta:
            item.total === null
              ? 'not counted'
              : `${item.total.toLocaleString('en-US')} ${item.total === 1 ? 'row' : 'rows'}`,
          muted: (item.total ?? 0) === 0,
          group: item.group,
          href: to?.href,
          run: () => {
            close()
            to?.go()
          },
          })
        })
      }
    }
  }, [
    close,
    database,
    destination,
    routeDestination,
    navigate,
    ownersQuery.data,
    query,
    reachQuery.data,
    models,
    nameOf,
    schema,
    tablesQuery.data,
    activeTable,
    columnsOf,
    filterRow,
    columnEntries,
    columnRow,
    allColumnsRow,
    view,
  ])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault()
      setSelected((index) => moveSelection(index, rows.length, 1))
      return
    }
    if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault()
      setSelected((index) => moveSelection(index, rows.length, -1))
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (canPop(stack)) setStack(pop(stack))
      else close()
      return
    }
    if (event.key === 'Backspace' && query.length === 0 && canPop(stack)) {
      event.preventDefault()
      setStack(pop(stack))
      return
    }
    if (event.key === 'Tab') {
      // Forward and back through the palette's own pages. `⌘` is spoken for by
      // the browser (new tab), so the follow-up question gets its own key.
      event.preventDefault()
      if (event.shiftKey) {
        if (canPop(stack)) setStack(pop(stack))
        return
      }
      rows[selected]?.runAlt?.()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      // On Find, Enter first means "go and ask"; only once the answer is in does
      // it mean "open the row I have selected".
      if (viewSubmits(view) && submitted !== query) {
        setSubmitted(query)
        return
      }
      const row = rows[selected]
      if (!row) return
      // `⌘↵` on a row that goes somewhere means what it means everywhere else:
      // open it in a new tab, and leave this one where it is.
      if (row.href && opensNewTab(event)) {
        window.open(row.href, '_blank', 'noopener')
        return
      }
      row.run()
    }
  }

  if (!open) return null

  const platform = typeof navigator === 'undefined' ? '' : navigator.platform
  const owners = ownersQuery.data
  const status =
    view.kind === 'find' && ownersQuery.isFetching
      ? 'asking every candidate key…'
      : view.kind === 'reach' && reachQuery.isFetching
        ? 'counting…'
        : view.kind === 'find' && owners && owners.gateReason === null
          ? `${owners.owners.length} of ${owners.probed} keys hold it`
          : view.kind === 'reach' && reachQuery.data
            ? `${reachQuery.data.entries.length} columns reference it`
            : undefined

  return (
    <PaletteFrame
      breadcrumb={breadcrumbOf(stack)}
      placeholder={viewPlaceholder(view)}
      query={query}
      onQuery={(next) => setStack((previous) => setQuery(previous, next))}
      onKeyDown={onKeyDown}
      onClose={close}
      status={status}
      footer={
        <>
          <KeyHint keys="↑↓" label="select" />
          <KeyHint
            keys="↵"
            label={viewSubmits(view) && submitted !== query ? 'search' : 'open'}
          />
          {rows[selected]?.href && <KeyHint keys="⌘↵" label="new tab" />}
          {rows[selected]?.altLabel && (
            <KeyHint keys="⇥" label={rows[selected].altLabel!} />
          )}
          <KeyHint keys="esc" label={canPop(stack) ? 'back' : 'close'} />
          <span className="ml-auto flex items-center gap-2">
            <KeyHint keys={findHotkeyLabel(platform)} label="toggle" />
            <span className="opacity-70">or {findHotkeyAltLabel(platform)}</span>
          </span>
        </>
      }
    >
      <PaletteList
        rows={rows}
        selected={selected}
        onSelect={setSelected}
        empty={<EmptyFor
          viewKind={view.kind}
          hasQuery={query.trim().length > 0}
          submitted={submitted}
          searching={ownersQuery.isFetching || reachQuery.isFetching}
          error={(ownersQuery.error ?? reachQuery.error) as Error | null}
        />}
      />
    </PaletteFrame>
  )
}

/** What an empty list says. Never "no results" alone: the reason is the content. */
function EmptyFor({
  viewKind,
  hasQuery,
  submitted,
  searching,
  error,
}: {
  viewKind: string
  hasQuery: boolean
  submitted: string | null
  searching: boolean
  error: Error | null
}) {
  if (error) return <span className="text-[var(--destructive)]">{error.message}</span>
  if (searching) return <>Asking the database…</>
  if (viewKind === 'find') {
    if (submitted === null) {
      return (
        <>
          Paste an id and press <kbd>↵</kbd>. A uuid or a long token can be searched on
          its own; a bare integer is a key in nearly every table, so Find will ask
          which one you meant.
        </>
      )
    }
    return (
      <>
        No primary key in this schema holds <code className="font-mono">{submitted}</code>.
        It may be a non-key column, or an id from another database.
      </>
    )
  }
  if (viewKind === 'reach') return <>Nothing references this table on any basis.</>
  if (viewKind === 'filter') {
    return hasQuery ? <>No column matches.</> : <>This table has no columns to filter on.</>
  }
  return hasQuery ? <>Nothing matches.</> : <>Nothing here.</>
}
