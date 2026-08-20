import { useEffect } from 'react'
import { useAppSettings } from '#/hooks/useAppSettings'
import { $setPerfLogging } from '#/server/api'

/**
 * Mirror the browser's query-stats setting to the server, which is what decides
 * whether queries are logged at all.
 *
 * Mounted once, in the root route: the preference is per browser and shared by
 * every tab, so one sender per document is one too many already — and a tab that
 * never opens the settings page still has to say what it wants, or the flag on
 * the server would only ever follow whoever toggled it last.
 */
export function usePerfLogSync(): void {
  const { queryHud } = useAppSettings()
  useEffect(() => {
    void $setPerfLogging({ data: { enabled: queryHud } })
  }, [queryHud])
}
