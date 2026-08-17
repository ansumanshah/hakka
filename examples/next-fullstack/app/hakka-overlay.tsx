'use client'
import { startHakkaClient } from 'hakka-node/next/client'
/**
 * Starts the Hakka overlay from the normal client bundle. Dynamic imports work
 * here (webpack emits hakka-browser as an async chunk), unlike inside Next's
 * `instrumentation-client.ts` pipeline — see the hakka-node README.
 */
import { useEffect } from 'react'

export function HakkaOverlay() {
  useEffect(() => {
    startHakkaClient()
  }, [])
  return null
}
