/**
 * A series, drawn small. Inline SVG rather than a chart library: it is a
 * polyline, and a dependency for a polyline is a dependency to keep up to date
 * forever.
 *
 * A single point is drawn as a dot — a line needs two, and stretching one across
 * the box would claim a trend that has not been measured.
 */
export default function Sparkline({
  values,
  label,
  width = 120,
  height = 24,
}: {
  values: number[]
  /** Read out to assistive tech, since the shape is not available to it. */
  label: string
  width?: number
  height?: number
}) {
  if (values.length === 0) return null

  const max = Math.max(...values, 1)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const y = (value: number) => height - (value / max) * (height - 2) - 1

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="overflow-visible text-[var(--lagoon-deep)]"
    >
      {values.length === 1 ? (
        <circle cx={width / 2} cy={y(values[0])} r={2} fill="currentColor" />
      ) : (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          points={values.map((value, i) => `${i * step},${y(value)}`).join(' ')}
        />
      )}
    </svg>
  )
}
