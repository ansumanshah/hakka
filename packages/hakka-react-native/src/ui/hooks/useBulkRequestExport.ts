import {
  exportHarString,
  exportPostmanString,
  networkRequestToRecord,
  recordsToOtelJson,
  type NetworkRequest,
} from 'hakka-core'
import { useCallback } from 'react'
import { Share } from 'react-native'

export interface BulkRequestExport {
  exportHar: () => void
  exportPostman: () => void
  exportOtel: () => void
}

/**
 * Multi-select export actions (Filters' select-mode bulk bar): HAR, Postman
 * collection, OTel JSON — each shared via the OS share sheet. A user
 * cancelling the share sheet rejects the promise; that's swallowed, not an
 * error state.
 */
export function useBulkRequestExport(logs: NetworkRequest[], selectedIds: Set<string>): BulkRequestExport {
  const resolveSelectedRequests = useCallback((): NetworkRequest[] => {
    return logs.filter((r) => selectedIds.has(r.id))
  }, [logs, selectedIds])

  const handleBulkExportHar = useCallback(async () => {
    const reqs = resolveSelectedRequests()
    if (reqs.length === 0) return
    try {
      const har = exportHarString(reqs)
      await Share.share({ message: har, title: `Network Logs (${reqs.length} requests).har` })
    } catch {
      /* ignore user cancel */
    }
  }, [resolveSelectedRequests])

  const handleBulkExportPostman = useCallback(async () => {
    const reqs = resolveSelectedRequests()
    if (reqs.length === 0) return
    try {
      const json = exportPostmanString(reqs)
      await Share.share({ message: json, title: `Postman Collection (${reqs.length} requests).json` })
    } catch {
      /* ignore user cancel */
    }
  }, [resolveSelectedRequests])

  const handleBulkExportOtel = useCallback(async () => {
    const reqs = resolveSelectedRequests()
    if (reqs.length === 0) return
    try {
      const records = reqs.map((r) => networkRequestToRecord(r))
      const otel = JSON.stringify(recordsToOtelJson(records), null, 2)
      await Share.share({ message: otel, title: `OTel (${reqs.length} requests).json` })
    } catch {
      /* ignore user cancel */
    }
  }, [resolveSelectedRequests])

  const exportHar = useCallback(() => {
    void handleBulkExportHar()
  }, [handleBulkExportHar])

  const exportPostman = useCallback(() => {
    void handleBulkExportPostman()
  }, [handleBulkExportPostman])

  const exportOtel = useCallback(() => {
    void handleBulkExportOtel()
  }, [handleBulkExportOtel])

  return { exportHar, exportPostman, exportOtel }
}
