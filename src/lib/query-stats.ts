import type { PerfLogEntry } from '#/server/perf-log'

export function normalizeSql(sql: string): string {
  let s = sql.replace(/\s+/g, ' ').trim()
  s = s.replace(/'[^']*'/g, '?') // string literals
  s = s.replace(/\bIN\s*\([^)]*\)/gi, 'IN (?)') // IN-lists
  s = s.replace(/\b\d+\b/g, '?') // numeric literals
  return s
}

export function groupBursts(entries: PerfLogEntry[], gapMs: number): PerfLogEntry[][] {
  if (entries.length === 0) return []
  const sorted = [...entries].sort((a, b) => a.ts - b.ts)
  const bursts: PerfLogEntry[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (cur.ts - prev.ts < gapMs) {
      bursts[bursts.length - 1].push(cur)
    } else {
      bursts.push([cur])
    }
  }
  return bursts
}

export function lastAction(entries: PerfLogEntry[], gapMs: number): PerfLogEntry[] {
  const bursts = groupBursts(entries, gapMs)
  return bursts.length === 0 ? [] : bursts[bursts.length - 1]
}

export interface SessionStats {
  count: number
  totalMs: number
  avgMs: number
  p95Ms: number
  errorCount: number
  slowest: PerfLogEntry | null
}

export function sessionStats(entries: PerfLogEntry[]): SessionStats {
  if (entries.length === 0) {
    return { count: 0, totalMs: 0, avgMs: 0, p95Ms: 0, errorCount: 0, slowest: null }
  }
  const totalMs = entries.reduce((sum, e) => sum + e.ms, 0)
  const errorCount = entries.filter((e) => !e.ok).length
  const slowest = entries.reduce((max, e) => (e.ms > max.ms ? e : max), entries[0])
  const sortedMs = entries.map((e) => e.ms).sort((a, b) => a - b)
  const p95Index = Math.ceil(0.95 * sortedMs.length) - 1
  return {
    count: entries.length,
    totalMs,
    avgMs: Math.round(totalMs / entries.length),
    p95Ms: sortedMs[p95Index],
    errorCount,
    slowest,
  }
}

export interface ShapeRow {
  shape: string
  count: number
  totalMs: number
  avgMs: number
}

export function shapeBreakdown(entries: PerfLogEntry[]): ShapeRow[] {
  const groups = new Map<string, { count: number; totalMs: number }>()
  for (const e of entries) {
    const shape = normalizeSql(e.sql)
    const g = groups.get(shape) ?? { count: 0, totalMs: 0 }
    g.count += 1
    g.totalMs += e.ms
    groups.set(shape, g)
  }
  return [...groups.entries()]
    .map(([shape, g]) => ({
      shape,
      count: g.count,
      totalMs: g.totalMs,
      avgMs: Math.round(g.totalMs / g.count),
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
}
