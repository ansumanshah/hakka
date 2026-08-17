import { describe, expect, test } from 'bun:test'
import diagnosticsChannel from 'node:diagnostics_channel'

import type { NetworkRequest } from 'hakka-core'

import { enableUndiciTiming } from '../undiciTiming'

/** Publish a synthetic undici diagnostics_channel message — bypasses real undici/fetch entirely so these tests are deterministic instead of racing real socket/connection timing. */
function publish(name: string, message: unknown): void {
  diagnosticsChannel.channel(name).publish(message)
}

function makeRecord(over: Partial<NetworkRequest> & Pick<NetworkRequest, 'id' | 'url' | 'method'>): NetworkRequest {
  return { startTime: Date.now(), source: 'fetch', ...over } as NetworkRequest
}

describe('enableUndiciTiming', () => {
  test('assigns connectMs for the first request on a freshly-connected socket', () => {
    const handle = enableUndiciTiming()
    try {
      const socket = {}
      publish('undici:client:beforeConnect', { connectParams: { host: 'h1:1' } })
      publish('undici:client:connected', { connectParams: { host: 'h1:1' }, socket })
      publish('undici:client:sendHeaders', {
        request: { method: 'GET', origin: 'http://h1:1', path: '/a' },
        socket,
      })

      const record = makeRecord({ id: 'r1', url: 'http://h1:1/a', method: 'GET' })
      handle.enrich(record)

      expect(typeof record.connectMs).toBe('number')
      expect(record.timing?.connectMs).toBe(record.connectMs)
    } finally {
      handle.teardown()
    }
  })

  test('does not fabricate connectMs for a request reusing an already-used (keep-alive) socket', () => {
    const handle = enableUndiciTiming()
    try {
      const socket = {}
      publish('undici:client:beforeConnect', { connectParams: { host: 'h2:1' } })
      publish('undici:client:connected', { connectParams: { host: 'h2:1' }, socket })
      // Two requests share the SAME socket (keep-alive reuse) — only the first
      // one, which actually paid for the connection, gets credited.
      publish('undici:client:sendHeaders', {
        request: { method: 'GET', origin: 'http://h2:1', path: '/first' },
        socket,
      })
      publish('undici:client:sendHeaders', {
        request: { method: 'GET', origin: 'http://h2:1', path: '/second' },
        socket,
      })

      const first = makeRecord({ id: 'f1', url: 'http://h2:1/first', method: 'GET' })
      const second = makeRecord({ id: 'f2', url: 'http://h2:1/second', method: 'GET' })
      handle.enrich(first)
      handle.enrich(second)

      expect(typeof first.connectMs).toBe('number')
      expect(second.connectMs).toBeUndefined()
    } finally {
      handle.teardown()
    }
  })

  test('skips enrichment for a record with no corresponding undici event at all', () => {
    const handle = enableUndiciTiming()
    try {
      const record = makeRecord({ id: 'r-none', url: 'http://nowhere:1/x', method: 'GET' })
      handle.enrich(record)
      expect(record.connectMs).toBeUndefined()
    } finally {
      handle.teardown()
    }
  })

  test('skips enrichment (never guesses) when two in-flight requests share the exact same method+url', () => {
    const handle = enableUndiciTiming()
    try {
      const socketA = {}
      const socketB = {}
      publish('undici:client:beforeConnect', { connectParams: { host: 'h3:1' } })
      publish('undici:client:connected', { connectParams: { host: 'h3:1' }, socket: socketA })
      publish('undici:client:beforeConnect', { connectParams: { host: 'h3:1' } })
      publish('undici:client:connected', { connectParams: { host: 'h3:1' }, socket: socketB })

      // Both concurrent requests hit the exact same method+url before either resolves.
      publish('undici:client:sendHeaders', {
        request: { method: 'GET', origin: 'http://h3:1', path: '/dup' },
        socket: socketA,
      })
      publish('undici:client:sendHeaders', {
        request: { method: 'GET', origin: 'http://h3:1', path: '/dup' },
        socket: socketB,
      })

      const recA = makeRecord({ id: 'dup-a', url: 'http://h3:1/dup', method: 'GET' })
      const recB = makeRecord({ id: 'dup-b', url: 'http://h3:1/dup', method: 'GET' })
      handle.enrich(recA)
      handle.enrich(recB)

      expect(recA.connectMs).toBeUndefined()
      expect(recB.connectMs).toBeUndefined()
    } finally {
      handle.teardown()
    }
  })

  test('ignores non-fetch sources entirely', () => {
    const handle = enableUndiciTiming()
    try {
      const socket = {}
      publish('undici:client:beforeConnect', { connectParams: { host: 'h4:1' } })
      publish('undici:client:connected', { connectParams: { host: 'h4:1' }, socket })
      publish('undici:client:sendHeaders', {
        request: { method: 'GET', origin: 'http://h4:1', path: '/http' },
        socket,
      })

      const record = makeRecord({ id: 'http-1', url: 'http://h4:1/http', method: 'GET', source: 'http' })
      handle.enrich(record)
      expect(record.connectMs).toBeUndefined()
    } finally {
      handle.teardown()
    }
  })

  test('reuses the cached verdict for a second call with the same id (two-phase fetch emission) instead of re-querying the queue', () => {
    const handle = enableUndiciTiming()
    try {
      const socket = {}
      publish('undici:client:beforeConnect', { connectParams: { host: 'h5:1' } })
      publish('undici:client:connected', { connectParams: { host: 'h5:1' }, socket })
      publish('undici:client:sendHeaders', {
        request: { method: 'GET', origin: 'http://h5:1', path: '/two-phase' },
        socket,
      })

      const phase1 = makeRecord({ id: 'shared-id', url: 'http://h5:1/two-phase', method: 'GET' })
      handle.enrich(phase1)
      expect(typeof phase1.connectMs).toBe('number')

      // Phase 2: a DIFFERENT record object (capture/fetch.ts's body-arrival
      // update), SAME id. The queue's only entry was already consumed by phase
      // 1 — a naive re-query would find nothing (or, with another concurrent
      // request queued meanwhile, grab an unrelated one). The per-id cache
      // must be reused instead.
      const phase2 = makeRecord({ id: 'shared-id', url: 'http://h5:1/two-phase', method: 'GET' })
      handle.enrich(phase2)
      expect(phase2.connectMs).toBe(phase1.connectMs)
    } finally {
      handle.teardown()
    }
  })

  test('teardown() unsubscribes — events published afterward no longer enrich new records', () => {
    const handle = enableUndiciTiming()
    handle.teardown()

    const socket = {}
    publish('undici:client:beforeConnect', { connectParams: { host: 'h6:1' } })
    publish('undici:client:connected', { connectParams: { host: 'h6:1' }, socket })
    publish('undici:client:sendHeaders', {
      request: { method: 'GET', origin: 'http://h6:1', path: '/after-teardown' },
      socket,
    })

    const record = makeRecord({ id: 'after', url: 'http://h6:1/after-teardown', method: 'GET' })
    handle.enrich(record)
    expect(record.connectMs).toBeUndefined()
  })

  test('a malformed/unexpected message shape never throws (best-effort, fail-open)', () => {
    const handle = enableUndiciTiming()
    try {
      expect(() => publish('undici:client:beforeConnect', {})).not.toThrow()
      expect(() => publish('undici:client:connected', {})).not.toThrow()
      expect(() => publish('undici:client:sendHeaders', {})).not.toThrow()
      const record = makeRecord({ id: 'malformed', url: 'http://x/y', method: 'GET' })
      expect(() => handle.enrich(record)).not.toThrow()
    } finally {
      handle.teardown()
    }
  })
})
