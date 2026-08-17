import type { NetworkRequest } from 'hakka-core'
import { exportHarString as toHAR } from 'hakka-core'
import { useCallback, useEffect, useRef } from 'react'
import { Alert, Share } from 'react-native'

import { copyToClipboard } from '../utils/clipboard'

/**
 * useShakeToShare — shake to copy HAR to clipboard + open share sheet.
 * Accelerometer isn't guaranteed available in all RN setups, so this exposes
 * `triggerShare()` for any shake mechanism (detection hook, dev menu,
 * triple-shake) to call, rather than owning detection itself.
 */
export function useShakeToShare(logs: NetworkRequest[]): {
  triggerShare: () => void
} {
  // Keep logs ref so callback always has fresh data
  const logsRef = useRef(logs)
  useEffect(() => {
    logsRef.current = logs
  }, [logs])

  const triggerShare = useCallback(() => {
    const currentLogs = logsRef.current
    if (currentLogs.length === 0) {
      Alert.alert('No requests', 'Nothing to export yet — make some network requests first.')
      return
    }

    const har = toHAR(currentLogs)

    copyToClipboard(har).catch(() => {
      // Clipboard may fail silently in some environments.
    })

    Share.share(
      {
        message: har,
        title: `Hakka HAR Export — ${currentLogs.length} request${currentLogs.length === 1 ? '' : 's'}`,
      },
      { dialogTitle: 'Share HAR' },
    ).catch(() => {
      // Share cancelled or failed — clipboard copy already done
    })
  }, [])

  return { triggerShare }
}
