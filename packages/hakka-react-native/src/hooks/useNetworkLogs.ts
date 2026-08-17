import { Hakka } from 'hakka-core'
import type { NetworkRequest, HttpMethod } from 'hakka-core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface FilterOptions {
  method?: HttpMethod
  status?: number
  search?: string
}

interface UseNetworkLogsOptions {
  enabled?: boolean
  limit?: number
  updateIntervalMs?: number
}

export interface UseNetworkLogsResult {
  logs: NetworkRequest[]
  count: number
  totalCount: number
  filter: (options: FilterOptions) => void
  clearLogs: () => void
}

const DEFAULT_UPDATE_INTERVAL_MS = 250

function readLogs(limit?: number): NetworkRequest[] {
  const logs = Hakka.getLogs()
  return typeof limit === 'number' && limit > 0 ? logs.slice(0, limit) : logs
}

/**
 * Subscribe to network logs from Hakka storage.
 * Updates are coalesced so high-volume capture does not re-render the monitor
 * for every request.
 */
export function useNetworkLogs(options: UseNetworkLogsOptions = {}): UseNetworkLogsResult {
  const { enabled = true, limit, updateIntervalMs = DEFAULT_UPDATE_INTERVAL_MS } = options
  const [logs, setLogs] = useState<NetworkRequest[]>(() => readLogs(limit))
  const [totalCount, setTotalCount] = useState(() => Hakka.getLogCount())
  const [filterOpts, setFilterOpts] = useState<FilterOptions>({})
  const pendingRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(() => {
    setLogs(readLogs(limit))
    setTotalCount(Hakka.getLogCount())
  }, [limit])

  useEffect(() => {
    if (!enabled) return undefined

    refresh()
    const unsub = Hakka.subscribe(() => {
      if (pendingRefreshRef.current !== null) return
      pendingRefreshRef.current = setTimeout(
        () => {
          pendingRefreshRef.current = null
          refresh()
        },
        Math.max(16, updateIntervalMs),
      )
    })
    return () => {
      unsub()
      if (pendingRefreshRef.current !== null) {
        clearTimeout(pendingRefreshRef.current)
        pendingRefreshRef.current = null
      }
    }
  }, [enabled, refresh, updateIntervalMs])

  const filtered = useMemo(() => {
    let filteredLogs = logs
    if (filterOpts.method) {
      const m = filterOpts.method
      filteredLogs = filteredLogs.filter((r: NetworkRequest) => r.method === m)
    }
    if (filterOpts.status !== undefined) {
      const s = filterOpts.status
      filteredLogs = filteredLogs.filter((r: NetworkRequest) => r.status === s)
    }
    if (filterOpts.search) {
      const q = filterOpts.search.toLowerCase()
      filteredLogs = filteredLogs.filter((r: NetworkRequest) => r.url.toLowerCase().includes(q))
    }
    return filteredLogs
  }, [logs, filterOpts])

  const filter = useCallback((options: FilterOptions) => {
    setFilterOpts(options)
  }, [])

  const clearLogs = useCallback(() => {
    Hakka.clearLogs()
    setLogs([])
    setTotalCount(0)
  }, [])

  return { logs: filtered, count: filtered.length, totalCount, filter, clearLogs }
}
