import type { ColumnSearch, IndexFilter, RefFilter } from '#/lib/column-search'

/**
 * The survey's controls. Every one writes to the URL through `onChange`, so the
 * page holds no filter state of its own.
 */
export default function ColumnFilters({
  search,
  types,
  onChange,
}: {
  search: ColumnSearch
  /** Types present in the schema, for the chips. */
  types: string[]
  onChange: (next: ColumnSearch) => void
}) {
  const selected = new Set(search.type ?? [])
  const toggleType = (type: string) => {
    const next = new Set(selected)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    onChange({ ...search, type: next.size > 0 ? [...next] : undefined })
  }

  return (
    <div className="space-y-2">
      <input
        type="search"
        autoFocus
        value={search.name ?? ''}
        onChange={(e) => onChange({ ...search, name: e.target.value || undefined })}
        placeholder="Column name…"
        className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
      />

      <div className="flex flex-wrap gap-1">
        {types.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={selected.has(type)}
            onClick={() => toggleType(type)}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition ${
              selected.has(type)
                ? 'border-[var(--lagoon)] text-[var(--lagoon-deep)]'
                : 'border-[var(--line)] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)]/60'
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--sea-ink-soft)]">
        <label className="flex items-center gap-1">
          References
          <select
            value={search.ref ?? ''}
            onChange={(e) =>
              onChange({ ...search, ref: (e.target.value || undefined) as RefFilter | undefined })
            }
            className="rounded border border-[var(--line)] bg-transparent px-1 py-0.5"
          >
            <option value="">—</option>
            <option value="any">any</option>
            <option value="none">none</option>
            <option value="declared">declared FK</option>
            <option value="model">model</option>
            <option value="convention">convention</option>
            <option value="catalog">catalog</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          Indexed
          <select
            value={search.indexed ?? ''}
            onChange={(e) =>
              onChange({
                ...search,
                indexed: (e.target.value || undefined) as IndexFilter | undefined,
              })
            }
            className="rounded border border-[var(--line)] bg-transparent px-1 py-0.5"
          >
            <option value="">—</option>
            <option value="lead">leads an index</option>
            <option value="any">in any index</option>
            <option value="none">in no index</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={search.nullable === true}
            onChange={(e) => onChange({ ...search, nullable: e.target.checked ? true : undefined })}
          />
          nullable only
        </label>
      </div>
    </div>
  )
}
