import { Hakka, configureBodyRedaction } from 'hakka-core'
import type { HakkaConfig } from 'hakka-core'
import { useCallback, useEffect, useState } from 'react'

export interface UseHakkaOptions extends HakkaConfig {
  /**
   * JSON body field names to redact (case-insensitive) before bodies reach the store,
   * e.g. ['password', 'token']. Headers are redacted via `redactHeaders`.
   */
  redactBodyFields?: string[]
}

interface UseHakkaResult {
  isActive: boolean
  isReady: boolean
  config: Required<HakkaConfig>
  toggle: () => void
}

/**
 * Start/stop/config Hakka via hook.
 * Auto-starts on mount, auto-stops on unmount.
 */
export function useHakka(config?: UseHakkaOptions): UseHakkaResult {
  const [isActive, setIsActive] = useState(Hakka.isActive)

  useEffect(() => {
    if (config) {
      const { redactBodyFields, ...hakkaConfig } = config
      if (redactBodyFields?.length) configureBodyRedaction(redactBodyFields)
      if (Object.keys(hakkaConfig).length > 0) Hakka.configure(hakkaConfig)
    }
    if (!Hakka.isActive) {
      Hakka.start()
      setIsActive(true)
    }
    return () => {
      Hakka.stop()
      setIsActive(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(() => {
    if (Hakka.isActive) {
      Hakka.stop()
      setIsActive(false)
    } else {
      Hakka.start()
      setIsActive(true)
    }
  }, [])

  return { isActive, isReady: isActive, config: Hakka.getConfig() as Required<HakkaConfig>, toggle }
}
