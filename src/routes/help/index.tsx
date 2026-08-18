import { Link, createFileRoute } from '@tanstack/react-router'
import { HELP_TOPICS } from '#/lib/help'
import type { HelpTopic } from '#/lib/help/types'

/**
 * The table of contents. One line per topic, grouped by section, in the order
 * the registry lists them — a contents page earns its place by being scannable,
 * so the prose stays on the topic pages and this stays a list.
 *
 * No connection guard: help is the one part of the app that has to work before
 * you have a database to point it at.
 */
export const Route = createFileRoute('/help/')({
  component: HelpIndexPage,
})

/** Sections in registry order, each holding its topics in registry order. */
function bySection(topics: HelpTopic[]): Array<[string, HelpTopic[]]> {
  const sections = new Map<string, HelpTopic[]>()
  for (const topic of topics) {
    const list = sections.get(topic.section)
    if (list) list.push(topic)
    else sections.set(topic.section, [topic])
  }
  return [...sections.entries()]
}

function HelpIndexPage() {
  const sections = bySection(HELP_TOPICS)
  let counter = 0

  return (
    <main className="px-4 pb-16 pt-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-2">
          <p className="island-kicker">Help · contents</p>
          <h1 className="display-title text-2xl font-semibold text-[var(--sea-ink)]">
            What this app asks your database
          </h1>
          <p className="text-sm leading-relaxed text-[var(--sea-ink-soft)]">
            One page per screen. Each writes out the SQL that screen fires and reads
            it back a clause at a time — what it fetches, why it is filtered that
            way, what it costs to run. No Postgres background assumed.
          </p>
        </header>

        {sections.map(([section, topics]) => (
          <section key={section} className="space-y-1">
            <h2 className="island-kicker border-b border-[var(--line)] pb-1">
              {section}
            </h2>
            <ul>
              {topics.map((topic) => {
                counter += 1
                return (
                  <li key={topic.id}>
                    <Link
                      to="/help/$topic"
                      params={{ topic: topic.id }}
                      className="group flex items-baseline gap-3 rounded-lg px-2 py-2.5 hover:bg-[rgba(79,184,178,0.1)]"
                    >
                      <span className="font-mono text-[11px] text-[var(--lagoon-deep)]">
                        {String(counter).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold text-[var(--sea-ink)] group-hover:underline">
                          {topic.title}
                        </span>
                        <span className="block text-[12.5px] text-[var(--sea-ink-soft)]">
                          {topic.question}
                        </span>
                      </span>
                      <span className="hidden shrink-0 font-mono text-[11px] text-[var(--sea-ink-soft)] sm:block">
                        {topic.route} · {topic.steps.length} clauses
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  )
}
