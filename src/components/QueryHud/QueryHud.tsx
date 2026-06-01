import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { $getPerfLog } from '#/server/api'
import {
  lastAction,
  sessionStats,
  shapeBreakdown,
  normalizeSql,
} from '#/lib/query-stats'
import type { PerfLogEntry } from '#/server/perf-log'

const POLL_MS = 1000
const BURST_GAP_MS = 750
const BUFFER_CAP = 1000
const CURSOR_KEY = 'queryHudCursor'

function initialCursor(): number {
  if (typeof window === 'undefined') return 0
  return Number(window.localStorage.getItem(CURSOR_KEY)) || 0
}

export default function QueryHud() {
  const [entries, setEntries] = useState<PerfLogEntry[]>([])
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState<'action' | 'session'>('action')
  const cursorRef = useRef<number>(initialCursor())

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const fresh = await $getPerfLog({ data: { sinceTs: cursorRef.current } })
        if (cancelled || fresh.length === 0) return
        cursorRef.current = Math.max(cursorRef.current, ...fresh.map((e) => e.ts))
        setEntries((prev) => [...prev, ...fresh].slice(-BUFFER_CAP))
      } catch {
        /* best effort */
      }
    }
    const id = setInterval(tick, POLL_MS)
    void tick()
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const action = lastAction(entries, BURST_GAP_MS)
  const actionMs = action.reduce((sum, e) => sum + e.ms, 0)
  const warn = action.some((e) => !e.ok || e.ms > 1000)
  const stats = sessionStats(entries)
  const shapes = shapeBreakdown(entries)

  const clear = () => {
    setEntries([])
    const now = Date.now()
    cursorRef.current = now
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CURSOR_KEY, String(now))
    }
  }

  return (
    <div className="relative font-mono text-xs text-[var(--sea-ink)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Query stats"
        className={`rounded-lg border px-2 py-1 tabular-nums ${
          warn
            ? 'border-red-400 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
            : 'border-[var(--line)] bg-[var(--surface-strong)]'
        }`}
      >
        ⚡ {action.length} · {actionMs}ms {open ? '▾' : '▴'}
      </button>

      {open &&
        mounted &&
        createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[80vh] w-[52rem] max-w-[92vw] overflow-auto rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-800 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
          <div className="mb-3 flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setTab('action')}
              className={tab === 'action' ? 'font-bold underline' : ''}
            >
              Last action ({action.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('session')}
              className={tab === 'session' ? 'font-bold underline' : ''}
            >
              Session ({stats.count})
            </button>
            <button type="button" onClick={clear} className="ml-auto opacity-60">
              clear
            </button>
            <button type="button" onClick={() => setOpen(false)} className="opacity-60">
              close ✕
            </button>
          </div>

          {tab === 'action' ? (
            <ul className="space-y-1">
              {[...action]
                .sort((a, b) => b.ms - a.ms)
                .map((e, i) => (
                  <li key={i} className={e.ok ? '' : 'text-red-600'}>
                    <span className="inline-block w-14 text-right tabular-nums">
                      {e.ms}ms
                    </span>{' '}
                    <span className="opacity-60">{e.rowCount ?? '–'} rows</span>{' '}
                    <span title={e.sql}>{normalizeSql(e.sql).slice(0, 60)}</span>
                  </li>
                ))}
              {action.length === 0 && <li className="opacity-60">no queries yet</li>}
            </ul>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="total" value={`${stats.totalMs}ms`} />
                <Stat label="avg" value={`${stats.avgMs}ms`} />
                <Stat label="p95" value={`${stats.p95Ms}ms`} />
                <Stat label="queries" value={String(stats.count)} />
                <Stat label="errors" value={String(stats.errorCount)} />
                <Stat label="slowest" value={`${stats.slowest?.ms ?? 0}ms`} />
              </div>
              <table className="w-full">
                <thead className="opacity-60">
                  <tr>
                    <th className="text-left">shape</th>
                    <th className="text-right">n</th>
                    <th className="text-right">total</th>
                    <th className="text-right">avg</th>
                  </tr>
                </thead>
                <tbody>
                  {shapes.map((s) => (
                    <tr key={s.shape}>
                      <td title={s.shape}>{s.shape.slice(0, 40)}</td>
                      <td className="text-right tabular-nums">{s.count}</td>
                      <td className="text-right tabular-nums">{s.totalMs}ms</td>
                      <td className="text-right tabular-nums">{s.avgMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>,
          document.body,
        )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] px-2 py-1">
      <div className="opacity-60">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  )
}
