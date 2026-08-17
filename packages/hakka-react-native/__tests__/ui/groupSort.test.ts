import type { NetworkRequest } from 'hakka-core'

import { groupRequests } from '../../src/ui/utils/groupSort'

// The adapter maps core's { key, label, items } → { key, title, data }
// and maps 'status-class' groupBy → core's 'status'.
// Core's 'none' group uses key='' and label='All'; the adapter preserves that.

function makeRequest(overrides: Partial<NetworkRequest> & { id: string }): NetworkRequest {
  return {
    url: 'https://api.example.com/path',
    method: 'GET',
    startTime: Date.now(),
    timestamp: Date.now(),
    status: 200,
    duration: 100,
    ...overrides,
  }
}

const REQ_A = makeRequest({
  id: 'a',
  url: 'https://api.example.com/a',
  method: 'GET',
  status: 200,
  timestamp: 1000,
  startTime: 1000,
  duration: 50,
  size: 100,
  responseBodySize: 100,
})
const REQ_B = makeRequest({
  id: 'b',
  url: 'https://other.com/b',
  method: 'POST',
  status: 404,
  timestamp: 2000,
  startTime: 2000,
  duration: 200,
  size: 500,
  responseBodySize: 500,
})
const REQ_C = makeRequest({
  id: 'c',
  url: 'https://api.example.com/c',
  method: 'GET',
  status: 500,
  timestamp: 3000,
  startTime: 3000,
  duration: 10,
  size: 50,
  responseBodySize: 50,
})

describe('groupRequests - groupBy none', () => {
  it('returns a single group with all sorted items', () => {
    const result = groupRequests([REQ_A, REQ_B, REQ_C], 'none', 'time', 'asc')
    expect(result).toHaveLength(1)
    // Core engine uses key='' for the ungrouped bucket (adapter preserves this)
    expect(result[0].key).toBe('')
    expect(result[0].data.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('groupRequests - groupBy status-class', () => {
  it('groups requests by status class', () => {
    // 'status-class' maps to core 'status'; core uses keys '2xx', '4xx', '5xx'
    const result = groupRequests([REQ_A, REQ_B, REQ_C], 'status-class', 'time', 'asc')
    const keys = result.map((g) => g.key)
    expect(keys).toContain('2xx')
    expect(keys).toContain('4xx')
    expect(keys).toContain('5xx')
    const group2xx = result.find((g) => g.key === '2xx')
    expect(group2xx?.data.map((r) => r.id)).toEqual(['a'])
    const group4xx = result.find((g) => g.key === '4xx')
    expect(group4xx?.data.map((r) => r.id)).toEqual(['b'])
    const group5xx = result.find((g) => g.key === '5xx')
    expect(group5xx?.data.map((r) => r.id)).toEqual(['c'])
  })
})
