import { Link } from '@tanstack/react-router'
import TableLink from '#/components/TableLink'
import type { FindOwners } from '#/lib/types'

/**
 * Stage one's answer: the tables whose primary key holds this value.
 *
 * Usually one row. More than one means the same id is a key in several tables —
 * a shared sequence, a mirrored history table — which is a finding rather than
 * an ambiguity, so all of them are shown, smallest table first.
 */
export default function OwnerList({
  result,
  database,
  selected,
  onSelect,
}: {
  result: FindOwners
  database: string
  selected: string | null
  onSelect: (table: string) => void
}) {
  const { owners, probed, schema, value, timedOut } = result

  return (
    <section className="island-shell rounded-xl">
      <header className="border-b border-[var(--line)] px-4 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold text-[var(--sea-ink)]">Owner</h2>
          <span className="text-[11px] text-[var(--sea-ink-soft)]">
            {owners.length === 0
              ? `no key holds it — ${probed} asked`
              : `${owners.length} of ${probed} keys asked hold it`}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--sea-ink-soft)]">
          Every single-column primary key whose type could hold this value, asked
          through its own index. Multi-column keys are not asked — a value alone
          cannot address a row that needs two.
        </p>
      </header>
      <div className="space-y-1 px-4 py-3">
        {timedOut && (
          <p className="text-[11px] text-[var(--destructive)]">
            A batch of lookups ran out of time, so this list may be short.
          </p>
        )}
        {owners.length === 0 ? (
          <p className="text-[11px] text-[var(--sea-ink-soft)]">
            Nothing in {schema} has <code className="font-mono">{value}</code> as a
            primary key. It may be a non-key column — a reference to a row in
            another database, or an external id — which this page cannot reach from
            the value alone.
          </p>
        ) : (
          <ul className="space-y-1">
            {owners.map((owner) => {
              const active = owner.table === selected
              return (
                <li
                  key={owner.table}
                  className={`flex flex-wrap items-baseline gap-x-2 rounded-lg px-2 py-1 text-[11px] ${
                    active ? 'bg-[rgba(79,184,178,0.12)]' : ''
                  }`}
                >
                  <TableLink schema={schema} table={owner.table} />
                  <span className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
                    {owner.pkColumn} {owner.pkType}
                  </span>
                  <span className="tabular-nums text-[10px] text-[var(--sea-ink-soft)]">
                    ~{owner.rowCount.toLocaleString('en-US')} rows
                  </span>
                  <Link
                    to="/d/$database/t/$schema/$table/row/$id"
                    params={{ database, schema, table: owner.table, id: value }}
                    className="rounded-full border border-[var(--chip-line)] px-1.5 text-[10px] text-[var(--palm)] transition hover:bg-[var(--link-bg-hover)]"
                  >
                    open row
                  </Link>
                  {!active && (
                    <button
                      type="button"
                      onClick={() => onSelect(owner.table)}
                      className="cursor-pointer rounded-full border border-[var(--chip-line)] px-1.5 text-[10px] text-[var(--sea-ink-soft)] transition hover:text-[var(--sea-ink)]"
                    >
                      where else
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
