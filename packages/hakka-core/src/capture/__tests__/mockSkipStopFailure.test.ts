import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { mockEngine, type MockRule } from '../../engine/MockEngine'
import type { NetworkRequest } from '../../model/types'
import { enableFetchInterceptor } from '../fetch'

// Drives the real fetch interceptor against the singleton MockEngine to prove
// `skipCount`/`stopAfter`/`failure` end to end — mirrors
// `capture/__tests__/rewrite.test.ts`'s harness style.
const REAL_FETCH = globalThis.fetch
const MAX_BODY = 1_000_000

function makeRule(partial: Partial<MockRule>): Parameters<typeof mockEngine.addRule>[0] {
  return {
    pattern: 'api.example.com/data',
    response: { status: 200, body: 'MOCKED' },
    enabled: true,
    ...partial,
  } as Parameters<typeof mockEngine.addRule>[0]
}

function withInterceptor(): { records: NetworkRequest[]; dispose: () => void } {
  const records: NetworkRequest[] = []
  globalThis.fetch = (async () => new Response('REAL', { status: 200 })) as typeof fetch
  const dispose = enableFetchInterceptor((r) => records.push(r), MAX_BODY, [])
  return { records, dispose }
}

beforeEach(() => {
  mockEngine.clearRules()
})

afterEach(() => {
  mockEngine.clearRules()
  globalThis.fetch = REAL_FETCH
})

const URL = 'https://api.example.com/data'

describe('MockEngine — admitMatch (skipCount/stopAfter budget)', () => {
  test('skipCount 0 (default): every match applies immediately', () => {
    const rule = mockEngine.addRule(makeRule({}))
    for (let i = 0; i < 3; i++) {
      expect(mockEngine.admitMatch(mockEngine.getRules().find((r) => r.id === rule)!)).toBe(true)
    }
  })

  test('skipCount N: first N matches skip, N+1th onward applies (unbounded stopAfter)', () => {
    mockEngine.addRule(makeRule({ skipCount: 2 }))
    const rule = mockEngine.getRules()[0]
    expect(mockEngine.admitMatch(rule)).toBe(false) // match 1: skipped
    expect(mockEngine.admitMatch(rule)).toBe(false) // match 2: skipped
    expect(mockEngine.admitMatch(rule)).toBe(true) // match 3: applies
    expect(mockEngine.admitMatch(rule)).toBe(true) // match 4: still applies (no stopAfter)
  })

  test('stopAfter N with skipCount 0: first N matches apply, then stop forever', () => {
    mockEngine.addRule(makeRule({ stopAfter: 2 }))
    const rule = mockEngine.getRules()[0]
    expect(mockEngine.admitMatch(rule)).toBe(true) // applied match 1
    expect(mockEngine.admitMatch(rule)).toBe(true) // applied match 2
    expect(mockEngine.admitMatch(rule)).toBe(false) // 3rd match: budget exhausted
    expect(mockEngine.admitMatch(rule)).toBe(false) // stays exhausted forever
  })

  test('skipCount and stopAfter together: skip first N, apply the next M, then stop', () => {
    mockEngine.addRule(makeRule({ skipCount: 1, stopAfter: 2 }))
    const rule = mockEngine.getRules()[0]
    expect(mockEngine.admitMatch(rule)).toBe(false) // match 1: skipped
    expect(mockEngine.admitMatch(rule)).toBe(true) // match 2: applied #1
    expect(mockEngine.admitMatch(rule)).toBe(true) // match 3: applied #2
    expect(mockEngine.admitMatch(rule)).toBe(false) // match 4: exhausted
    expect(mockEngine.admitMatch(rule)).toBe(false) // match 5: still exhausted
  })

  test('stopAfter 0 with skipCount 0: every match is skipped (applies zero times)', () => {
    mockEngine.addRule(makeRule({ stopAfter: 0 }))
    const rule = mockEngine.getRules()[0]
    expect(mockEngine.admitMatch(rule)).toBe(false)
    expect(mockEngine.admitMatch(rule)).toBe(false)
  })

  test('skipCount larger than any observed match count: rule never applies within that window', () => {
    mockEngine.addRule(makeRule({ skipCount: 1000 }))
    const rule = mockEngine.getRules()[0]
    for (let i = 0; i < 10; i++) {
      expect(mockEngine.admitMatch(rule)).toBe(false)
    }
  })

  test('re-adding a rule with the same id resets its skip/stop budget', () => {
    mockEngine.addRule(makeRule({ id: 'r1', skipCount: 1 }))
    const rule1 = mockEngine.getRules()[0]
    expect(mockEngine.admitMatch(rule1)).toBe(false) // consumed the skip
    mockEngine.addRule(makeRule({ id: 'r1', skipCount: 1 })) // replace by id
    const rule2 = mockEngine.getRules()[0]
    expect(mockEngine.admitMatch(rule2)).toBe(false) // budget restarted, not "already skipped"
    expect(mockEngine.admitMatch(rule2)).toBe(true)
  })

  test('removing and re-adding a rule with a fresh id starts a fresh budget (not reused from a stale id)', () => {
    mockEngine.addRule(makeRule({ id: 'r1', skipCount: 1 }))
    mockEngine.admitMatch(mockEngine.getRules()[0])
    mockEngine.removeRule('r1')
    mockEngine.addRule(makeRule({ id: 'r1', skipCount: 1 }))
    const rule = mockEngine.getRules()[0]
    expect(mockEngine.admitMatch(rule)).toBe(false)
  })
})

