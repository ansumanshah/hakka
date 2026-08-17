/**
 * Timing — per-request timing waterfall.
 *
 * Regression coverage for two bugs found in the 4-platform UI audit:
 *   1. The component read legacy `NetworkTiming` field names (dnsLookup,
 *      tlsHandshake, firstByte, contentDownload) that neither RN capture path
 *      (`js` fetch/XHR monkey-patch nor `native` OkHttp/URLSession) ever
 *      populates — every phase was silently dropped and the panel always
 *      fell back to "No timing data captured", even for requests that DID
 *      carry timing. Fixed by reading the canonical `dnsMs/connectMs/tlsMs/
 *      ttfbMs/downloadMs` fields nativeProtocol.ts and core's capture/fetch.ts
 *      actually write.
 *   2. RN rendered only 4 phases (DNS/TLS/TTFB/Download), missing the
 *      TCP/connect phase every other platform (web, iOS, Android) shows —
 *      `native`-mode capture (OkHttp EventListener / URLSession delegate)
 *      does observe connect time via `timing.connectMs` (see
 *      packages/hakka-core/src/engine/nativeProtocol.ts), so the phase is real,
 *      not fabricated.
 */
import type { NetworkRequest } from 'hakka-core'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

import { Timing } from '../Timing'

// react-test-renderer's `act()` needs this flag set or every update emits an
// "environment not configured to support act(...)" console warning (same
// setup as Header.test.tsx).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Timing.tsx pulls in `./helpers`, which imports the icons barrel — that
// barrel reaches into react-native-svg -> RN's Touchable mixin, which this
// package's minimal react-native test mock doesn't provide. Icons are
// irrelevant to timing-phase logic, so stub the one helpers.tsx uses (same
// pattern as Header.test.tsx).
jest.mock('../../../icons', () => ({ Copy: () => null }))

function makeRequest(timing?: NetworkRequest['timing']): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    endTime: Date.now() + 100,
    duration: 100,
    timing,
  }
}

function labels(root: TestRenderer.ReactTestRenderer): string[] {
  return root.root.findAllByType('Text' as never).map((n) => String(n.props.children).trim())
}

describe('Timing', () => {
  it('renders all five phases — including TCP — for a native-mode capture with full timing', () => {
    const request = makeRequest({
      dnsMs: 10,
      connectMs: 20,
      tlsMs: 30,
      ttfbMs: 40,
      downloadMs: 50,
    })
    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(<Timing request={request} />)
    })

    const text = labels(root).join(' | ')
    expect(text).toContain('DNS Lookup')
    expect(text).toContain('TCP Handshake')
    expect(text).toContain('TLS Handshake')
    expect(text).toContain('Waiting (TTFB)')
    expect(text).toContain('Content Download')
    expect(text).not.toContain('No timing data')
  })

  it('renders only the observable phases for a js-mode capture (dns/connect/tls absent)', () => {
    // Matches packages/hakka-core/src/capture/fetch.ts: js-mode fetch/XHR can only
    // observe ttfbMs/downloadMs — dnsMs/connectMs/tlsMs come back undefined.
    const request = makeRequest({
      dnsMs: undefined,
      connectMs: undefined,
      tlsMs: undefined,
      ttfbMs: 15,
      downloadMs: 25,
    })
    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(<Timing request={request} />)
    })

    const text = labels(root).join(' | ')
    expect(text).not.toContain('DNS Lookup')
    expect(text).not.toContain('TCP Handshake')
    expect(text).not.toContain('TLS Handshake')
    expect(text).toContain('Waiting (TTFB)')
    expect(text).toContain('Content Download')
  })

  it('falls back to the empty state when there is no timing data at all', () => {
    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(<Timing request={makeRequest(undefined)} />)
    })
    expect(labels(root).join(' | ')).toContain('No timing data captured for this request.')
  })
})
