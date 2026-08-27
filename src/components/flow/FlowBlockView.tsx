import { useRouter } from '@tanstack/react-router'
import CopyButton from '#/components/CopyButton'
import FlowLink from '#/components/flow/FlowLink'
import FlowMarkdown from '#/components/flow/FlowMarkdown'
import FlowResultTable from '#/components/flow/FlowResultTable'
import { formatStamp, formatTableRef, resolveSchema } from '#/lib/flow-doc'
import { stageConsoleSql } from '#/lib/console-handoff'
import type {
  FlowBlock,
  FlowNoteBlock,
  FlowQueryBlock,
  FlowRowsBlock,
  FlowScope,
  FlowStepsBlock,
  FlowTableBlock,
  FlowTableRef,
} from '#/lib/flow-doc'

/**
 * One block of a flow doc.
 *
 * Every block is the same shape on the page — a kicker saying what kind of
 * evidence this is, the body, then the author's note under it — because a flow
 * is read top to bottom and a reader should never have to work out whether they
 * are looking at a claim or the thing that backs it.
 */
export default function FlowBlockView({
  block,
  scope,
  database,
}: {
  block: FlowBlock
  scope: FlowScope
  database: string | null
}) {
  return (
    <section id={block.id} className="scroll-mt-20 space-y-2">
      {body()}
      {block.note && (
        <div className="border-l-2 border-[var(--line)] pl-3">
          <FlowMarkdown markdown={block.note} scope={scope} database={database} />
        </div>
      )}
    </section>
  )

  function body() {
    switch (block.kind) {
      case 'prose':
        return <FlowMarkdown markdown={block.markdown} scope={scope} database={database} />
      case 'note':
        return <NoteBody block={block} scope={scope} database={database} />
      case 'query':
        return <QueryBody block={block} scope={scope} database={database} />
      case 'table':
        return <TableBody block={block} scope={scope} database={database} />
      case 'rows':
        return <RowsBody block={block} scope={scope} database={database} />
      case 'steps':
        return <StepsBody block={block} scope={scope} database={database} />
    }
  }
}

const TONE_STYLE: Record<FlowNoteBlock['tone'], { border: string; kicker: string }> = {
  info: { border: 'border-[var(--chip-line)] bg-[var(--chip-bg)]', kicker: 'Note' },
  warn: { border: 'border-amber-500/40 bg-amber-500/5', kicker: 'Careful' },
  gotcha: { border: 'border-rose-500/40 bg-rose-500/5', kicker: 'Gotcha' },
}

function NoteBody({
  block,
  scope,
  database,
}: {
  block: FlowNoteBlock
  scope: FlowScope
  database: string | null
}) {
  const tone = TONE_STYLE[block.tone]
  return (
    <div className={`rounded-2xl border p-4 ${tone.border}`}>
      <p className="island-kicker">{tone.kicker}</p>
      <div className="mt-1">
        <FlowMarkdown markdown={block.markdown} scope={scope} database={database} />
      </div>
    </div>
  )
}

/**
 * A query and what it returned.
 *
 * The statement comes first and the rows second, in that order on purpose: the
 * rows only mean something once you know what was asked for. The two buttons are
 * the only ways out — copy it, or open it in the console, which is the one place
 * in this app that runs SQL and does it inside a read-only transaction. Nothing
 * here re-runs the query itself: a flow doc that quietly refreshed would stop
 * being a record of what happened.
 */
function QueryBody({
  block,
  scope,
  database,
}: {
  block: FlowQueryBlock
  scope: FlowScope
  database: string | null
}) {
  const router = useRouter()

  /**
   * Open the statement in a console in a *new tab*.
   *
   * A flow doc is read straight through, and its queries are the part a reader
   * wants to try — so navigating away from the page they are halfway down is the
   * wrong move. A new tab per query also means several can be open at once,
   * which is why the handoff is ticketed rather than a single slot (see
   * `console-handoff`).
   *
   * `window.open` in the click handler rather than a `target="_blank"` link,
   * because the ticket has to be staged at click time: a link would have to mint
   * one on every render, writing a handoff nobody asked for.
   */
  const openInConsole = () => {
    if (!database) return
    const handoff = stageConsoleSql(block.sql)
    const { href } = router.buildLocation({
      to: '/d/$database/console',
      params: { database },
      search: handoff ? { handoff } : {},
    })
    window.open(href, '_blank', 'noopener')
  }

  return (
    <div className="island-shell overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
        <p className="island-kicker">{block.title ?? 'Query'}</p>
        <div className="ml-auto flex items-center gap-2">
          <CopyButton text={block.sql} label="Copy SQL" />
          {database && (
            <button
              type="button"
              onClick={openInConsole}
              title="Open this statement in a console in a new tab, so you keep your place here"
              className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.1)]"
            >
              Open in console
            </button>
          )}
        </div>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-[var(--sea-ink)]">
        {block.sql}
      </pre>
      {block.result && (
        <div className="border-t border-[var(--line)]">
          <FlowResultTable result={block.result} database={database} emptyLabel="Returned no rows" />
        </div>
      )}
      <QueryFooting block={block} scope={scope} />
    </div>
  )
}

/**
 * What the capture costs a reader to trust: how many rows there really were,
 * whether what is shown is all of them, how long it took, and when.
 *
 * `truncated` is said in words rather than shown as an ellipsis. A sample that
 * looks like a whole answer is how someone concludes a table has five rows in it.
 */
