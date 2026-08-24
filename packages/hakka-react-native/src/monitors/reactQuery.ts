/**
 * React Query monitoring hooks.
 *
 * These hooks observe TanStack React Query cache events and forward
 * them to the Hakka desktop companion via HakkaBridge.
 *
 * @example
 * ```tsx
 * import { useReactQueryDevTools } from 'hakka-react-native'
 *
 * function App() {
 *   useReactQueryDevTools()
 *   return <MyApp />
 * }
 * ```
 *
 * Requires `@tanstack/react-query` as a peer dependency.
 */
import { getBodyRedactionFields, redactJsonBody } from 'hakka-core'
import { useEffect } from 'react'

import { hakkaBridge } from '../core/HakkaBridge'

export interface QueryData {
  queryKey: string
  status: 'idle' | 'pending' | 'success' | 'error'
  data?: unknown
  error?: unknown
  dataUpdatedAt: number
  errorUpdatedAt: number
  fetchStatus: 'idle' | 'fetching' | 'paused'
}

interface QueryStateLike {
  status: QueryData['status']
  data?: unknown
  error?: unknown
  dataUpdatedAt: number
  errorUpdatedAt: number
  fetchStatus: QueryData['fetchStatus']
}

interface QueryLike {
  queryKey: readonly unknown[]
  state: QueryStateLike
}

interface QueryCacheLike {
  getAll: () => QueryLike[]
  subscribe: (listener: () => void) => () => void
}

export interface QueryClientMonitorInstance {
  getQueryState: (queryKey: readonly unknown[]) => QueryStateLike | undefined
  getQueryCache: () => QueryCacheLike
}

/**
 * Redact a cached query payload before it leaves the device.
 *
 * A react-query cache holds whole API responses, so it carries exactly what
 * the network interceptors already redact — but this monitor emits the parsed
 * object on its own channel, which was bypassing all of it.
 *
 * Round-trips through JSON because `redactJsonBody` works on strings and the
 * cache holds parsed values. The payload is about to be serialized for the
 * bridge regardless, so this costs one extra parse, and only when redaction is
 * actually configured.
 */
export function redactQueryData(data: unknown): unknown {
  const fields = getBodyRedactionFields()
  if (fields.length === 0 || data == null) return data

  try {
    const serialized = JSON.stringify(data)
    if (serialized === undefined) return data
    const redacted = redactJsonBody(serialized, fields)
    return redacted == null ? data : JSON.parse(redacted)
  } catch {
    // Unserializable cache entry (a function, a cycle). Emitting it unredacted
    // would be the bug this exists to prevent, so drop the payload instead.
    return undefined
  }
}

// Sequence for synthesizing LogEntry ids — see sendQueryData below.
let queryLogSeq = 0

/**
 * Forward one query snapshot as a canonical `{type:'console', payload: LogEntry[]}`
 * frame via `hakkaBridge.sendConsole` — matches `storage.ts`'s `sendStorageData`.
 * There is no 'queries:update' branch in the wire protocol (`parseBridgeMessage` in
 * `packages/hakka-bridge/src/protocol.ts`), so emitting that type directly is silently
 * dropped by the bridge hub; `LogEntry.metadata` carries the structured query detail.
 */
function sendQueryData(queryData: QueryData): void {
  const timestamp = Date.now()
  hakkaBridge.sendConsole([
    {
      id: `query_${++queryLogSeq}_${timestamp}`,
      timestamp,
      level: queryData.status === 'error' ? 'error' : 'info',
      message: `query [${queryData.queryKey}] -> ${queryData.status}`,
      category: 'query',
      metadata: {
        ...queryData,
        data: redactQueryData(queryData.data),
      },
    },
  ])
}

/**
 * Monitor specific queries by key and send periodic snapshots.
 *
 * `queryClient` must be passed explicitly — TanStack Query v5 only exposes
 * the client via `<QueryClientProvider>` context (`useQueryClient()`, a hook,
 * which can't be called from inside this effect), not a module-level export,
 * so there is no way to auto-detect it here.
 */
