import type { SequenceInfo } from '#/lib/types'

/**
 * Sequence health, computed in `BigInt` because an int8 sequence outruns
 * `number` long before it outruns its ceiling.
 */
export interface SequenceHealth {
  /** 0..1 of the ceiling consumed; `null` when either bound is unknown. */
  usedFrac: number | null
  /** Values left before the ceiling, as a decimal string; `null` when unknown. */
  remaining: string | null
  /** The bound that actually applies — the lower of the sequence's own maximum
   *  and what the column's type can hold. */
  ceiling: string | null
  /** Which of the two set the ceiling, so the UI can say why. */
  ceilingSource: 'sequence' | 'column' | null
  /** `lastValue - columnMax`. Positive is normal (the sequence leads). */
  drift: string | null
  /** The column already holds a value at or above the sequence — the next
   *  insert collides on the primary key. */
  behindColumn: boolean
  level: 'ok' | 'watch' | 'critical' | 'unknown'
}

const INTEGRAL = /^[-+]?\d+$/

export function toBigInt(value: string | null | undefined): bigint | null {
  if (value == null) return null
  const s = value.trim()
  if (!INTEGRAL.test(s)) return null
  try {
    return BigInt(s)
  } catch {
    return null
  }
}

/** Consumed fraction of a ceiling, as a float — precision loss is fine for a bar. */
function fractionOf(used: bigint, ceiling: bigint): number | null {
  if (ceiling <= 0n) return null
  const scaled = (used * 10_000n) / ceiling
  return Number(scaled) / 10_000
}

export const SEQUENCE_WATCH_FRAC = 0.7
export const SEQUENCE_CRITICAL_FRAC = 0.9

/**
 * What the column's own type can hold. A `bigint` sequence feeding an `integer`
 * column — the shape every Django `AutoField` produces — runs out at the
 * column's limit, four billion values before the sequence notices, so the
 * sequence's own `max_value` is the wrong number to measure against.
 */
export function columnTypeCeiling(columnType: string | null | undefined): string | null {
  if (!columnType) return null
  const base = columnType.trim().toLowerCase().replace(/\[\]$/, '').replace(/\(.*\)$/, '').trim()
  switch (base) {
    case 'smallint':
    case 'int2':
      return '32767'
    case 'integer':
    case 'int':
    case 'int4':
      return '2147483647'
    case 'bigint':
    case 'int8':
      return '9223372036854775807'
    default:
      // numeric, uuid, text keys: no fixed ceiling worth claiming.
      return null
  }
}

export function sequenceHealth(
  seq: Pick<SequenceInfo, 'lastValue' | 'maxValue' | 'columnMax'> & {
    columnType?: string | null
  },
): SequenceHealth {
  const last = toBigInt(seq.lastValue)
  const seqMax = toBigInt(seq.maxValue)
  const colCeiling = toBigInt(columnTypeCeiling(seq.columnType))
  const columnMax = toBigInt(seq.columnMax)

  let max: bigint | null = null
  let ceilingSource: SequenceHealth['ceilingSource'] = null
  if (seqMax !== null && colCeiling !== null) {
    max = seqMax <= colCeiling ? seqMax : colCeiling
    ceilingSource = seqMax <= colCeiling ? 'sequence' : 'column'
  } else if (seqMax !== null) {
    max = seqMax
    ceilingSource = 'sequence'
  } else if (colCeiling !== null) {
    max = colCeiling
    ceilingSource = 'column'
  }

  const usedFrac = last !== null && max !== null ? fractionOf(last, max) : null
  const remaining = last !== null && max !== null ? (max - last).toString() : null
  const drift = last !== null && columnMax !== null ? (last - columnMax).toString() : null
  const behindColumn = last !== null && columnMax !== null && last < columnMax

  let level: SequenceHealth['level']
  if (behindColumn) level = 'critical'
  else if (usedFrac === null) level = 'unknown'
  else if (usedFrac >= SEQUENCE_CRITICAL_FRAC) level = 'critical'
  else if (usedFrac >= SEQUENCE_WATCH_FRAC) level = 'watch'
  else level = 'ok'

  return {
    usedFrac,
    remaining,
    ceiling: max === null ? null : max.toString(),
    ceilingSource,
    drift,
    behindColumn,
    level,
  }
}

/** `1234567` → `1,234,567`, on strings so bignums survive the trip. */
export function groupDigits(value: string | null): string {
  if (value == null) return '—'
  const s = value.trim()
  if (!INTEGRAL.test(s)) return s
  const negative = s.startsWith('-')
  const digits = s.replace(/^[-+]/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return negative ? `-${digits}` : digits
}