function QueryFooting({ block, scope }: { block: FlowQueryBlock; scope: FlowScope }) {
  const shown = block.result?.rows.length ?? 0
  const facts: string[] = []
  if (block.rowCount != null)
    facts.push(
      block.truncated && block.rowCount > shown
        ? `${shown} of ${block.rowCount} rows shown`
        : `${block.rowCount} ${block.rowCount === 1 ? 'row' : 'rows'}`,
    )
  else if (block.truncated) facts.push(`${shown} rows shown, and there were more`)
  if (block.durationMs != null) facts.push(`${block.durationMs} ms`)
  if (block.ranAt) facts.push(`ran ${formatStamp(block.ranAt)}`)
  if (scope.database) facts.push(scope.database)
  if (facts.length === 0) return null
  return (
    <p className="border-t border-[var(--line)] px-4 py-1.5 font-mono text-[10px] text-[var(--sea-ink-soft)]">
      {facts.join(' · ')}
    </p>
  )
}

/** The header a table and a rows block share: the name, linked, and a title. */
function RefHeading({
  ref: tableRef,
  title,
  scope,
  database,
  trailing,
}: {
  ref: FlowTableRef
  title: string | null
  scope: FlowScope
  database: string | null
  trailing?: string
}) {
  const schema = resolveSchema(tableRef, scope)
  const name = formatTableRef(tableRef, scope)
  return (
    <div className="flex flex-wrap items-baseline gap-2 border-b border-[var(--line)] px-4 py-2">
      <p className="island-kicker">
        <FlowLink
          target={schema ? { kind: 'table', schema, table: tableRef.table } : { kind: 'unplaced', label: name }}
          database={database}
        >
          {name}
        </FlowLink>
      </p>
      {title && <p className="text-[13px] text-[var(--sea-ink)]">{title}</p>}
      {trailing && (
        <p className="ml-auto font-mono text-[10px] text-[var(--sea-ink-soft)]">{trailing}</p>
      )}
    </div>
  )
}

function TableBody({
  block,
  scope,
  database,
}: {
  block: FlowTableBlock
  scope: FlowScope
  database: string | null
}) {
  // The author's column list is a reading order, so it wins over the capture's.
  const result = block.result
    ? block.columns.length > 0
      ? {
          columns: block.columns.map((name) => ({
            name,
            type: block.result?.columns.find((c) => c.name === name)?.type ?? null,
          })),
          rows: block.result.rows,
        }
      : block.result
    : null

  return (
    <div className="island-shell overflow-hidden rounded-2xl">
      <RefHeading
        ref={block.ref}
        title={block.title}
        scope={scope}
        database={database}
        trailing={result ? `${result.rows.length} sampled` : 'no sample'}
      />
      {result && <FlowResultTable result={result} database={database} />}
      {block.columns.length > 0 && !result && (
        <p className="px-4 py-3 font-mono text-[12px] text-[var(--sea-ink-soft)]">
          {block.columns.join(' · ')}
        </p>
      )}
    </div>
  )
}

/**
 * Named rows: the ones the investigation actually walked through.
 *
 * A card each rather than a table, because these rows are not a result set —
 * they are the individuals the story is about, they come from one table, and each
 * carries only the handful of fields that made it worth naming.
 */
function RowsBody({
  block,
  scope,
  database,
}: {
  block: FlowRowsBlock
  scope: FlowScope
  database: string | null
}) {
  const schema = resolveSchema(block.ref, scope)
  return (
    <div className="island-shell overflow-hidden rounded-2xl">
      <RefHeading
        ref={block.ref}
        title={block.title}
        scope={scope}
        database={database}
        trailing={block.pk ? `by ${block.pk}` : undefined}
      />
      <ul className="divide-y divide-[var(--line)]">
        {block.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
            <FlowLink
              target={
                schema
                  ? { kind: 'row', schema, table: block.ref.table, id: item.id }
                  : { kind: 'unplaced', label: item.id }
              }
              database={database}
              className="font-mono text-[12px] font-semibold text-[var(--lagoon-deep)] hover:underline"
            >
              #{item.id}
            </FlowLink>
            {item.label && <span className="text-[13px] text-[var(--sea-ink)]">{item.label}</span>}
            {Object.entries(item.fields).length > 0 && (
              <span className="ml-auto font-mono text-[11px] text-[var(--sea-ink-soft)]">
                {Object.entries(item.fields)
                  .map(([key, value]) => `${key}=${value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
                  .join(' · ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The flow itself, numbered, each step pointing at what it happened to. */
function StepsBody({
  block,
  scope,
  database,
}: {
  block: FlowStepsBlock
  scope: FlowScope
  database: string | null
}) {
  return (
    <div className="space-y-2">
      {block.title && <p className="island-kicker">{block.title}</p>}
      <ol className="space-y-3">
        {block.items.map((step, i) => {
          const schema = step.ref ? resolveSchema(step.ref, scope) : null
          return (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] font-mono text-[11px] text-[var(--sea-ink)]">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-[13px] font-semibold text-[var(--sea-ink)]">
                  {step.title}
                  {step.ref && schema && (
                    <span className="ml-2 font-mono text-[11px] font-normal">
                      <FlowLink
                        target={
                          step.ref.id
                            ? { kind: 'row', schema, table: step.ref.table, id: step.ref.id }
                            : { kind: 'table', schema, table: step.ref.table }
                        }
                        database={database}
                      >
                        {formatTableRef(step.ref, scope)}
                        {step.ref.id ? ` #${step.ref.id}` : ''}
                      </FlowLink>
                    </span>
                  )}
                </p>
                {step.detail && (
                  <FlowMarkdown markdown={step.detail} scope={scope} database={database} />
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
