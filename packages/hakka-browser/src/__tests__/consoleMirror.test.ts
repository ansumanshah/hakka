import { Hakka } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

import { enableConsoleMirror, disableConsoleMirror, isConsoleMirrorEnabled, mirrorToConsole } from '../consoleMirror'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: `req-${Math.random().toString(36).slice(2)}`,
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    endTime: Date.now() + 120,
    duration: 120,
    requestHeaders: {},
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{"ok":true}',
    responseBodySize: 11,
    ...overrides,
  }
}

beforeAll(() => {
  // Hakka must be started for onRequest subscriptions to work.
  if (!(Hakka as unknown as { running: boolean }).running) {
    Hakka.start({ mode: 'js' })
  }
})

beforeEach(() => {
  Hakka.clearLogs()
  disableConsoleMirror()
})

afterEach(() => {
  disableConsoleMirror()
  vi.restoreAllMocks()
})

describe('mirrorToConsole', () => {
  it('calls console.groupCollapsed with method, status and path', () => {
    const spy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})

    mirrorToConsole(makeRequest({ method: 'POST', status: 201, url: 'https://api.example.com/items' }))

    expect(spy).toHaveBeenCalled()
    const firstArg = spy.mock.calls[0]![0] as string
    expect(firstArg).toContain('%c')
    expect(firstArg).toContain('POST')
    expect(firstArg).toContain('201')
  })

  it('calls console.table with url, method, status, duration', () => {
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})

    const req = makeRequest({ method: 'GET', status: 200, duration: 55 })
    mirrorToConsole(req)

    expect(tableSpy).toHaveBeenCalled()
    const tableArg = tableSpy.mock.calls[0]![0] as Record<string, unknown>
    expect(tableArg.url).toBe(req.url)
    expect(tableArg.method).toBe('GET')
    expect(tableArg.status).toBe(200)
    expect(String(tableArg.duration)).toContain('55')
  })

  it('includes timing group when timing data is present', () => {
    const collapsedSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})

    mirrorToConsole(
      makeRequest({
        timing: { dnsMs: 5, connectMs: 10, ttfbMs: 80, downloadMs: 20 },
      }),
    )

    // One groupCollapsed for the main row, one for Timing.
    expect(collapsedSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('omits timing group when timing is absent', () => {
    const collapsedSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})

    // Pass an empty responseHeaders so the headers group is also skipped.
    mirrorToConsole(makeRequest({ timing: undefined, responseHeaders: {} }))

    // Only the main groupCollapsed call — no Timing or headers sub-groups.
    expect(collapsedSpy.mock.calls.length).toBe(1)
  })

  it('does not throw for a request with no status (pending)', () => {
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})

    expect(() => mirrorToConsole(makeRequest({ status: undefined, duration: undefined }))).not.toThrow()
  })
})

describe('enableConsoleMirror / disableConsoleMirror', () => {
  it('isConsoleMirrorEnabled returns false before enabling', () => {
    expect(isConsoleMirrorEnabled()).toBe(false)
  })

  it('isConsoleMirrorEnabled returns true after enabling', () => {
    enableConsoleMirror()
    expect(isConsoleMirrorEnabled()).toBe(true)
  })

  it('returns false after disabling', () => {
    enableConsoleMirror()
    disableConsoleMirror()
    expect(isConsoleMirrorEnabled()).toBe(false)
  })

  it('calling enable twice does not create duplicate subscriptions', () => {
    const t1 = enableConsoleMirror()
    const t2 = enableConsoleMirror()

    expect(t1).toBe(t2)
    disableConsoleMirror()
  })

  it('mirrors a completed request to the console when enabled', () => {
    const collapsedSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})

    enableConsoleMirror()
    const req = makeRequest({ method: 'DELETE', status: 204 })
    Hakka.ingest(req)

    // The subscription fires synchronously.
    expect(collapsedSpy).toHaveBeenCalled()
    const firstArg = collapsedSpy.mock.calls[0]![0] as string
    expect(firstArg).toContain('DELETE')
    expect(firstArg).toContain('204')
  })

  it('does not mirror a pending request (no status yet)', () => {
    const collapsedSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})

    enableConsoleMirror()
    Hakka.ingest(makeRequest({ status: undefined, endTime: undefined, duration: undefined }))

    expect(collapsedSpy).not.toHaveBeenCalled()
  })

  it('stops mirroring after disable', () => {
    const collapsedSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})

    enableConsoleMirror()
    disableConsoleMirror()

    Hakka.ingest(makeRequest({ status: 200 }))

    expect(collapsedSpy).not.toHaveBeenCalled()
  })
})
