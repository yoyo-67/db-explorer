import { useEffect } from 'react'
import { useAppSettings } from '#/hooks/useAppSettings'
import { $setServerSettings } from '#/server/api'

/**
 * Mirror the settings only the server can act on.
 *
 * Two of them are not really browser preferences: whether queries are written to
 * the perf log, and the `statement_timeout` they run under. Both are set where
 * the other knobs are and remembered the same way, but neither can be enforced
 * in a page — so the browser that holds the preference tells the server.
 *
 * Mounted once, in the root route. Settings are shared by every tab through
 * `localStorage`, so one sender per document is enough, and a tab that never
 * opens the settings page still has to speak: otherwise the server would follow
 * whoever toggled last, and after a restart, nobody at all.
 */
export function useServerSettingsSync(): void {
  const { queryHud, statementTimeoutMs } = useAppSettings()
  useEffect(() => {
    void $setServerSettings({
      data: { perfLog: queryHud, statementTimeoutMs },
    })
  }, [queryHud, statementTimeoutMs])
}
