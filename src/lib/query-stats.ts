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
