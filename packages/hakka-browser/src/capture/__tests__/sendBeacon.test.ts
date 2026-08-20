import type { NetworkRequest } from 'hakka-core'
import { configureBodyRedaction } from 'hakka-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StoreClient } from '../../worker'
import { enableSendBeaconCapture } from '../sendBeacon'

/**
 * `sendBeacon` is the analytics path, which is exactly where session tokens
 * and user identifiers travel — so the redaction-boundary invariant from ADR
 * 0004 (e) applies here as much as it does to fetch. It did not hold: this
 * capture built its record from the raw payload.
 */

const SECRET = 'sess-9f2b1c-live'

let restore: (() => void) | null = null

afterEach(() => {
  restore?.()
  restore = null
  configureBodyRedaction([])
})

/** Collects whatever the capture hands the store; only `ingest` is exercised. */
function fakeClient(): { client: StoreClient; records: NetworkRequest[] } {
  const records: NetworkRequest[] = []
  const client = { ingest: (r: NetworkRequest) => records.push(r) } as unknown as StoreClient
  return { client, records }
}

function stubNavigator(returns = true): ReturnType<typeof vi.fn> {
  const original = vi.fn(() => returns)
  // happy-dom does not implement sendBeacon, so install one to patch over.
  ;(navigator as unknown as { sendBeacon: unknown }).sendBeacon = original
  return original
}

describe('sendBeacon capture', () => {
  it('captures the url, payload, and a synthetic 202', () => {
    stubNavigator()
    const { client, records } = fakeClient()
    restore = enableSendBeaconCapture(client)

    navigator.sendBeacon('https://metrics.example.com/e', '{"event":"click"}')

    expect(records).toHaveLength(1)
    expect(records[0]?.url).toBe('https://metrics.example.com/e')
    expect(records[0]?.method).toBe('POST')
    expect(records[0]?.status).toBe(202)
    expect(records[0]?.requestBody).toBe('{"event":"click"}')
  })

  it('redacts a configured body field before the record is built', () => {
    configureBodyRedaction(['token'])
    stubNavigator()
    const { client, records } = fakeClient()
    restore = enableSendBeaconCapture(client)

    navigator.sendBeacon('https://metrics.example.com/e', `{"event":"click","token":"${SECRET}"}`)

    expect(records[0]?.requestBody).not.toContain(SECRET)
    expect(records[0]?.requestBody).toContain('[REDACTED]')
  })

  it('reports the size of what was sent, not of the redacted copy', () => {
    configureBodyRedaction(['token'])
    stubNavigator()
    const { client, records } = fakeClient()
    restore = enableSendBeaconCapture(client)

    const payload = `{"token":"${SECRET}"}`
    navigator.sendBeacon('https://metrics.example.com/e', payload)

    expect(records[0]?.requestBodySize).toBe(payload.length)
  })

  it('still forwards to the original sendBeacon and returns its result', () => {
    const original = stubNavigator(false)
    const { client, records } = fakeClient()
    restore = enableSendBeaconCapture(client)

    const result = navigator.sendBeacon('https://metrics.example.com/e', 'x')

    expect(result).toBe(false)
    expect(original).toHaveBeenCalledTimes(1)
    expect(records[0]?.status).toBe(0)
    expect(records[0]?.error).toBe('sendBeacon returned false')
  })

  it('stops capturing after teardown but keeps beacons working', () => {
    // Teardown restores a *bound* copy of the original, not the same function
    // reference, so assert on behaviour: beacons still send, nothing is
    // captured.
    const original = stubNavigator()
    const { client, records } = fakeClient()
    const off = enableSendBeaconCapture(client)
    off()

    const result = navigator.sendBeacon('https://metrics.example.com/e', 'x')

    expect(result).toBe(true)
    expect(original).toHaveBeenCalledTimes(1)
    expect(records).toHaveLength(0)
  })
})
