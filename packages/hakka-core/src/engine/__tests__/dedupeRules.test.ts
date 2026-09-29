import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { RingBuffer } from '../../storage/RingBuffer'
import { findDuplicateRequest, mergeDuplicateRequest } from '../dedupeRules'
import { Hakka } from '../HakkaFacade'

function req(id: string, over: Partial<NetworkRequest> = {}): NetworkRequest {
  return { id, url: 'https://api.example.com/x', method: 'GET', source: 'fetch', startTime: 1000, ...over }
}

describe('findDuplicateRequest', () => {
  test('same url/method from a different source within the window IS a duplicate', () => {
    const rb = new RingBuffer(10)
    rb.add(req('a', { source: 'native', startTime: 1000 }))
    const incoming = req('b', { source: 'fetch', startTime: 1020 })
    expect(findDuplicateRequest(rb, incoming)?.id).toBe('a')
  })

  // Regression: a URL-only match previously merged genuinely distinct concurrent requests
  // (e.g. a GET and a POST landing on the same endpoint within the dedup window), losing one
  // of them from the inspector.
  test('same url but DIFFERENT method from a different source is NOT a duplicate', () => {
    const rb = new RingBuffer(10)
    rb.add(req('a', { method: 'GET', source: 'native', startTime: 1000 }))
    const incoming = req('b', { method: 'POST', source: 'fetch', startTime: 1020 })
    expect(findDuplicateRequest(rb, incoming)).toBeUndefined()
  })

  test('same id always matches regardless of method (exact-id replay path)', () => {
    const rb = new RingBuffer(10)
    rb.add(req('shared-id', { method: 'GET', startTime: 1000 }))
    const incoming = req('shared-id', { method: 'POST', startTime: 1020 })
    expect(findDuplicateRequest(rb, incoming)?.id).toBe('shared-id')
  })

  test('same url/method but same source is NOT a duplicate', () => {
    const rb = new RingBuffer(10)
    rb.add(req('a', { source: 'fetch', startTime: 1000 }))
    const incoming = req('b', { source: 'fetch', startTime: 1020 })
    expect(findDuplicateRequest(rb, incoming)).toBeUndefined()
  })

  test('outside the dedup window is NOT a duplicate even with matching url/method/source pair', () => {
    const rb = new RingBuffer(10)
    rb.add(req('a', { source: 'native', startTime: 1000 }))
    const incoming = req('b', { source: 'fetch', startTime: 1200 }) // 200ms > DEDUP_WINDOW_MS (100)
    expect(findDuplicateRequest(rb, incoming)).toBeUndefined()
  })
})

describe('same-id updates and measured timing enrichment', () => {
  test('a delayed body update finds its original record beyond the newest twenty', () => {
    const logs = new RingBuffer(30)
    logs.add(req('slow'))
    for (let i = 0; i < 25; i++) logs.add(req(`later-${i}`))
    expect(findDuplicateRequest(logs, req('slow', { responseBody: 'completed' }))?.id).toBe('slow')
  })

  test('fetch/XHR body updates preserve measured zero phases and real download timings', () => {
    for (const source of ['fetch', 'xhr'] as const) {
      const measured = req('same', {
        source,
        timing: { dnsMs: 0, connectMs: 0, ttfbMs: 4, downloadMs: 6, total: 2 },
        ttfbMs: 4,
        downloadMs: 6,
      })
      const body = req('same', {
        source,
        responseBody: 'done',
        timing: { dnsMs: undefined, connectMs: undefined, ttfbMs: 2, downloadMs: 1, total: 10 },
        ttfbMs: 2,
        downloadMs: 1,
      })
      const merged = mergeDuplicateRequest(measured, body)
      expect(merged.responseBody).toBe('done')
      expect(merged.timing).toEqual({ dnsMs: 0, connectMs: 0, ttfbMs: 4, downloadMs: 6, total: 10 })
      expect(merged.ttfbMs).toBe(4)
      expect(merged.downloadMs).toBe(6)
    }
  })

  test('ResourceTiming enrichment survives a later body ingest and can also arrive after the body', () => {
    const previousConfig = Hakka.getConfig()
    Hakka.stop()
    Hakka.setStorageAdapter(null)
    Hakka.clearLogs()
    Hakka.start({ mode: 'store', maxRequests: 100, maxAge: 0 })
    try {
      Hakka.ingest(req('same', { timing: { ttfbMs: 3, total: 20 }, ttfbMs: 3 }))
      Hakka.update({ id: 'same', dnsMs: 5, timing: { dnsMs: 5, ttfbMs: 10 } })
      Hakka.ingest(req('same', { responseBody: 'complete', timing: { ttfbMs: 3, downloadMs: 20, total: 40 } }))
      expect(Hakka.getLog('same')?.timing).toEqual({ dnsMs: 5, ttfbMs: 10, downloadMs: 20, total: 40 })
      expect(Hakka.getLog('same')?.ttfbMs).toBe(10)
      expect(Hakka.getLog('same')?.responseBody).toBe('complete')
      Hakka.update({ id: 'same', timing: { dnsMs: 6, ttfbMs: 12, downloadMs: 22 } })
      expect(Hakka.getLog('same')?.timing).toEqual({ dnsMs: 6, ttfbMs: 12, downloadMs: 22, total: 40 })
    } finally {
      Hakka.stop()
      Hakka.clearLogs()
      Hakka.configure(previousConfig)
    }
  })

  test('ordinary fetch updates still improve initial download zero to actual download', () => {
    const merged = mergeDuplicateRequest(
      req('same', { timing: { downloadMs: 0 } }),
      req('same', { timing: { downloadMs: 8 }, downloadMs: 8 }),
    )
    expect(merged.timing?.downloadMs).toBe(8)
    expect(merged.downloadMs).toBe(8)
  })

  test('new measured updates and native updates still replace older timing', () => {
    for (const source of ['fetch', 'native'] as const) {
      const merged = mergeDuplicateRequest(
        req('same', { source, timing: { dnsMs: 1, downloadMs: 2 } }),
        req('same', { source, timing: { dnsMs: 3, downloadMs: 4 } }),
      )
      expect(merged.timing).toEqual({ dnsMs: 3, downloadMs: 4 })
    }
  })

  test('native source preference still wins over browser enrichment', () => {
    const browser = req('browser', { timing: { dnsMs: 0, downloadMs: 2 } })
    const native = req('native', { source: 'native', timing: { dnsMs: 4, downloadMs: 8 } })
    for (const merged of [mergeDuplicateRequest(browser, native), mergeDuplicateRequest(native, browser)]) {
      expect(merged.source).toBe('native')
      expect(merged.timing).toEqual(native.timing)
    }
  })
})
