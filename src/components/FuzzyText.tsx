import type { MatchRange } from '#/lib/fuzzy'

/**
 * Text with its fuzzy-matched characters marked.
 *
 * The other half of `#/lib/fuzzy`: the lib returns spans, this draws them. A
 * scattered match is unreadable without it — the row shows *why* it is in the
 * list, so a spread-out hit does not look like a wrong one.
 */
export default function FuzzyText({
  text,
  ranges,
}: {
  text: string
  ranges: readonly MatchRange[]
}) {
  if (ranges.length === 0) return <>{text}</>

  const parts: { text: string; matched: boolean }[] = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) parts.push({ text: text.slice(at, start), matched: false })
    parts.push({ text: text.slice(start, end), matched: true })
    at = end
  }
  if (at < text.length) parts.push({ text: text.slice(at), matched: false })

  return (
    <>
      {parts.map((part, i) =>
        part.matched ? (
          <mark
            key={i}
            className="bg-transparent font-semibold text-[var(--lagoon-deep)]"
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}
