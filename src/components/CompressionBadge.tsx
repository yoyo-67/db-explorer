import type { ColumnInfo } from '#/lib/types'

/**
 * That this column's bytes are a compressed document, and that what the cells
 * show is that document rather than the bytes.
 *
 * Without the badge the column reads as a `bytea` that somehow renders as text,
 * which is a worse mystery than the hex it replaced. Nothing in the catalog
 * records the compression, so the badge is also the only place a reader learns
 * it — see `#/server/blob-columns` for how it was found out.
 */
export default function CompressionBadge({
  compression,
}: {
  compression: ColumnInfo['compression']
}) {
  if (!compression) return null
  const { codec, encoding } = compression
  return (
    <span
      title={`Stored ${codec}-compressed; the value shown is the decoded ${
        encoding === 'json' ? 'JSON document' : 'text'
      }, not the stored bytes.`}
      className="rounded border border-dashed border-[var(--lagoon)]/60 px-1 py-0.5 text-[10px] font-medium text-[var(--lagoon-deep)]"
    >
      {codec} · {encoding}
    </span>
  )
}
