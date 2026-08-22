import { Marked } from '#/components/help/highlight'

/** Slim stand-in for `/indexes/$schema`: the rail on the left, one index argued
 *  on the right. Each marked piece is the figure its clause fetched. */

const RAIL = [
  { name: 'orders_customer_created_idx', table: 'data_order', size: '412 MB', rate: '1.2k/d' },
  { name: 'orders_status_idx', table: 'data_order', size: '88 MB', rate: '0/d' },
  { name: 'orders_pkey', table: 'data_order', size: '40 MB', rate: '33k/d' },
]

export default function IndexUsagePreview() {
  return (
    <div className="space-y-2 text-[11px] leading-tight text-[var(--sea-ink)]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="island-kicker">Indexes</span>
        <span className="text-[var(--sea-ink-soft)]">
          <Marked step="scope">public</Marked> · 214 indexes
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <ul className="space-y-1 border-r border-[var(--line)] pr-2 font-mono text-[10px]">
          {RAIL.map((row) => (
            <li key={row.name} className="truncate">
              <Marked step="select-shape">{row.name}</Marked>
              <span className="block text-[var(--sea-ink-soft)]">
                <Marked step="joins">{row.table}</Marked> ·{' '}
                <Marked step="counters">{row.size}</Marked>
              </span>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5">
          <p className="font-mono text-[10.5px]">
            <Marked step="select-shape">orders_customer_created_idx</Marked>{' '}
            <span className="text-[var(--sea-ink-soft)]">
              (<Marked step="key-columns">customer_id, created_at</Marked>{' '}
              <Marked step="order-flags">DESC</Marked>)
            </span>
          </p>
          <p className="text-[var(--sea-ink-soft)]">
            <Marked step="flags">unique · enforces a constraint</Marked>
          </p>
          <dl className="grid grid-cols-3 gap-x-2 text-[10px]">
            <div>
              <dt className="uppercase tracking-wide text-[var(--sea-ink-soft)]">scans</dt>
              <dd className="tabular-nums">
                <Marked step="counters">2,701</Marked>
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-[var(--sea-ink-soft)]">per scan</dt>
              <dd className="tabular-nums">
                <Marked step="counters">1.2</Marked>
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-[var(--sea-ink-soft)]">heap</dt>
              <dd className="tabular-nums">
                <Marked step="counters">59%</Marked>
              </dd>
            </div>
          </dl>
          <p className="text-[var(--sea-ink-soft)]">
            <Marked step="order-flags">
              satisfies ORDER BY customer_id, created_at DESC
            </Marked>
          </p>
        </div>
      </div>
    </div>
  )
}
