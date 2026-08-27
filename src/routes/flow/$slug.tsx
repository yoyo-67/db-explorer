import { Link, createFileRoute } from '@tanstack/react-router'
import FlowDocView from '#/components/flow/FlowDocView'
import { $getFlow, $resolveEntryTarget } from '#/server/api'

/**
 * One flow doc, from a URL.
 *
 *   /flow/order-lifecycle              local/flows/order-lifecycle.json
 *   /flow/x?file=notes/billing.json    a loose file, sandboxed to the repo
 *
 * Loaded on the server rather than fetched by the component: a flow doc is a
 * file, it is whole or it is broken, and there is no partial state worth
 * rendering a spinner for.
 *
 * The database is resolved here too, and this is the one part that touches a
 * connection. A doc naming its own database is believed; a doc that names none
 * borrows the session's, which is the usual case for a flow an agent just wrote
 * about the database you are already looking at. Neither is guessed further than
 * that — no database means the page renders with its references as text.
 */
export const Route = createFileRoute('/flow/$slug')({
  // Optional, and written so it is *absent* rather than `undefined` when unset:
  // a search key that always exists makes every link to this route have to pass
  // one, including the ones that just want the filed doc.
  validateSearch: (search: Record<string, unknown>): { file?: string } => {
    const file = typeof search.file === 'string' ? search.file.trim() : ''
    return file ? { file } : {}
  },
  loaderDeps: ({ search }) => ({ file: search.file }),
  loader: async ({ params, deps }) => {
    const load = await $getFlow({ data: { slug: params.slug, file: deps.file } })
    if (!load.ok) return { load, database: null }
    if (load.doc.scope.database) return { load, database: load.doc.scope.database }
    const target = await $resolveEntryTarget()
    return { load, database: target.ok ? (target.database ?? null) : null }
  },
  component: FlowPage,
})

function FlowPage() {
  const { load, database } = Route.useLoaderData()
  const { slug } = Route.useParams()

  if (!load.ok) return <FlowProblem slug={slug} error={load.error} errors={load.errors ?? []} />

  return <FlowDocView doc={load.doc} database={database} source={load.source} />
}

/**
 * A doc that is missing, or that does not parse.
 *
 * The parse errors are printed. The reader of a flow doc is usually whoever (or
 * whatever) wrote it, and `blocks[3]: query needs sql` is the entire fix — hiding
 * it behind "something went wrong" would turn a ten-second correction into a
 * hunt through a JSON file.
 */
function FlowProblem({
  slug,
  error,
  errors,
}: {
  slug: string
  error: string
  errors: string[]
}) {
  return (
    <main className="px-4 pb-16 pt-10">
      <div className="flow-reading mx-auto max-w-3xl space-y-4">
        <p className="island-kicker">Flow · {slug}</p>
        <h1 className="display-title text-2xl font-semibold text-[var(--sea-ink)]">{error}</h1>
        {errors.length > 0 && (
          <ul className="space-y-1 rounded-2xl border border-[var(--chip-line)] bg-[var(--chip-bg)] p-4 font-mono text-[12px] text-[var(--sea-ink-soft)]">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        <p className="text-sm text-[var(--sea-ink-soft)]">
          Flow docs live in <code className="font-mono">local/flows/</code>. Write one with{' '}
          <code className="font-mono">node scripts/flow.mjs new {slug}</code>, or check what is
          there already.
        </p>
        <Link to="/flow" className="island-kicker hover:underline">
          ← All flows
        </Link>
      </div>
    </main>
  )
}
