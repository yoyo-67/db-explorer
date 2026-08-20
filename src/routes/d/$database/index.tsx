import { createFileRoute, redirect } from '@tanstack/react-router'
import { $resolveEntryTarget } from '#/server/api'

/**
 * A database's own front door: `/d/<database>` lands on the first table worth
 * showing in it.
 *
 * It exists so that "go to this database" is a URL rather than an action. The
 * picker in the header, a link someone pastes into chat, and a bookmark all say
 * the same thing, and none of them has to know which tables the database holds.
 */
export const Route = createFileRoute('/d/$database/')({
  loader: async ({ params }) => {
    const target = await $resolveEntryTarget({ data: { database: params.database } })
    if (target.ok) {
      throw redirect({
        to: '/d/$database/t/$schema/$table',
        params: { database: params.database, schema: target.schema, table: target.table },
      })
    }
    return { error: 'error' in target ? target.error : 'No readable table' }
  },
  component: DatabaseHome,
})

function DatabaseHome() {
  const { database } = Route.useParams()
  const { error } = Route.useLoaderData()
  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rounded-[2rem] px-6 py-10 sm:px-10">
        <p className="island-kicker mb-3">{database}</p>
        <h1 className="display-title mb-4 text-2xl font-bold text-[var(--sea-ink)]">
          Nothing to browse here
        </h1>
        <p className="max-w-2xl text-sm text-[var(--sea-ink-soft)]">
          {error === 'Not connected'
            ? 'This connection is not open. Connect first, then come back.'
            : `No schema in this database has a table this role may read (${error}).`}
        </p>
      </section>
    </main>
  )
}
