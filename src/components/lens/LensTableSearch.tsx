import { useNavigate, useRouter } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import FuzzyText from '#/components/FuzzyText'
import { useDatabaseParam } from '#/hooks/useDatabase'
import { opensNewTab } from '#/lib/link-click'
import { lensTargetForNode, searchLensTables } from '#/lib/lens-table-search'
import type { EdgeBasis, SchemaGraphNode } from '#/lib/types'

/**
 * Type a table, land on the Group that holds it.
 *
 * The lens reads Group-first, so the one question it cannot answer on its own is
 * "where does *this* table live" — with 19 Groups on the matrix, finding a table
 * means already knowing its Group. Picking a hit navigates to the Group ring with
 * `?focus=`, which is what makes the answer visible rather than merely correct.
 */
export default function LensTableSearch({
  schema,
  tables,
  damp,
  basis,
}: {
  schema: string
  tables: readonly SchemaGraphNode[]
  damp: string | undefined
  basis: EdgeBasis | undefined
}) {
  const database = useDatabaseParam()
  const navigate = useNavigate()
  const router = useRouter()
  const [query, setQuery] = useState('')
  /** Which hit Enter would open. Reset on every keystroke, because the list is. */
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const hits = useMemo(() => searchLensTables(tables, query), [tables, query])
  const open = hits.length > 0

  /** Where a hit lands, as a URL — so each row can be a real link. */
  function hrefFor(node: SchemaGraphNode): string {
    const target = lensTargetForNode(node)
    return target.kind === 'group'
      ? router.buildLocation({
          to: '/d/$database/lens/$schema/g/$group',
          params: { database, schema, group: target.group },
          search: { damp, basis, focus: node.name },
        }).href
      : router.buildLocation({
          to: '/d/$database/lens/$schema/t/$table',
          params: { database, schema, table: node.name },
          search: { damp, basis },
        }).href
  }

  function go(node: SchemaGraphNode) {
    const target = lensTargetForNode(node)
    setQuery('')
    inputRef.current?.blur()
    if (target.kind === 'group') {
      navigate({
        to: '/d/$database/lens/$schema/g/$group',
        params: { database, schema, group: target.group },
        search: { damp, basis, focus: node.name },
      })
    } else {
      navigate({
        to: '/d/$database/lens/$schema/t/$table',
        params: { database, schema, table: node.name },
        search: { damp, basis },
      })
    }
  }

  return (
    <div className="relative w-full max-w-[280px]">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery('')
            inputRef.current?.blur()
            return
          }
          if (!open) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => (i + 1) % hits.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => (i - 1 + hits.length) % hits.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const hit = hits[Math.min(active, hits.length - 1)]
            if (hit) go(hit.node)
          }
        }}
        placeholder="Find a table in this lens..."
        aria-label="Find a table in this lens"
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-0.5 text-xs text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
      />

      {query.trim().length > 0 && hits.length === 0 && (
        <p className="absolute z-20 mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1.5 text-[11px] text-[var(--sea-ink-soft)] shadow-lg">
          No table in {schema} matches.
        </p>
      )}

      {open && (
        <ul
          className="absolute z-20 mt-1 max-h-[320px] w-[min(420px,80vw)] overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] py-0.5 shadow-lg"
          role="listbox"
        >
          {hits.map((hit, i) => (
            <li key={hit.node.name} role="option" aria-selected={i === active}>
              {/* A real link, so ctrl-click, middle-click and the context menu all
                  behave. Mouse-down, not click, for the plain pick: the input's
                  blur would otherwise tear the list down before a click ever
                  landed. A modified mouse-down is left alone so the anchor's own
                  click can open the tab — the list closes on the query, not on
                  blur, so it survives the focus move. */}
              <a
                href={hrefFor(hit.node)}
                onMouseDown={(e) => {
                  if (opensNewTab(e)) return
                  e.preventDefault()
                  go(hit.node)
                }}
                onClick={(e) => {
                  if (opensNewTab(e)) return
                  e.preventDefault()
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-baseline gap-2 px-2 py-1 text-[11px] no-underline ${
                  i === active ? 'bg-[var(--chip-bg)]' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[var(--sea-ink)]">
                  <FuzzyText text={hit.text} ranges={hit.ranges} />
                </span>
                <span className="shrink-0 rounded-full border border-[var(--chip-line)] px-1.5 text-[10px] text-[var(--sea-ink-soft)]">
                  {hit.node.group}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