export function useQueryMonitor(queryKeys: string[][], queryClient?: QueryClientMonitorInstance): void {
  useEffect(() => {
    if (!queryClient) return
    const client = queryClient

    let interval: ReturnType<typeof setInterval> | null = null

    function poll(): void {
      queryKeys.forEach((queryKey) => {
        const query = client.getQueryState(queryKey)
        if (query) {
          sendQueryData({
            queryKey: queryKey.join(':'),
            status: query.status,
            data: query.data,
            error: query.error,
            dataUpdatedAt: query.dataUpdatedAt,
            errorUpdatedAt: query.errorUpdatedAt,
            fetchStatus: query.fetchStatus,
          })
        }
      })
    }

    function install(): void {
      if (interval) return // already installed
      interval = setInterval(poll, 1000)
    }

    function uninstall(): void {
      if (!interval) return
      clearInterval(interval)
      interval = null
    }

    // `hakkaBridge.connect()` typically resolves after this effect has already
    // run (see e.g. `SettingsViewModel`'s `loadSettings().then(() => connect())`),
    // so a one-time `isConnected` check at mount misses the connection entirely
    // and polling never starts. Subscribing to `onStatus` re-checks on every
    // transition, including a later connect — mirrors `storage.ts`'s monitors.
    const unsubscribeStatus = hakkaBridge.onStatus(() => {
      if (hakkaBridge.isConnected) install()
      else uninstall()
    })

    return () => {
      unsubscribeStatus()
      uninstall()
    }
  }, [queryClient, queryKeys])
}

// Coalescing window for `useReactQueryDevTools`'s cache-subscribe handler —
// matches `useNetworkLogs`'s `DEFAULT_UPDATE_INTERVAL_MS`. Without this, a
// single cache event (fired per fetch-stage transition, per query) triggers a
// full re-serialize of the entire cache, unthrottled.
const DEVTOOLS_THROTTLE_MS = 250

/**
 * Full React Query devtools integration — subscribes to cache changes
 * and sends all query states to the desktop app.
 *
 * Must be rendered inside a `<QueryClientProvider>` and passed that client —
 * see `useQueryMonitor`'s doc comment for why there is no auto-detect fallback.
 */
export function useReactQueryDevTools(queryClient?: QueryClientMonitorInstance): void {
  useEffect(() => {
    if (!queryClient) return
    const client = queryClient

    const sendAllQueries = () => {
      const queries = client.getQueryCache().getAll()
      queries.forEach((query) => {
        sendQueryData({
          queryKey: query.queryKey.map(String).join(':'),
          status: query.state.status,
          data: query.state.data,
          error: query.state.error,
          dataUpdatedAt: query.state.dataUpdatedAt,
          errorUpdatedAt: query.state.errorUpdatedAt,
          fetchStatus: query.state.fetchStatus,
        })
      })
    }

    let unsubscribeCache: (() => void) | null = null
    let pendingRefresh: ReturnType<typeof setTimeout> | null = null

    function install(): void {
      if (unsubscribeCache) return // already installed
      sendAllQueries()
      unsubscribeCache = client.getQueryCache().subscribe(() => {
        if (pendingRefresh !== null) return
        pendingRefresh = setTimeout(() => {
          pendingRefresh = null
          sendAllQueries()
        }, DEVTOOLS_THROTTLE_MS)
      })
    }

    function uninstall(): void {
      if (unsubscribeCache) {
        unsubscribeCache()
        unsubscribeCache = null
      }
      if (pendingRefresh !== null) {
        clearTimeout(pendingRefresh)
        pendingRefresh = null
      }
    }

    // Same connect-after-mount race as `useQueryMonitor` above — re-check on
    // every status transition instead of only once at mount.
    const unsubscribeStatus = hakkaBridge.onStatus(() => {
      if (hakkaBridge.isConnected) install()
      else uninstall()
    })

    return () => {
      unsubscribeStatus()
      uninstall()
    }
  }, [queryClient])
}