describe('MockEngine — skipCount/stopAfter through the fetch interceptor', () => {
  test('skipCount 1: first request is real, second is mocked', async () => {
    const { records, dispose } = withInterceptor()
    try {
      mockEngine.addRule(makeRule({ skipCount: 1 }))
      const first = await (await fetch(URL)).text()
      const second = await (await fetch(URL)).text()
      expect(first).toBe('REAL')
      expect(second).toBe('MOCKED')
      // Real (non-mocked) requests also emit a pending/completed pair on this
      // interceptor, so count mocked records rather than assume 1:1 with fetch() calls.
      expect(records.filter((r) => r.mocked).length).toBe(1)
      expect(mockEngine.getRules()[0]?.hitCount).toBe(1) // only the applied match counts
    } finally {
      dispose()
    }
  })

  test('stopAfter 1: first request is mocked, second reverts to real traffic', async () => {
    const { records, dispose } = withInterceptor()
    try {
      mockEngine.addRule(makeRule({ stopAfter: 1 }))
      const first = await (await fetch(URL)).text()
      const second = await (await fetch(URL)).text()
      expect(first).toBe('MOCKED')
      expect(second).toBe('REAL')
      expect(records.filter((r) => r.mocked).length).toBe(1)
      expect(mockEngine.getRules()[0]?.hitCount).toBe(1)
    } finally {
      dispose()
    }
  })

  test('skipCount 1 + stopAfter 1: skip, mock once, then real forever', async () => {
    const { records, dispose } = withInterceptor()
    try {
      mockEngine.addRule(makeRule({ skipCount: 1, stopAfter: 1 }))
      const results = []
      for (let i = 0; i < 3; i++) results.push(await (await fetch(URL)).text())
      expect(results).toEqual(['REAL', 'MOCKED', 'REAL'])
      expect(records.filter((r) => r.mocked).length).toBe(1)
      expect(mockEngine.getRules()[0]?.hitCount).toBe(1)
    } finally {
      dispose()
    }
  })
})

describe('MockEngine — failure mode (transport-error mock)', () => {
  test('a matched failure rule throws instead of serving response, and records the mocked error', async () => {
    const { records, dispose } = withInterceptor()
    try {
      mockEngine.addRule(makeRule({ failure: { code: 'timeout' } }))
      await expect(fetch(URL)).rejects.toThrow('Failed to fetch')
      expect(records[0]?.mocked).toBe(true)
      expect(records[0]?.status).toBeNull()
      expect(records[0]?.error).toContain('timed out')
    } finally {
      dispose()
    }
  })

  test('failure takes priority over block when both are set', async () => {
    const { records, dispose } = withInterceptor()
    try {
      mockEngine.addRule(makeRule({ failure: { code: 'cannotFindHost' }, block: true }))
      await expect(fetch(URL)).rejects.toThrow('Failed to fetch')
      expect(records[0]?.error).toContain('cannot find host')
    } finally {
      dispose()
    }
  })

  test('failure honors skipCount/stopAfter like any other rule effect', async () => {
    const { records, dispose } = withInterceptor()
    try {
      mockEngine.addRule(makeRule({ failure: { code: 'unknown' }, skipCount: 1 }))
      const first = await (await fetch(URL)).text()
      expect(first).toBe('REAL')
      await expect(fetch(URL)).rejects.toThrow('Failed to fetch')
      const mockedRecords = records.filter((r) => r.mocked)
      expect(mockedRecords).toHaveLength(1)
      expect(mockedRecords[0]?.error).toContain('unknown network error')
    } finally {
      dispose()
    }
  })
})
