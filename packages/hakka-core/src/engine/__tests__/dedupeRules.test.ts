import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { RingBuffer } from '../../storage/RingBuffer'
import { findDuplicateRequest } from '../dedupeRules'

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
