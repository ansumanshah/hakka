import { describe, expect, it } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { createGroupCache, groupRequests, sortRequests } from '../sortGroup'

function req(overrides: Partial<NetworkRequest> & { id: string }): NetworkRequest {
  return {
    url: 'https://api.example.com/v1/users',
    method: 'GET',
    status: 200,
    startTime: 1000,
    requestBodySize: 0,
    responseBodySize: 0,
    ...overrides,
  }
}

const r1 = req({
  id: 'r1',
  startTime: 1000,
  status: 200,
  method: 'GET',
  url: 'https://api.example.com/users',
  duration: 50,
  requestBodySize: 100,
  responseBodySize: 200,
})
const r2 = req({
  id: 'r2',
  startTime: 2000,
  status: 404,
  method: 'POST',
  url: 'https://api.example.com/orders',
  duration: 200,
  requestBodySize: 50,
  responseBodySize: 50,
})
const r3 = req({
  id: 'r3',
  startTime: 500,
  status: 500,
  method: 'GET',
  url: 'https://cdn.example.com/image.png',
  duration: 10,
  requestBodySize: 0,
  responseBodySize: 1000,
  error: 'Network error',
})
const r4 = req({
  id: 'r4',
  startTime: 1500,
  status: 201,
  method: 'DELETE',
  url: 'https://api.example.com/items/1',
  duration: 100,
  requestBodySize: 20,
  responseBodySize: 30,
})

const all = [r1, r2, r3, r4]

