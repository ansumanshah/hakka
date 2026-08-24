import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge'
import { FilterBar, RequestDetail, RequestList } from 'hakka-browser/react'
import type { NetworkRequest } from 'hakka-core'
import { useEffect, useMemo, useState } from 'react'

import { HAKKA_ROZENITE_PLUGIN_ID } from '../shared/protocol'
import type { HakkaRozeniteEventMap } from '../shared/protocol'
import { createPanelStore } from './panelStore'
import type { PanelStore } from './panelStore'

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100vh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  panes: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
  },
  list: {
    flex: '1 1 55%',
    minWidth: 0,
    overflow: 'auto',
    borderRight: '1px solid rgba(127, 127, 127, 0.25)',
  },
  detail: {
    flex: '1 1 45%',
    minWidth: 0,
    overflow: 'auto',
  },
  centered: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    color: 'var(--hakka-text-muted, #888)',
  },
}

/**
 * The Rozenite panel entry point (`rozenite.config.ts`'s `panels[0].source`).
 * Renders `hakka-browser/react`'s wrappers over `hakka-browser/elements`'s
 * `<hakka-filter-bar>`/`<hakka-request-list>`/`<hakka-request-detail>` custom
 * elements, fed by `./panelStore.ts`'s adapter instead of those elements'
 * own default store singleton.
 */
export default function App() {
  const client = useRozeniteDevToolsClient<HakkaRozeniteEventMap>({
    pluginId: HAKKA_ROZENITE_PLUGIN_ID,
  })

  // One store per client instance — `useRozeniteDevToolsClient` hands back a
  // new client if it ever has to reconnect, and the old store's subscriptions
  // to that stale client would otherwise leak.
  const store = useMemo<PanelStore | null>(() => (client ? createPanelStore(client) : null), [client])
  useEffect(() => {
    return () => store?.destroy()
  }, [store])

  const [requests, setRequests] = useState<NetworkRequest[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Reset the mirror when the store identity changes (including to null) —
  // done during render per React's derived-state-reset pattern rather than
  // as a setState inside the effect.
  const [prevStore, setPrevStore] = useState<PanelStore | null>(store)
  if (prevStore !== store) {
    setPrevStore(store)
    setRequests([])
  }

  useEffect(() => {
    if (!store) return undefined
    let cancelled = false
    const refresh = () => {
      void store.getSnapshot().then((snapshot) => {
        if (!cancelled) setRequests(snapshot)
      })
    }
    refresh()
    const unsubscribe = store.subscribe(refresh)
    const unsubscribeClear = store.onClear(refresh)
    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeClear()
    }
  }, [store])

  // Re-derived from the live `requests` mirror (not captured once at select
  // time) so the detail pane keeps reflecting a request that's still
  // in-flight when selected — a status code or response body arriving after
  // selection updates the pane instead of freezing on a stale snapshot.
  const selected = useMemo(() => requests.find((r) => r.id === selectedId) ?? null, [requests, selectedId])

  if (!store) {
    return (
      <div style={styles.centered}>
        <p>Connecting to the app…</p>
      </div>
    )
  }

  return (
    <div style={styles.root}>
      <FilterBar store={store} />
      <div style={styles.panes}>
        <div style={styles.list}>
          <RequestList store={store} onSelect={({ id }) => setSelectedId(id)} />
        </div>
        <div style={styles.detail}>
          <RequestDetail request={selected} onBack={() => setSelectedId(null)} />
        </div>
      </div>
    </div>
  )
}
