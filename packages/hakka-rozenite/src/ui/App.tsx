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

/** Inspector backed by the device capture mirror. */
export default function App() {
  const client = useRozeniteDevToolsClient<HakkaRozeniteEventMap>({
    pluginId: HAKKA_ROZENITE_PLUGIN_ID,
  })

  // Reconnecting replaces the client; dispose subscriptions to the old one.
  const store = useMemo<PanelStore | null>(() => (client ? createPanelStore(client) : null), [client])
  useEffect(() => {
    return () => store?.destroy()
  }, [store])

  const [requests, setRequests] = useState<NetworkRequest[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Reset during render so a new client never displays the previous snapshot.
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
