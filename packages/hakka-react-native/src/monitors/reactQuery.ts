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

interface ReactQueryModuleLike {
  getQueryClient?: () => QueryClientMonitorInstance | null
}

function sendQueryData(queryData: QueryData): void {
  hakkaBridge.emit('queries:update', { ...queryData, timestamp: Date.now() })
}

/**
 * Monitor specific queries by key and send periodic snapshots.
 */
export function useQueryMonitor(queryKeys: string[][], queryClient?: QueryClientMonitorInstance): void {
  useEffect(() => {
    if (!hakkaBridge.isConnected) return

    let client = queryClient
    if (!client) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const rq = require('@tanstack/react-query') as ReactQueryModuleLike
        client = rq.getQueryClient?.() ?? undefined
      } catch {
        return
      }
    }
    if (!client) return

    const interval = setInterval(() => {
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
    }, 1000)

    return () => clearInterval(interval)
  }, [queryClient, queryKeys])
}

/**
 * Full React Query devtools integration — subscribes to cache changes
 * and sends all query states to the desktop app.
 *
 * Must be rendered inside a `<QueryClientProvider>`. Pass your own
 * `queryClient` if you're not using the default provider.
 */
export function useReactQueryDevTools(queryClient?: QueryClientMonitorInstance): void {
  useEffect(() => {
    if (!hakkaBridge.isConnected) return

    let client = queryClient
    if (!client) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const rq = require('@tanstack/react-query') as ReactQueryModuleLike
        // useQueryClient is a hook and can't be called here — fall back to the module-level accessor.
        client = rq.getQueryClient?.() ?? undefined
      } catch {
        return
      }
    }
    if (!client) return

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

    sendAllQueries()

    const unsubscribe = client.getQueryCache().subscribe(() => {
      sendAllQueries()
    })

    return unsubscribe
  }, [queryClient])
}
