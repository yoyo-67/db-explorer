/**
 * A row of figures that belong together — read across, not down.
 *
 * Used where a panel needs to state four or five numbers before it says anything
 * about them, and a table of two columns would be four rows of mostly whitespace.
 */
export default function StatRow({
  stats,
}: {
  stats: Array<{ label: string; value: string; title?: string; muted?: boolean }>
}) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
            {stat.label}
          </dt>
          <dd
            title={stat.title}
            className={`font-mono text-xs ${
              stat.muted ? 'text-[var(--sea-ink-soft)]' : 'text-[var(--sea-ink)]'
            }`}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
