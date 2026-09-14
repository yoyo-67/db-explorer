import { useEffect, useState } from 'react'

interface PagerProps {
  page: number
  pageSize: number
  count: number
  totalPages: number
  isCountApproximate: boolean
  onPageChange: (page: number) => void
  onRequestExactCount?: () => void
  isExactLoading?: boolean
  /** The sizes offered as buttons. Absent means the size is not the reader's
   *  to choose on this page, and no buttons are drawn. */
  pageSizeOptions?: readonly number[]
  onPageSizeChange?: (pageSize: number) => void
}

export default function Pager({
  page,
  pageSize,
  count,
  totalPages,
  isCountApproximate,
  onPageChange,
  onRequestExactCount,
  isExactLoading = false,
  pageSizeOptions,
  onPageSizeChange,
}: PagerProps) {
  const [draft, setDraft] = useState(String(page))
  // The page can move without this box being what moved it — changing the page
  // size re-anchors it — so the box follows the page rather than only leading it.
  useEffect(() => setDraft(String(page)), [page])
  const start = count === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(count, page * pageSize)
  const prefix = isCountApproximate ? '≈ ' : ''

  const goto = (next: number) => {
    const clamped = Math.max(1, Math.min(totalPages, Math.floor(next)))
    setDraft(String(clamped))
    if (clamped !== page) onPageChange(clamped)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--sea-ink-soft)]">
      <span>
        {start.toLocaleString()}–{end.toLocaleString()} of {prefix}
        {count.toLocaleString()}
      </span>
      {pageSizeOptions && onPageSizeChange && (
        <div className="flex items-center gap-1" role="group" aria-label="Rows per page">
          <span className="text-[10px] uppercase tracking-wide opacity-70">rows</span>
          {pageSizeOptions.map((size) => {
            const active = size === pageSize
            return (
              <button
                key={size}
                type="button"
                onClick={() => onPageSizeChange(size)}
                aria-pressed={active}
                title={`${size} rows per page`}
                className={
                  active
                    ? 'rounded border border-[var(--lagoon-deep)] bg-[rgba(79,184,178,0.15)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--lagoon-deep)]'
                    : 'rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] tabular-nums hover:bg-[var(--surface-strong)]'
                }
              >
                {size}
              </button>
            )
          })}
        </div>
      )}

      {isCountApproximate && onRequestExactCount && (
        <button
          type="button"
          onClick={onRequestExactCount}
          disabled={isExactLoading}
          className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)] disabled:opacity-50"
        >
          {isExactLoading ? '...' : 'Exact'}
        </button>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => goto(1)}
          disabled={page <= 1}
          className="rounded border border-[var(--line)] px-2 py-0.5 hover:bg-[var(--surface-strong)] disabled:opacity-30"
          title="First"
        >
          «
        </button>
        <button
          type="button"
          onClick={() => goto(page - 1)}
          disabled={page <= 1}
          className="rounded border border-[var(--line)] px-2 py-0.5 hover:bg-[var(--surface-strong)] disabled:opacity-30"
          title="Previous"
        >
          ‹
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(draft)
            if (!Number.isNaN(n)) goto(n)
          }}
          className="flex items-center gap-1"
        >
          <input
            type="number"
            min={1}
            max={totalPages}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) goto(n)
            }}
            className="w-12 rounded border border-[var(--line)] bg-[var(--surface-strong)] px-1 py-0.5 text-center tabular-nums outline-none"
          />
          <span>/ {totalPages.toLocaleString()}</span>
        </form>
        <button
          type="button"
          onClick={() => goto(page + 1)}
          disabled={page >= totalPages}
          className="rounded border border-[var(--line)] px-2 py-0.5 hover:bg-[var(--surface-strong)] disabled:opacity-30"
          title="Next"
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => goto(totalPages)}
          disabled={page >= totalPages}
          className="rounded border border-[var(--line)] px-2 py-0.5 hover:bg-[var(--surface-strong)] disabled:opacity-30"
          title="Last"
        >
          »
        </button>
      </div>
    </div>
  )
}
