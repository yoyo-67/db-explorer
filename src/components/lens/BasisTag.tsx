import type { EdgeBasis } from '#/lib/types'

/**
 * Where an edge came from, never conflated (BUILD-SPEC §2.2). Declared edges are
 * solid, the two inferred bases dashed — the same visual rule the drawings use for
 * their strokes, so a list and a chord say the same thing about the same edge.
 */
export default function BasisTag({ basis }: { basis: EdgeBasis }) {
  const hint = {
    declared: 'A real Postgres foreign-key constraint.',
    model:
      'A Django relation whose constraint was stripped (simple_history / CrossDBForeignKey). Authoritative, but not enforced by the database.',
    convention:
      'Inferred from the column name, only where no model relation described the column.',
  }[basis]
  return (
    <span
      title={hint}
      className={`rounded-full border px-1.5 text-[10px] ${
        basis === 'declared'
          ? 'border-[var(--chip-line)] text-[var(--palm)]'
          : 'border-dashed border-[var(--line)] text-[var(--sea-ink-soft)]'
      }`}
    >
      {basis}
    </span>
  )
}
