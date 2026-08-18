import { highlightProps, useHighlight } from '#/components/help/highlight'
import type { SqlStep } from '#/lib/help/types'

/**
 * The statement and its reading, side by side.
 *
 * The code block is not a separate copy of the SQL — it is the steps printed in
 * order, so an explanation can never describe a line the block does not contain.
 * Pointing at either side dims the other lines rather than hiding them: keeping
 * the whole statement visible is the point, since a clause only makes sense in
 * the company of the ones around it.
 */
export default function SqlWalkthrough({ steps }: { steps: SqlStep[] }) {
  const state = useHighlight()
  const { activeId } = state
  const anyActive = steps.some((step) => step.id === activeId)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <pre className="sticky top-16 overflow-x-auto rounded-xl border border-[var(--line)] bg-[#1d2e45] p-4 font-mono text-[12px] leading-relaxed text-[#e8efff]">
        <code>
          {steps.map((step) => {
            const on = activeId === step.id
            return (
              <span
                key={step.id}
                {...highlightProps(step.id, state)}
                tabIndex={0}
                className={`block cursor-default rounded px-1 outline-none transition ${
                  on ? 'bg-[rgba(79,184,178,0.28)]' : anyActive ? 'opacity-40' : ''
                }`}
              >
                {step.clause}
              </span>
            )
          })}
        </code>
      </pre>

      <ol className="space-y-2">
        {steps.map((step, index) => {
          const on = activeId === step.id
          return (
            <li key={step.id}>
              <div
                {...highlightProps(step.id, state)}
                tabIndex={0}
                className={`rounded-xl border p-3 outline-none transition ${
                  on
                    ? 'border-[var(--lagoon-deep)] bg-[rgba(79,184,178,0.1)]'
                    : 'border-[var(--line)] bg-[var(--chip-bg)]'
                }`}
              >
                <p className="flex items-baseline gap-2 text-sm font-semibold text-[var(--sea-ink)]">
                  <span className="font-mono text-[11px] text-[var(--lagoon-deep)]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {step.title}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--sea-ink-soft)]">
                  {renderInlineCode(step.detail)}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * Backticks in the prose become code spans. A hand-rolled split rather than a
 * markdown dependency: the help text needs exactly this one mark and nothing
 * else, and a parser that also renders links would be a way to smuggle markup
 * into a page that only ever prints its own strings.
 */
export function renderInlineCode(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code
        key={index}
        className="rounded bg-[rgba(23,58,64,0.08)] px-1 py-px font-mono text-[12px] text-[var(--sea-ink)]"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      <span key={index}>{part}</span>
    ),
  )
}
