import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { $switchDatabase } from '#/server/api'
import { connectionStatusKey } from '#/hooks/useConnectionStatus'
import { describeCrossDbTarget } from '#/lib/cross-db-refs'
import type { CrossDbTarget } from '#/lib/cross-db-refs'

/**
 * Open a row that lives in another database on this connection.
 *
 * Not a `<Link>`, because there is nowhere to link to: the pool is one
 * connection to one database, shared by every tab, and the route carries no
 * database segment. Following the reference therefore MOVES the session — so it
 * is a button that says so, rather than a link that quietly reconnects everyone.
 */
export default function CrossDbLink({
  target,
  value,
  note,
  className,
  children,
}: {
  target: CrossDbTarget
  value: string
  note?: string
  className?: string
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = async () => {
    setSwitching(true)
    setError(null)
    try {
      const result = await $switchDatabase({ data: { database: target.database } })
      if (!result.success) {
        setError(result.error)
        return
      }
      // Dropped, not invalidated: invalidation REFETCHES what is on screen, and
      // what is on screen belongs to the database we just left — that refetch
      // fails against the new one and its rejection would strand us here, having
      // switched but not moved. Clearing is synchronous and asks for nothing.
      queryClient.clear()
      queryClient.setQueryData(connectionStatusKey, { connected: true })
      await navigate({
        to: '/t/$schema/$table/row/$id',
        params: { schema: target.schema, table: target.table, id: value },
        search: target.column !== 'id' ? { col: target.column } : {},
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSwitching(false)
    }
  }

  const description = `${describeCrossDbTarget(target)} = ${value}`

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        void open()
      }}
      disabled={switching}
      title={
        error
          ? `Could not switch: ${error}`
          : `Open ${description}\nSwitches this connection to ${target.database} — every tab follows.${
              note ? `\n\n${note}` : ''
            }`
      }
      className={
        className ??
        `text-left underline decoration-dotted underline-offset-2 hover:decoration-solid disabled:opacity-50 ${
          error ? 'text-red-500' : 'text-[var(--lagoon-deep)]'
        }`
      }
    >
      {children}
      <span aria-hidden className="ml-1 text-[9px] opacity-70">
        {switching ? '…' : '↗'}
      </span>
    </button>
  )
}
