import { Link, createFileRoute } from '@tanstack/react-router'
import { $listFlows } from '#/server/api'
import { describeCapture } from '#/lib/flow-doc'

/**
 * What flows are on disk.
 *
 * Newest capture first, and a file that no longer parses is listed with its
 * first error rather than skipped — this page is the only place anyone finds out
 * that a doc has gone bad, and a listing that quietly dropped it would let it rot.
 */
export const Route = createFileRoute('/flow/')({
  loader: () => $listFlows(),
  component: FlowIndexPage,
})

function FlowIndexPage() {
  const flows = Route.useLoaderData()
  const now = new Date()

  return (
    <main className="px-4 pb-16 pt-6">
      <div className="flow-reading mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <p className="island-kicker">Flows</p>
          <h1 className="display-title text-2xl font-semibold text-[var(--sea-ink)]">
            Investigations somebody captured
          </h1>
          <p className="text-sm leading-relaxed text-[var(--sea-ink-soft)]">
            A flow doc is one walk through this database written down — the story, the queries with
            the rows they returned, and links to the tables and rows they came from. Captured, not
            live: every page says when it was taken.
          </p>
        </header>

        {flows.length === 0 ? (
          <div className="island-shell space-y-2 rounded-2xl p-5 text-sm text-[var(--sea-ink-soft)]">
            <p>No flow docs yet.</p>
            <p className="font-mono text-[12px]">
              node scripts/flow.mjs new order-lifecycle --title &quot;How an order becomes an
              invoice&quot;
            </p>
            <p>
              They are written to <code className="font-mono">local/flows/</code>, which this repo
              does not track — captured rows are real data.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {flows.map((flow) => {
              const age = describeCapture(flow.capturedAt, now)
              return (
                <li key={flow.slug}>
                  <Link
                    to="/flow/$slug"
                    params={{ slug: flow.slug }}
                    className="island-shell block space-y-1 rounded-2xl p-4 hover:bg-[rgba(79,184,178,0.06)]"
                  >
                    <p className="text-sm font-semibold text-[var(--sea-ink)]">
                      {flow.question ?? flow.title}
                    </p>
                    {flow.error ? (
                      <p className="font-mono text-[11px] text-rose-500">{flow.error}</p>
                    ) : (
                      <>
                        {flow.question && (
                          <p className="text-[12px] text-[var(--sea-ink-soft)]">{flow.title}</p>
                        )}
                        <p className="font-mono text-[10px] text-[var(--sea-ink-soft)]">
                          {[
                            flow.slug,
                            `${flow.blocks} ${flow.blocks === 1 ? 'block' : 'blocks'}`,
                            age?.label,
                            flow.tables.slice(0, 3).join(', '),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}
