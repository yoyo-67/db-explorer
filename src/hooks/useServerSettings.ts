import { useEffect } from 'react'
import { useAppSettings } from '#/hooks/useAppSettings'
import { $setServerSettings } from '#/server/api'

/**
 * Mirror the settings only the server can act on.
 *
 * Three of them are not really browser preferences: whether queries are written
 * to the perf log, the `statement_timeout` they run under, and whether the
 * console may write. All three are set where the other knobs are and remembered
 * the same way, but none can be enforced in a page — so the browser that holds
 * the preference tells the server.
 *
 * Write mode is the reason this sync has to be reliable rather than merely
 * convenient: the server refuses a write until it has heard, so a tab that
 * never speaks is a console that cannot write, and a stale `true` left behind
 * by a restart is a console that can. Sending on load, from every document,
 * is what keeps the server's answer the current one.
 *
 * Mounted once, in the root route. Settings are shared by every tab through
 * `localStorage`, so one sender per document is enough, and a tab that never
 * opens the settings page still has to speak: otherwise the server would follow
 * whoever toggled last, and after a restart, nobody at all.
 */
export function useServerSettingsSync(): void {
  const { queryHud, statementTimeoutMs, writeMode } = useAppSettings()
  useEffect(() => {
    void $setServerSettings({
      data: { perfLog: queryHud, statementTimeoutMs, writeMode },
    })
  }, [queryHud, statementTimeoutMs, writeMode])
}
