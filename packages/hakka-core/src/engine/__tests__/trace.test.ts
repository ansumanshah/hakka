import { afterEach, describe, expect, it } from 'bun:test'

import {
  HAKKA_TRACE_HEADER,
  configureTrace,
  currentTraceId,
  newTraceId,
  resolveOutgoingTrace,
  setTraceProvider,
  shouldPropagateTrace,
} from '../trace'

function stubLocation(origin: string): void {
  ;(globalThis as Record<string, unknown>).location = { href: `${origin}/`, origin }
}

afterEach(() => {
  configureTrace({ enabled: false, propagateOrigins: undefined })
  setTraceProvider(null)
  delete (globalThis as Record<string, unknown>).location
})

describe('trace', () => {
  it('exposes the wire header name', () => {
    expect(HAKKA_TRACE_HEADER).toBe('x-hakka-trace')
  })

  it('newTraceId is non-empty and unique', () => {
    const a = newTraceId()
    const b = newTraceId()
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('never propagates while disabled (default)', () => {
    stubLocation('https://app.test')
    expect(shouldPropagateTrace('https://app.test/api')).toBe(false)
  })

  it('propagates same-origin when enabled, not cross-origin', () => {
    stubLocation('https://app.test')
    configureTrace({ enabled: true })
    expect(shouldPropagateTrace('https://app.test/api')).toBe(true)
    expect(shouldPropagateTrace('https://other.test/api')).toBe(false)
  })

  it('propagates allowlisted cross-origin', () => {
    stubLocation('https://app.test')
    configureTrace({ enabled: true, propagateOrigins: ['https://api.test'] })
    expect(shouldPropagateTrace('https://api.test/x')).toBe(true)
  })

  it('resolveOutgoingTrace originates a new id for client same-origin only', () => {
    stubLocation('https://app.test')
    configureTrace({ enabled: true })
    expect(resolveOutgoingTrace('https://app.test/api')).toBeTruthy()
    expect(resolveOutgoingTrace('https://elsewhere.test/x')).toBeUndefined()
  })

  it('resolveOutgoingTrace inherits + forwards the provider id (server context)', () => {
    setTraceProvider(() => 'T-INHERITED')
    expect(currentTraceId()).toBe('T-INHERITED')
    // No location (server) and disabled, yet it still forwards the inherited id.
    expect(resolveOutgoingTrace('https://upstream.test/x')).toBe('T-INHERITED')
  })
})
