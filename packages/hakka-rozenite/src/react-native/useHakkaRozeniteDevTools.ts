import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge'
import { Hakka } from 'hakka-core'
import { useEffect } from 'react'

import { HAKKA_ROZENITE_PLUGIN_ID, type HakkaRozeniteEventMap } from '../shared/protocol'
import { createHakkaRozeniteBridge } from './bridge'

/**
 * Mount this once in the RN app (alongside `useHakka()`) to expose Hakka's
 * live capture stream as a "Hakka" panel in React Native DevTools, via
 * Rozenite.
 *
 * Imports `Hakka` directly from `hakka-core` rather than through
 * `hakka-react-native`'s re-export — both resolve to the same singleton as
 * long as the host app's `hakka-core` install isn't duplicated.
 */
export function useHakkaRozeniteDevTools(): void {
  const client = useRozeniteDevToolsClient<HakkaRozeniteEventMap>({
    pluginId: HAKKA_ROZENITE_PLUGIN_ID,
  })

  useEffect(() => {
    if (!client) return undefined
    return createHakkaRozeniteBridge(client, Hakka)
  }, [client])
}
