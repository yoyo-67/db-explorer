import { Fragment } from 'react'
import type { ReactNode } from 'react'
import FlowLink from '#/components/flow/FlowLink'
import { parseFlowMarkdown } from '#/lib/flow-markdown'
import type { FlowInline } from '#/lib/flow-markdown'
import type { FlowScope } from '#/lib/flow-doc'

/**
 * A flow doc's prose.
 *
 * The subset is drawn by hand from the tokens `#/lib/flow-markdown` produces —
 * no `dangerouslySetInnerHTML` anywhere, which matters because a flow doc is a
 * file an agent wrote and a URL can point at. Nothing an author can type in a
 * doc can become markup here; the worst a bad doc can do is render ugly.
 */
export default function FlowMarkdown({
  markdown,
  scope,
  database,
  className = '',
}: {
  markdown: string
  scope: FlowScope
  database: string | null
  className?: string
}) {
  const blocks = parseFlowMarkdown(markdown, scope)

  return (
    <div className={`space-y-3 ${className}`}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading': {
            const size =
              block.level === 2 ? 'text-base font-semibold' : 'text-sm font-semibold'
            return (
              <p key={i} className={`${size} text-[var(--sea-ink)]`}>
                <Inline tokens={block.children} database={database} />
              </p>
            )
          }
          case 'paragraph':
            return (
              <p key={i} className="text-[13px] leading-relaxed text-[var(--sea-ink-soft)]">
                <Inline tokens={block.children} database={database} />
              </p>
            )
          case 'list':
            return block.ordered ? (
              <ol
                key={i}
                className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-[var(--sea-ink-soft)]"
              >
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline tokens={item} database={database} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul
                key={i}
                className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-[var(--sea-ink-soft)]"
              >
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline tokens={item} database={database} />
                  </li>
                ))}
              </ul>
            )
          case 'code':
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-3 font-mono text-[12px] leading-relaxed text-[var(--sea-ink)]"
              >
                {block.code}
              </pre>
            )
        }
      })}
    </div>
  )
}

function Inline({
  tokens,
  database,
}: {
  tokens: FlowInline[]
  database: string | null
}): ReactNode {
  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case 'text':
            return <Fragment key={i}>{token.text}</Fragment>
          case 'code':
            return (
              <code
                key={i}
                className="rounded bg-[var(--chip-bg)] px-1 py-0.5 font-mono text-[12px] text-[var(--sea-ink)]"
              >
                {token.text}
              </code>
            )
          case 'strong':
            return (
              <strong key={i} className="font-semibold text-[var(--sea-ink)]">
                <Inline tokens={token.children} database={database} />
              </strong>
            )
          case 'em':
            return (
              <em key={i}>
                <Inline tokens={token.children} database={database} />
              </em>
            )
          case 'link':
            return (
              <FlowLink key={i} target={token.target} database={database}>
                <Inline tokens={token.children} database={database} />
              </FlowLink>
            )
        }
      })}
    </>
  )
}