describe('sortRequests', () => {
  describe('sort by time', () => {
    it('asc — earliest first', () => {
      const sorted = sortRequests(all, 'time', 'asc')
      expect(sorted.map((r) => r.id)).toEqual(['r3', 'r1', 'r4', 'r2'])
    })

    it('desc — latest first', () => {
      const sorted = sortRequests(all, 'time', 'desc')
      expect(sorted.map((r) => r.id)).toEqual(['r2', 'r4', 'r1', 'r3'])
    })
  })

  describe('sort by duration', () => {
    it('asc — shortest first', () => {
      const sorted = sortRequests(all, 'duration', 'asc')
      expect(sorted.map((r) => r.id)).toEqual(['r3', 'r1', 'r4', 'r2'])
    })

    it('desc — longest first', () => {
      const sorted = sortRequests(all, 'duration', 'desc')
      expect(sorted.map((r) => r.id)).toEqual(['r2', 'r4', 'r1', 'r3'])
    })
  })

  describe('sort by size', () => {
    it('asc — smallest first', () => {
      // r3=1000, r1=300, r2=100, r4=50
      // sizes: r4=50, r2=100, r1=300, r3=1000
      const sorted = sortRequests(all, 'size', 'asc')
      expect(sorted.map((r) => r.id)).toEqual(['r4', 'r2', 'r1', 'r3'])
    })

    it('desc — largest first', () => {
      const sorted = sortRequests(all, 'size', 'desc')
      expect(sorted.map((r) => r.id)).toEqual(['r3', 'r1', 'r2', 'r4'])
    })
  })

  describe('sort by status', () => {
    it('asc — lowest status first', () => {
      const sorted = sortRequests(all, 'status', 'asc')
      expect(sorted.map((r) => r.id)).toEqual(['r1', 'r4', 'r2', 'r3'])
    })

    it('desc — highest status first', () => {
      const sorted = sortRequests(all, 'status', 'desc')
      expect(sorted.map((r) => r.id)).toEqual(['r3', 'r2', 'r4', 'r1'])
    })
  })

  it('does not mutate input array', () => {
    const input = [...all]
    sortRequests(input, 'time', 'asc')
    expect(input.map((r) => r.id)).toEqual(all.map((r) => r.id))
  })

  it('stable sort — equal elements preserve input order', () => {
    const a = req({ id: 'a', startTime: 1000 })
    const b = req({ id: 'b', startTime: 1000 })
    const c = req({ id: 'c', startTime: 1000 })
    const sorted = sortRequests([a, b, c], 'time', 'asc')
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('duration falls back to endTime - startTime when duration not set', () => {
    const a = req({ id: 'a', startTime: 1000, endTime: 1100, duration: undefined })
    const b = req({ id: 'b', startTime: 1000, endTime: 1200, duration: undefined })
    const sorted = sortRequests([b, a], 'duration', 'asc')
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('groupRequests', () => {
  describe('group by none', () => {
    it('returns single group with all items', () => {
      const groups = groupRequests(all, 'none')
      expect(groups).toHaveLength(1)
      expect(groups[0]!.key).toBe('')
      expect(groups[0]!.label).toBe('All')
      expect(groups[0]!.items).toHaveLength(all.length)
    })
  })

  describe('group by host', () => {
    it('groups by URL host, preserving order', () => {
      const groups = groupRequests(all, 'host')
      const keys = groups.map((g) => g.key)
      expect(keys).toContain('api.example.com')
      expect(keys).toContain('cdn.example.com')
    })

    it('items within a host group are in input order', () => {
      const groups = groupRequests(all, 'host')
      const apiGroup = groups.find((g) => g.key === 'api.example.com')!
      expect(apiGroup.items.map((r) => r.id)).toEqual(['r1', 'r2', 'r4'])
    })

    it('label equals host', () => {
      const groups = groupRequests(all, 'host')
      for (const g of groups) {
        expect(g.label).toBe(g.key)
      }
    })
  })

  describe('group by status', () => {
    it('groups into status class buckets', () => {
      const groups = groupRequests(all, 'status')
      const keys = groups.map((g) => g.key)
      expect(keys).toContain('2xx') // r1 (200) + r4 (201)
      expect(keys).toContain('4xx') // r2 (404)
      expect(keys).toContain('5xx') // r3 (500)
    })

    it('labels are human-readable', () => {
      const groups = groupRequests(all, 'status')
      const twoxx = groups.find((g) => g.key === '2xx')!
      expect(twoxx.label).toContain('Success')
    })

    it('preserves group discovery order (first seen)', () => {
      // r1 is 200 (2xx), r2 is 404 (4xx), r3 is 500 (5xx), r4 is 201 (2xx)
      const groups = groupRequests(all, 'status')
      expect(groups[0]!.key).toBe('2xx')
      expect(groups[1]!.key).toBe('4xx')
      expect(groups[2]!.key).toBe('5xx')
    })

    it('pending status → pending group', () => {
      const pending = req({ id: 'p1', status: undefined })
      const groups = groupRequests([pending], 'status')
      expect(groups[0]!.key).toBe('pending')
    })
  })

  describe('group by method', () => {
    it('groups by uppercased method', () => {
      const groups = groupRequests(all, 'method')
      const keys = groups.map((g) => g.key)
      expect(keys).toContain('GET')
      expect(keys).toContain('POST')
      expect(keys).toContain('DELETE')
    })

    it('label equals method', () => {
      const groups = groupRequests(all, 'method')
      for (const g of groups) {
        expect(g.label).toBe(g.key)
      }
    })

    it('preserves items within group in input order', () => {
      const groups = groupRequests(all, 'method')
      const getGroup = groups.find((g) => g.key === 'GET')!
      expect(getGroup.items.map((r) => r.id)).toEqual(['r1', 'r3'])
    })
  })

  describe('group by error', () => {
    it('splits into error and ok groups', () => {
      const groups = groupRequests(all, 'error')
      const keys = groups.map((g) => g.key)
      expect(keys).toContain('ok')
      expect(keys).toContain('error')
    })

    it('error group contains only requests with error field', () => {
      const groups = groupRequests(all, 'error')
      const errGroup = groups.find((g) => g.key === 'error')!
      expect(errGroup.items.every((r) => Boolean(r.error))).toBe(true)
      expect(errGroup.items.map((r) => r.id)).toContain('r3')
    })

    it('ok group labels correctly', () => {
      const groups = groupRequests(all, 'error')
      const okGroup = groups.find((g) => g.key === 'ok')!
      expect(okGroup.label).toBe('OK')
    })

    it('error group labels correctly', () => {
      const groups = groupRequests(all, 'error')
      const errGroup = groups.find((g) => g.key === 'error')!
      expect(errGroup.label).toBe('Errors')
    })
  })

  it('empty input → empty groups (except none which gives one group)', () => {
    expect(groupRequests([], 'host')).toHaveLength(0)
    expect(groupRequests([], 'status')).toHaveLength(0)
  })

  it('groups by trace correlationId; untraced fall under "No trace"', () => {
    const a = { id: 'a', url: 'https://x/1', method: 'GET', startTime: 1, correlationId: 'T1' } as NetworkRequest
    const b = { id: 'b', url: 'https://x/2', method: 'GET', startTime: 2, correlationId: 'T1' } as NetworkRequest
    const c = { id: 'c', url: 'https://x/3', method: 'GET', startTime: 3 } as NetworkRequest
    const groups = groupRequests([a, b, c], 'trace')
    expect(groups.find((g) => g.key === 'T1')?.items.map((r) => r.id)).toEqual(['a', 'b'])
    const untraced = groups.find((g) => g.key === '')
    expect(untraced?.label).toBe('No trace')
    expect(untraced?.items.map((r) => r.id)).toEqual(['c'])
  })

  describe('host cache', () => {
    it('repeated calls with the same URL still resolve the correct host (cache-hit path)', () => {
      const reqs = Array.from({ length: 5 }, (_, i) => req({ id: `h${i}`, url: 'https://api.example.com/repeat' }))
      // Call groupRequests many times over the same URLs to exercise the
      // module-level host cache's hit path, not just its miss path.
      for (let i = 0; i < 10; i++) {
        const groups = groupRequests(reqs, 'host')
        expect(groups).toHaveLength(1)
        expect(groups[0]!.key).toBe('api.example.com')
      }
    })

    it('a malformed URL falls back to the raw string consistently, even from cache', () => {
      const bad = req({ id: 'bad', url: 'not a url' })
      const first = groupRequests([bad], 'host')
      const second = groupRequests([bad], 'host') // second call hits the cache
      expect(first[0]!.key).toBe('not a url')
      expect(second[0]!.key).toBe('not a url')
    })
  })
})

describe('createGroupCache', () => {
  it('reuses the same group object reference when a group is untouched between calls', () => {
    const regroup = createGroupCache()
    const first = regroup([r1, r2, r4], 'method') // GET(r1), POST(r2), DELETE(r4)
    const getGroupFirst = first.find((g) => g.key === 'GET')!

    // A new POST is unrelated to the GET group; adding it shouldn't disturb GET's identity.
    const r5 = req({ id: 'r5', method: 'POST', url: 'https://api.example.com/carts' })
    const second = regroup([r1, r2, r4, r5], 'method')
    const getGroupSecond = second.find((g) => g.key === 'GET')!

    expect(getGroupSecond).toBe(getGroupFirst)
  })

  it('gives a group a new object reference when its membership actually changes', () => {
    const regroup = createGroupCache()
    const first = regroup([r1, r4], 'method') // GET(r1), DELETE(r4)
    const getGroupFirst = first.find((g) => g.key === 'GET')!

    // r3 is also a GET — membership of the GET group grows.
    const second = regroup([r1, r3, r4], 'method')
    const getGroupSecond = second.find((g) => g.key === 'GET')!

    expect(getGroupSecond).not.toBe(getGroupFirst)
    expect(getGroupSecond.items.map((r) => r.id)).toEqual(['r1', 'r3'])
  })

  it('still produces functionally correct groups (matches groupRequests output)', () => {
    const regroup = createGroupCache()
    const cached = regroup(all, 'status')
    const plain = groupRequests(all, 'status')
    expect(cached.map((g) => ({ key: g.key, ids: g.items.map((r) => r.id) }))).toEqual(
      plain.map((g) => ({ key: g.key, ids: g.items.map((r) => r.id) })),
    )
  })

  it('resets its cache when the group-by mode changes, even if a key string repeats', () => {
    const regroup = createGroupCache()
    const byMethod = regroup([r1, r4], 'method')
    const getGroup = byMethod.find((g) => g.key === 'GET')!

    // Switch modes entirely — even though no key collides here, the cache
    // must not hand back a stale object typed for a different grouping.
    const byStatus = regroup([r1, r4], 'status')
    for (const g of byStatus) {
      expect(g).not.toBe(getGroup)
    }
  })

  it('each independent createGroupCache() instance has its own cache', () => {
    const regroupA = createGroupCache()
    const regroupB = createGroupCache()
    const a1 = regroupA([r1], 'method').find((g) => g.key === 'GET')!
    const b1 = regroupB([r1], 'method').find((g) => g.key === 'GET')!
    expect(a1).not.toBe(b1) // different instances never share object identity
  })
})
