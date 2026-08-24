import { Hakka, configureBodyRedaction } from 'hakka-core'
import type { HakkaConfig } from 'hakka-core'
import { useCallback, useEffect, useRef, useState } from 'react'

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
 *
 * `Hakka` is a process-wide singleton, so more than one component may call
 * this hook (or start it directly) concurrently. Only the instance that
 * actually flipped it from inactive to active stops it on unmount — an
 * instance that found capture already running (started elsewhere) leaves it
 * running for whoever else still needs it.
 */
export function useHakka(config?: UseHakkaOptions): UseHakkaResult {
  const [isActive, setIsActive] = useState(Hakka.isActive)
  const startedByThisInstance = useRef(false)

  useEffect(() => {
    if (config) {
      const { redactBodyFields, ...hakkaConfig } = config
      if (redactBodyFields?.length) configureBodyRedaction(redactBodyFields)
      if (Object.keys(hakkaConfig).length > 0) Hakka.configure(hakkaConfig)
    }
    if (!Hakka.isActive) {
      Hakka.start()
      startedByThisInstance.current = true
      // Hakka.start() mutates the external singleton on mount; there is no
      // status event to subscribe to, so this setState IS the sync point.
      // oxlint-disable-next-line react/set-state-in-effect
      setIsActive(true)
    }
    return () => {
      if (startedByThisInstance.current) {
        Hakka.stop()
        startedByThisInstance.current = false
      }
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
