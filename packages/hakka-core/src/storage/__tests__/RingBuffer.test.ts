import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { RingBuffer } from '../RingBuffer'

function req(id: string, over: Partial<NetworkRequest> = {}): NetworkRequest {
  return { id, url: `https://example.com/${id}`, method: 'GET', startTime: 1000, ...over }
}

describe('RingBuffer — basics', () => {
  test('add then get by id', () => {
    const rb = new RingBuffer(4)
    rb.add(req('a'))
    expect(rb.get('a')?.id).toBe('a')
    expect(rb.get('missing')).toBeUndefined()
    expect(rb.size).toBe(1)
  })

  test('getAll returns newest-first', () => {
    const rb = new RingBuffer(4)
    rb.add(req('a'))
    rb.add(req('b'))
    rb.add(req('c'))
    expect(rb.getAll().map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  test('getRecent yields newest-first, bounded by n and size', () => {
    const rb = new RingBuffer(10)
    for (const id of ['a', 'b', 'c', 'd']) rb.add(req(id))
    expect([...rb.getRecent(2)].map((r) => r.id)).toEqual(['d', 'c'])
    expect([...rb.getRecent(99)].map((r) => r.id)).toEqual(['d', 'c', 'b', 'a'])
  })
})

describe('RingBuffer — eviction', () => {
  test('drops the oldest entry when over capacity (get + getAll + size)', () => {
    const rb = new RingBuffer(3)
    for (const id of ['a', 'b', 'c', 'd']) rb.add(req(id))
    expect(rb.size).toBe(3)
    expect(rb.get('a')).toBeUndefined()
    expect(rb.getAll().map((r) => r.id)).toEqual(['d', 'c', 'b'])
  })
})

describe('RingBuffer — update (O(1) slot map)', () => {
  test('update replaces in place and is reflected by get + getAll', () => {
    const rb = new RingBuffer(4)
    rb.add(req('a'))
    rb.add(req('b'))
    expect(rb.update(req('a', { status: 200 }))).toBe(true)
    expect(rb.get('a')?.status).toBe(200)
    expect(rb.getAll().find((r) => r.id === 'a')?.status).toBe(200)
  })

  test('update returns false for an unknown id', () => {
    const rb = new RingBuffer(4)
    rb.add(req('a'))
    expect(rb.update(req('ghost', { status: 500 }))).toBe(false)
  })

  test('update targets the correct slot after wrap-around eviction', () => {
    const rb = new RingBuffer(3)
    for (const id of ['a', 'b', 'c']) rb.add(req(id))
    rb.add(req('d')) // evicts a; slot 0 reused for d, head wraps

    expect(rb.get('a')).toBeUndefined()
    expect(rb.update(req('a', { status: 500 }))).toBe(false) // evicted → not updatable

    expect(rb.update(req('d', { status: 200 }))).toBe(true)
    expect(rb.update(req('c', { status: 201 }))).toBe(true)
    expect(rb.get('d')?.status).toBe(200)
    expect(rb.get('c')?.status).toBe(201)
    expect(rb.getAll().map((r) => r.id)).toEqual(['d', 'c', 'b'])
  })
})

describe('RingBuffer — age retention', () => {
  test('removeOlderThan prunes by startTime and keeps the slot map consistent', () => {
    const rb = new RingBuffer(4)
    const now = Date.now()
    rb.add(req('old', { startTime: now - 10_000 }))
    rb.add(req('fresh', { startTime: now }))
    rb.removeOlderThan(5_000)
    expect(rb.get('old')).toBeUndefined()
    expect(rb.getAll().map((r) => r.id)).toEqual(['fresh'])
    expect(rb.update(req('fresh', { status: 204 }))).toBe(true)
    expect(rb.get('fresh')?.status).toBe(204)
  })
})

describe('RingBuffer — removeOlderThan tail-walk', () => {
  test('removes a stale prefix and stops at the first fresh entry, keeping order + lookups', () => {
    const rb = new RingBuffer(10)
    const now = Date.now()
    rb.add(req('old1', { startTime: now - 10_000 }))
    rb.add(req('old2', { startTime: now - 9_000 }))
    rb.add(req('fresh1', { startTime: now }))
    rb.add(req('fresh2', { startTime: now }))

    rb.removeOlderThan(5_000)

    expect(rb.get('old1')).toBeUndefined()
    expect(rb.get('old2')).toBeUndefined()
    expect(rb.getAll().map((r) => r.id)).toEqual(['fresh2', 'fresh1'])
    // Surviving entries remain addressable via the O(1) slot map post-walk.
    expect(rb.update(req('fresh1', { status: 200 }))).toBe(true)
    expect(rb.get('fresh1')?.status).toBe(200)
  })

  test('a stale entry that is not part of the contiguous oldest prefix is left in place', () => {
    // The tail-walk contract only guarantees pruning a contiguous stale run
    // from the oldest slot forward, not a full scan.
    const rb = new RingBuffer(10)
    const now = Date.now()
    rb.add(req('old', { startTime: now - 10_000 }))
    rb.add(req('fresh', { startTime: now }))
    rb.add(req('late-but-stale', { startTime: now - 8_000 }))

    rb.removeOlderThan(5_000)

    expect(rb.get('old')).toBeUndefined()
    expect(rb.get('fresh')).toBeDefined()
    expect(rb.get('late-but-stale')).toBeDefined()
  })

  test('no-op when nothing is stale (does not touch size or entries)', () => {
    const rb = new RingBuffer(10)
    const now = Date.now()
    for (const id of ['a', 'b', 'c']) rb.add(req(id, { startTime: now }))
    rb.removeOlderThan(60_000)
    expect(rb.size).toBe(3)
    expect(rb.getAll().map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  test('removes a stale prefix across wrap-around and leaves the remainder addressable', () => {
    const rb = new RingBuffer(3)
    const now = Date.now()
    for (const id of ['a', 'b', 'c', 'd', 'e']) rb.add(req(id, { startTime: now - 1_000 }))
    // wraps; keeps c, d, e — refresh 'e' so it's the only non-stale entry
    rb.update(req('e', { startTime: now }))

    rb.removeOlderThan(500)

    expect(rb.getAll().map((r) => r.id)).toEqual(['e'])
    expect(rb.update(req('e', { status: 201 }))).toBe(true)
    expect(rb.get('e')?.status).toBe(201)
  })

  test('empty buffer is a no-op', () => {
    const rb = new RingBuffer(4)
    expect(() => rb.removeOlderThan(1_000)).not.toThrow()
    expect(rb.size).toBe(0)
  })
})

describe('RingBuffer — maxBufferBytes (byte budget)', () => {
  test('evicts the oldest entries once the running body-byte total exceeds the budget', () => {
    const rb = new RingBuffer(10, 15)
    rb.add(req('a', { responseBody: '12345' })) // 5 bytes, total=5
    rb.add(req('b', { responseBody: '12345' })) // 5 bytes, total=10
    rb.add(req('c', { responseBody: '123456' })) // 6 bytes, total=16 > 15 -> evicts 'a'

    expect(rb.get('a')).toBeUndefined()
    expect(rb.get('b')).toBeDefined()
    expect(rb.get('c')).toBeDefined()
    expect(rb.bufferBytes).toBe(11)
  })

  test('counts both requestBody and responseBody toward the footprint', () => {
    const rb = new RingBuffer(10, 100)
    rb.add(req('a', { requestBody: '1234', responseBody: '123456' }))
    expect(rb.bufferBytes).toBe(10)
  })

  test('never evicts the just-inserted entry, even if it alone exceeds the budget', () => {
    const rb = new RingBuffer(10, 5)
    rb.add(req('huge', { responseBody: '1234567890' })) // 10 bytes > 5-byte budget
    expect(rb.get('huge')).toBeDefined()
    expect(rb.size).toBe(1)
    expect(rb.bufferBytes).toBe(10)
  })

  test('update-path footprint change is reflected — a body arriving later can trigger eviction', () => {
    const rb = new RingBuffer(10, 12)
    rb.add(req('a', { responseBody: '12345' })) // 5 bytes
    rb.add(req('b', {})) // 0 bytes — headers-only first emit
    expect(rb.bufferBytes).toBe(5)

    // Second emit for 'b' arrives with its body: footprint grows 0 -> 8, total 13 > 12 -> evicts 'a'.
    expect(rb.update(req('b', { responseBody: '12345678' }))).toBe(true)
    expect(rb.get('a')).toBeUndefined()
    expect(rb.get('b')?.responseBody).toBe('12345678')
    expect(rb.bufferBytes).toBe(8)
  })

  test('update-path footprint shrink is also reflected (no under-eviction)', () => {
    const rb = new RingBuffer(10, 100)
    rb.add(req('a', { responseBody: '1234567890' })) // 10 bytes
    expect(rb.bufferBytes).toBe(10)
    rb.update(req('a', { responseBody: '12' })) // shrinks to 2 bytes
    expect(rb.bufferBytes).toBe(2)
  })

  test('setMaxBufferBytes applies eviction immediately when lowered', () => {
    const rb = new RingBuffer(10) // unlimited by default
    rb.add(req('a', { responseBody: '12345' }))
    rb.add(req('b', { responseBody: '12345' }))
    expect(rb.bufferBytes).toBe(10)

    rb.setMaxBufferBytes(6)

    expect(rb.get('a')).toBeUndefined()
    expect(rb.get('b')).toBeDefined()
    expect(rb.bufferBytes).toBe(5)
  })

  test('default construction (no maxBufferBytes passed) never evicts on byte budget', () => {
    const rb = new RingBuffer(3)
    for (const id of ['a', 'b', 'c']) rb.add(req(id, { responseBody: '1234567890' }))
    expect(rb.size).toBe(3)
    expect(rb.bufferBytes).toBe(30)
  })

  test('clear() resets the byte total', () => {
    const rb = new RingBuffer(10, 100)
    rb.add(req('a', { responseBody: '12345' }))
    expect(rb.bufferBytes).toBe(5)
    rb.clear()
    expect(rb.bufferBytes).toBe(0)
  })
})

describe('RingBuffer — subscribe / clear', () => {
  test('subscribers are notified on add and update; unsubscribe stops it', () => {
    const rb = new RingBuffer(4)
    const seen: string[] = []
    const off = rb.subscribe((r) => seen.push(r.id))
    rb.add(req('a'))
    rb.update(req('a', { status: 200 }))
    off()
    rb.add(req('b'))
    expect(seen).toEqual(['a', 'a'])
  })

  test('clear empties everything', () => {
    const rb = new RingBuffer(4)
    rb.add(req('a'))
    rb.clear()
    expect(rb.size).toBe(0)
    expect(rb.get('a')).toBeUndefined()
    expect(rb.getAll()).toEqual([])
    expect(rb.update(req('a', { status: 200 }))).toBe(false)
  })
})

describe('RingBuffer — iterators', () => {
  test('[Symbol.iterator] yields oldest→newest', () => {
    const rb = new RingBuffer(4)
    rb.add(req('a'))
    rb.add(req('b'))
    rb.add(req('c'))
    expect([...rb].map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  test('reversed() yields newest→oldest', () => {
    const rb = new RingBuffer(4)
    rb.add(req('a'))
    rb.add(req('b'))
    rb.add(req('c'))
    expect([...rb.reversed()].map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  test('[Symbol.iterator] yields correct count after eviction', () => {
    const rb = new RingBuffer(3)
    for (const id of ['a', 'b', 'c', 'd']) rb.add(req(id))
    // 'a' evicted; oldest→newest = b, c, d
    expect([...rb].map((r) => r.id)).toEqual(['b', 'c', 'd'])
  })

  test('reversed() count matches size after eviction', () => {
    const rb = new RingBuffer(3)
    for (const id of ['a', 'b', 'c', 'd']) rb.add(req(id))
    expect([...rb.reversed()].map((r) => r.id)).toEqual(['d', 'c', 'b'])
  })

  test('getAll() delegates to reversed — preserves newest-first and all existing behaviour', () => {
    const rb = new RingBuffer(4)
    for (const id of ['a', 'b', 'c']) rb.add(req(id))
    expect(rb.getAll().map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  test('empty buffer — iterators yield nothing', () => {
    const rb = new RingBuffer(4)
    expect([...rb]).toEqual([])
    expect([...rb.reversed()]).toEqual([])
  })
})

describe('RingBuffer — byUrl index / getByUrl', () => {
  test('getByUrl returns matching entries newest-first', () => {
    const rb = new RingBuffer(10)
    rb.add(req('a', { url: 'https://api.example.com/users' }))
    rb.add(req('b', { url: 'https://api.example.com/posts' }))
    rb.add(req('c', { url: 'https://api.example.com/users' }))

    const results = rb.getByUrl('https://api.example.com/users')
    expect(results.map((r) => r.id)).toEqual(['c', 'a'])
  })

  test('getByUrl returns empty array for unknown url', () => {
    const rb = new RingBuffer(4)
    rb.add(req('a'))
    expect(rb.getByUrl('https://other.com')).toEqual([])
  })

  test('getByUrl reflects eviction — evicted id not returned', () => {
    const rb = new RingBuffer(2)
    rb.add(req('a', { url: 'https://api.example.com/data' }))
    rb.add(req('b', { url: 'https://api.example.com/data' }))
    // Adding 'c' to same URL evicts 'a'
    rb.add(req('c', { url: 'https://api.example.com/data' }))
    const results = rb.getByUrl('https://api.example.com/data')
    expect(results.map((r) => r.id)).toEqual(['c', 'b'])
    expect(results.some((r) => r.id === 'a')).toBe(false)
  })

  test('getByUrl is consistent after clear', () => {
    const rb = new RingBuffer(4)
    rb.add(req('a', { url: 'https://api.example.com/users' }))
    rb.clear()
    expect(rb.getByUrl('https://api.example.com/users')).toEqual([])
  })

  test('update with url change keeps index consistent', () => {
    const rb = new RingBuffer(4)
    rb.add(req('a', { url: 'https://api.example.com/old' }))
    rb.update(req('a', { url: 'https://api.example.com/new' }))
    expect(rb.getByUrl('https://api.example.com/old')).toEqual([])
    const results = rb.getByUrl('https://api.example.com/new')
    expect(results.map((r) => r.id)).toEqual(['a'])
  })

  test('getByUrl survives eviction during wrap-around', () => {
    const rb = new RingBuffer(3)
    const url = 'https://api.example.com/stream'
    for (const id of ['a', 'b', 'c', 'd', 'e']) rb.add(req(id, { url }))
    // capacity 3 → keeps c, d, e
    const results = rb.getByUrl(url)
    expect(results.map((r) => r.id)).toEqual(['e', 'd', 'c'])
  })
})
