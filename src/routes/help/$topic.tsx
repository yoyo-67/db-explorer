import { Link, createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import CopyButton from '#/components/CopyButton'
import { HighlightProvider } from '#/components/help/highlight'
import SqlWalkthrough, { renderInlineCode } from '#/components/help/SqlWalkthrough'
import { HELP_PREVIEWS } from '#/components/help/previews'
import { findHelpTopic } from '#/lib/help'
import { topicSql } from '#/lib/help/types'
import { stageConsoleSql } from '#/lib/console-handoff'
import { $resolveEntryTarget } from '#/server/api'
import type { HelpTopic } from '#/lib/help/types'

/**
 * One page of the app, explained. The order is fixed on purpose: see it, read
 * what it answers, then read the SQL — a statement means very little before you
 * know which screen it drew.
 */
export const Route = createFileRoute('/help/$topic')({
  loader: ({ params }) => {
    const topic = findHelpTopic(params.topic)
    if (!topic) throw notFound()
    return { topic }
  },
  component: HelpTopicPage,
  notFoundComponent: UnknownTopic,
})

/** A help URL naming a topic that does not exist — usually an old link, since
 *  topic ids outlive the pages they document. Say so and point at the contents
 *  rather than leaving a dead end. */
function UnknownTopic() {
  const { topic } = Route.useParams()
  return (
    <main className="px-4 pb-16 pt-10">
      <div className="mx-auto max-w-3xl space-y-3">
        <p className="island-kicker">Help</p>
        <h1 className="display-title text-2xl font-semibold text-[var(--sea-ink)]">
          No help topic called “{topic}”
        </h1>
        <p className="text-sm text-[var(--sea-ink-soft)]">
          It may have been renamed, or never existed. The contents page lists every
          topic there is.
        </p>
        <Link to="/help" className="island-kicker hover:underline">
          ← All topics
        </Link>
      </div>
    </main>
  )
}

function HelpTopicPage() {
  const { topic } = Route.useLoaderData()
  const Preview = HELP_PREVIEWS[topic.id] ?? null
  const sql = topicSql(topic)
  const navigate = useNavigate()

  /**
   * Help is about the app, not about one database — so the console it hands the
   * SQL to is the session's own. Asked at click time rather than remembered: the
   * answer is only needed if someone actually opens it.
   */
  const openInConsole = async () => {
    const handoff = stageConsoleSql(sql)
    const target = await $resolveEntryTarget()
    if (target.ok && target.database) {
      void navigate({
        to: '/d/$database/console',
        params: { database: target.database },
        search: handoff ? { handoff } : {},
      })
      return
    }
    void navigate({ to: '/' })
  }

  return (
    <HighlightProvider>
      <main className="px-4 pb-16 pt-6">
        <div className="mx-auto max-w-5xl space-y-8">
          <header className="space-y-2">
            <Link to="/help" className="island-kicker hover:underline">
              ← Help
            </Link>
            <h1 className="display-title text-2xl font-semibold text-[var(--sea-ink)]">
              {topic.question}
            </h1>
            <p className="max-w-3xl text-sm leading-relaxed text-[var(--sea-ink-soft)]">
              {renderInlineCode(topic.answer)}
            </p>
            <p className="font-mono text-[11px] text-[var(--lagoon-deep)]">
              {topic.title} · {topic.route}
            </p>
          </header>

          {Preview && (
            <section className="space-y-2">
              <SectionTitle>What you are looking at</SectionTitle>
              <div className="island-shell overflow-x-auto rounded-2xl p-4">
                <Preview />
              </div>
              <p className="text-[12px] text-[var(--sea-ink-soft)]">
                {topic.previewCaption} A sketch, not live data.
              </p>
            </section>
          )}

          {topic.prerequisite && (
            <section className="rounded-2xl border border-[var(--chip-line)] bg-[var(--chip-bg)] p-4">
              <p className="island-kicker">Before it can run</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--sea-ink-soft)]">
                {renderInlineCode(topic.prerequisite)}
              </p>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle>The SQL behind it</SectionTitle>
              <div className="ml-auto flex items-center gap-2">
                <CopyButton text={sql} label="Copy SQL" />
                <button
                  type="button"
                  onClick={() => void openInConsole()}
                  className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)]"
                >
                  Open in Console
                </button>
              </div>
            </div>
            <SqlWalkthrough steps={topic.steps} />
            <p className="text-[12px] text-[var(--sea-ink-soft)]">
              Written out in full: every table is aliased with a readable name and
              every column comes back under an explicit <code>AS</code>. The app
              sends the same statement with the short aliases the catalog
              documentation uses — same tables, same columns, same plan.
            </p>
          </section>

          <section className="space-y-2">
            <SectionTitle>What it costs</SectionTitle>
            <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--sea-ink-soft)]">
              {renderInlineCode(topic.cost)}
            </p>
          </section>

          <Glossary topic={topic} />

          <p className="font-mono text-[11px] text-[var(--sea-ink-soft)]">
            Source: {topic.source.file}:{topic.source.line}
          </p>
        </div>
      </main>
    </HighlightProvider>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="island-kicker">{children}</h2>
}

function Glossary({ topic }: { topic: HelpTopic }) {
  if (topic.terms.length === 0) return null
  return (
    <section className="space-y-2">
      <SectionTitle>Words used above</SectionTitle>
      <dl className="grid gap-3 sm:grid-cols-2">
        {topic.terms.map((term) => (
          <div
            key={term.term}
            className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-3"
          >
            <dt className="font-mono text-[12px] font-semibold text-[var(--sea-ink)]">
              {term.term}
            </dt>
            <dd className="mt-1 text-[12.5px] leading-relaxed text-[var(--sea-ink-soft)]">
              {renderInlineCode(term.meaning)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
