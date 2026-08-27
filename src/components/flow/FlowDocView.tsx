import FlowBlockView from '#/components/flow/FlowBlockView'
import FlowLink from '#/components/flow/FlowLink'
import FlowMarkdown from '#/components/flow/FlowMarkdown'
import { describeCapture, flowOutline, flowTables, formatTableRef, resolveSchema } from '#/lib/flow-doc'
import type { FlowBlockKind, FlowDoc } from '#/lib/flow-doc'

/**
 * A whole flow doc: what it answers, when it was captured, what it touched, and
 * then the blocks in the order they were written.
 *
 * The header exists to stop the page being read as live. A reader who arrives
 * from a chat window has no idea whether these rows are from this morning or
 * from March, and every judgement they make from the page depends on that — so
 * the age, the author and the database are said before any evidence is shown.
 *
 * The outline down the side is the other half: an investigation is long, and its
 * shape (three queries, then the rows they found, then the caveat) is the fastest
 * summary there is.
 */
/**
 * What each kind is called in the jump list. Spelled out rather than truncated:
 * `prose`.slice(0, 4) is `pros`, which reads as a typo.
 */
const OUTLINE_KIND: Record<FlowBlockKind, string> = {
  prose: 'text',
  note: 'note',
  query: 'sql',
  table: 'tbl',
  rows: 'rows',
  steps: 'step',
}

export default function FlowDocView({
  doc,
  database,
  source,
  now = new Date(),
}: {
  doc: FlowDoc
  /** The database its references mean — the doc's own, or the session's. */
  database: string | null
  /** Where the file came from, shown so a doc can be found again. */
  source: string
  now?: Date
}) {
  const age = describeCapture(doc.capturedAt, now)
  const outline = flowOutline(doc)
  const tables = flowTables(doc)

  const facts = [doc.author, doc.scope.database, doc.scope.schema, age?.label].filter(Boolean)

  return (
    <div className="flow-reading mx-auto flex max-w-6xl gap-8 px-4 pb-16 pt-6">
      <main className="min-w-0 flex-1 space-y-6">
        <header className="space-y-2">
          <p className="island-kicker">Flow · {source}</p>
          <h1 className="display-title text-2xl font-semibold text-[var(--sea-ink)]">
            {doc.question ?? doc.title}
          </h1>
          {doc.question && (
            <p className="text-[13px] text-[var(--sea-ink-soft)]">{doc.title}</p>
          )}
          {doc.summary && (
            <FlowMarkdown
              markdown={doc.summary}
              scope={doc.scope}
              database={database}
              className="max-w-3xl pt-1"
            />
          )}
          {facts.length > 0 && (
            <p className="font-mono text-[11px] text-[var(--lagoon-deep)]">{facts.join(' · ')}</p>
          )}
        </header>

        {age?.stale && (
          <p className="rounded-2xl border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-[12px] text-[var(--sea-ink-soft)]">
            These rows were {age.label.replace('captured ', 'captured ')}. Nothing on this page
            re-reads the database — open a table to see what is there now.
          </p>
        )}

        {!database && (
          <p className="rounded-2xl border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-2 text-[12px] text-[var(--sea-ink-soft)]">
            Not connected to the database this flow describes, so its references read as names
            rather than links. The story and the captured rows are all here.
          </p>
        )}

        {tables.length > 0 && (
          <section className="space-y-1">
            <p className="island-kicker">Tables in this flow</p>
            <ul className="flex flex-wrap gap-2">
              {tables.map((ref) => {
                const schema = resolveSchema(ref, doc.scope)
                const name = formatTableRef(ref, doc.scope)
                return (
                  <li
                    key={name}
                    className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-0.5 font-mono text-[11px]"
                  >
                    <FlowLink
                      target={
                        schema
                          ? { kind: 'table', schema, table: ref.table }
                          : { kind: 'unplaced', label: name }
                      }
                      database={database}
                    >
                      {name}
                    </FlowLink>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <div className="space-y-6">
          {doc.blocks.map((block) => (
            <FlowBlockView
              key={block.id}
              block={block}
              scope={doc.scope}
              database={database}
            />
          ))}
        </div>
      </main>

      {outline.length > 2 && (
        <nav className="sticky top-6 hidden h-fit w-56 shrink-0 space-y-1 lg:block">
          <p className="island-kicker border-b border-[var(--line)] pb-1">In this flow</p>
          <ol className="space-y-0.5 pt-1">
            {outline.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  className="block truncate rounded px-1 py-0.5 text-[12px] text-[var(--sea-ink-soft)] hover:bg-[rgba(79,184,178,0.1)] hover:text-[var(--sea-ink)]"
                  title={entry.label}
                >
                  <span className="font-mono text-[10px] text-[var(--lagoon-deep)]">
                    {OUTLINE_KIND[entry.kind]}
                  </span>{' '}
                  {entry.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </div>
  )
}
