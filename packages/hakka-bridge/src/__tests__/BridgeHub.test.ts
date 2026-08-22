import { describe, expect, test } from 'bun:test'

import { BridgeHub } from '../BridgeHub'
import { parseBridgeMessage } from '../protocol'

function frame(payload: Record<string, unknown>): string {
  return JSON.stringify({ type: 'request', payload })
}

function controlFrame(payload: unknown): string {
  return JSON.stringify({ type: 'control', payload })
}

function spanFrame(payload: Record<string, unknown>): string {
  return JSON.stringify({ type: 'span', payload })
}

function consoleFrame(payload: unknown[]): string {
  return JSON.stringify({ type: 'console', payload })
}

function storageFrame(payload: Record<string, unknown>): string {
  return JSON.stringify({ type: 'storage', payload })
}

describe('parseBridgeMessage', () => {
  test('accepts a valid request frame', () => {
    const msg = parseBridgeMessage(frame({ id: '1', url: 'u', method: 'GET' }))
    expect(msg?.type).toBe('request')
    expect((msg as { payload: { id: string } }).payload.id).toBe('1')
  })

  test('accepts a valid control frame', () => {
    const msg = parseBridgeMessage(controlFrame({ kind: 'mock.clear' }))
    expect(msg?.type).toBe('control')
    expect((msg as { payload: { kind: string } }).payload.kind).toBe('mock.clear')
  })

  test('rejects malformed JSON', () => {
    expect(parseBridgeMessage('{not json')).toBeNull()
  })

  test('accepts a valid span frame', () => {
    const msg = parseBridgeMessage(spanFrame({ id: 's1', traceId: 't1', parentId: null }))
    expect(msg?.type).toBe('span')
    expect((msg as { payload: { id: string } }).payload.id).toBe('s1')
  })

  test('rejects wrong type or missing/invalid payload', () => {
    expect(parseBridgeMessage(JSON.stringify({ type: 'hello' }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'request' }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'request', payload: 'x' }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'control' }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'control', payload: 'x' }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'control', payload: null }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'span' }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'span', payload: 'x' }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'span', payload: null }))).toBeNull()
  })

  test('accepts a valid console frame (array payload)', () => {
    const msg = parseBridgeMessage(consoleFrame([{ id: 'log_1', timestamp: 1, level: 'info', message: 'hi' }]))
    expect(msg?.type).toBe('console')
    expect((msg as { payload: { id: string }[] }).payload[0]?.id).toBe('log_1')
  })

  test('accepts a valid storage frame (object payload)', () => {
    const msg = parseBridgeMessage(storageFrame({ store: 'defaults', timestamp: 1, entries: { a: 'b' } }))
    expect(msg?.type).toBe('storage')
    expect((msg as { payload: { store: string } }).payload.store).toBe('defaults')
  })

  test('rejects a console frame whose payload is not an array', () => {
    expect(parseBridgeMessage(JSON.stringify({ type: 'console', payload: { id: 'x' } }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'console', payload: 'x' }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'console' }))).toBeNull()
  })

  test('rejects a storage frame whose payload is an array or missing', () => {
    expect(parseBridgeMessage(JSON.stringify({ type: 'storage', payload: [] }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'storage', payload: 'x' }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'storage' }))).toBeNull()
  })

  test('a future/unknown frame kind is dropped, not thrown — the forward-compat contract', () => {
    expect(parseBridgeMessage(JSON.stringify({ type: 'some-future-kind', payload: { a: 1 } }))).toBeNull()
  })
})

describe('BridgeHub', () => {
  test('ingests valid frames and returns the record', () => {
    const hub = new BridgeHub()
    const result = hub.ingest(frame({ id: 'a', url: 'u', method: 'GET' }))
    expect(result?.kind).toBe('request')
    expect(result && result.kind === 'request' ? result.request.id : undefined).toBe('a')
    expect(hub.size).toBe(1)
    expect(hub.getRecords()[0].id).toBe('a')
  })

  test('ignores malformed frames', () => {
    const hub = new BridgeHub()
    expect(hub.ingest('garbage')).toBeNull()
    expect(hub.size).toBe(0)
  })

  test('bounds the buffer to maxRecords, dropping oldest', () => {
    const hub = new BridgeHub({ maxRecords: 2 })
    hub.ingest(frame({ id: '1', url: 'u', method: 'GET' }))
    hub.ingest(frame({ id: '2', url: 'u', method: 'GET' }))
    hub.ingest(frame({ id: '3', url: 'u', method: 'GET' }))
    expect(hub.size).toBe(2)
    expect(hub.getRecords().map((r) => r.id)).toEqual(['2', '3'])
  })

  test('notifies listeners and unsubscribes cleanly', () => {
    const hub = new BridgeHub()
    const seen: string[] = []
    const off = hub.onRecord((r) => seen.push(r.id))
    hub.ingest(frame({ id: 'x', url: 'u', method: 'GET' }))
    off()
    hub.ingest(frame({ id: 'y', url: 'u', method: 'GET' }))
    expect(seen).toEqual(['x'])
  })

  test('a throwing listener does not break ingestion', () => {
    const hub = new BridgeHub()
    hub.onRecord(() => {
      throw new Error('boom')
    })
    expect(() => hub.ingest(frame({ id: 'z', url: 'u', method: 'GET' }))).not.toThrow()
    expect(hub.size).toBe(1)
  })

  test('clear empties the buffer', () => {
    const hub = new BridgeHub()
    hub.ingest(frame({ id: '1', url: 'u', method: 'GET' }))
    hub.clear()
    expect(hub.size).toBe(0)
  })

  test('valid control frame is recognised but not buffered, does not notify record listeners', () => {
    const hub = new BridgeHub()
    const seen: string[] = []
    hub.onRecord((r) => seen.push(r.id))
    const result = hub.ingest(controlFrame({ kind: 'throttle.set', profile: 'fast-3g' }))
    expect(result).toEqual({ kind: 'control' })
    expect(hub.size).toBe(0)
    expect(hub.getRecords()).toEqual([])
    expect(seen).toEqual([])
  })

  test('malformed control frame is dropped like any other malformed frame', () => {
    const hub = new BridgeHub()
    expect(hub.ingest(JSON.stringify({ type: 'control' }))).toBeNull()
    expect(hub.ingest(JSON.stringify({ type: 'control', payload: 'not-an-object' }))).toBeNull()
    expect(hub.size).toBe(0)
  })

  test('valid span frame is recognised and buffered, does not notify record listeners', () => {
    const hub = new BridgeHub()
    const seen: string[] = []
    hub.onRecord((r) => seen.push(r.id))
    const result = hub.ingest(spanFrame({ id: 's1', traceId: 't1', parentId: null }))
    expect(result).toEqual({ kind: 'span', span: { id: 's1', traceId: 't1', parentId: null } })
    // Spans never touch the request buffer or its listeners.
    expect(hub.size).toBe(0)
    expect(hub.getRecords()).toEqual([])
    expect(seen).toEqual([])
    // ...but they do land in the span backlog.
    expect(hub.spanSize).toBe(1)
    expect(hub.getSpans()).toEqual([{ id: 's1', traceId: 't1', parentId: null }])
  })

  test('valid console frame is recognised and relayed, never buffered or counted as a record', () => {
    const hub = new BridgeHub()
    const seen: string[] = []
    hub.onRecord((r) => seen.push(r.id))
    const entries = [{ id: 'log_1', timestamp: 1, level: 'info', message: 'hi' }]
    const result = hub.ingest(consoleFrame(entries))
    expect(result).toEqual({ kind: 'console', entries })
    expect(hub.size).toBe(0)
    expect(hub.getRecords()).toEqual([])
    expect(seen).toEqual([])
  })

  test('valid storage frame is recognised, buffered by store name, never counted as a record', () => {
    const hub = new BridgeHub()
    const seen: string[] = []
    hub.onRecord((r) => seen.push(r.id))
    const snapshot = { store: 'defaults', timestamp: 1, entries: { a: 'b' } }
    const result = hub.ingest(storageFrame(snapshot))
    expect(result).toEqual({ kind: 'storage', snapshot })
    expect(hub.size).toBe(0)
    expect(hub.getRecords()).toEqual([])
    expect(seen).toEqual([])
    expect(hub.getStorageSnapshots()).toEqual([snapshot])
  })
})

describe('BridgeHub — storage snapshot-replace', () => {
  test('a second snapshot for the same store replaces the first wholesale, not a diff', () => {
    const hub = new BridgeHub()
    hub.ingest(storageFrame({ store: 'defaults', timestamp: 1, entries: { a: '1', b: '2' } }))
    hub.ingest(storageFrame({ store: 'defaults', timestamp: 2, entries: { a: '1' } }))
    // `b` is gone — the second snapshot fully replaced the first, `b` was
    // never merged forward as a stale leftover.
    expect(hub.getStorageSnapshots()).toEqual([{ store: 'defaults', timestamp: 2, entries: { a: '1' } }])
  })

  test('different store names accumulate independently', () => {
    const hub = new BridgeHub()
    hub.ingest(storageFrame({ store: 'defaults', timestamp: 1, entries: { a: '1' } }))
    hub.ingest(storageFrame({ store: 'cookies', timestamp: 1, entries: { session: 'x' } }))
    const stores = hub
      .getStorageSnapshots()
      .map((s) => s.store)
      .sort()
    expect(stores).toEqual(['cookies', 'defaults'])
  })

  test('clear wipes buffered storage snapshots', () => {
    const hub = new BridgeHub()
    hub.ingest(storageFrame({ store: 'defaults', timestamp: 1, entries: { a: '1' } }))
    hub.clear()
    expect(hub.getStorageSnapshots()).toEqual([])
  })
})

describe('BridgeHub — span backlog', () => {
  test('buffers spans and returns them oldest-first, grouped by trace', () => {
    const hub = new BridgeHub()
    hub.ingest(spanFrame({ id: 's1', traceId: 't1', parentId: null }))
    hub.ingest(spanFrame({ id: 's2', traceId: 't2', parentId: null }))
    hub.ingest(spanFrame({ id: 's3', traceId: 't1', parentId: 's1' }))
    expect(hub.spanSize).toBe(3)
    expect(hub.getSpans().map((s) => s.id)).toEqual(['s1', 's3', 's2'])
  })

  test('bounds a single trace to maxSpansPerTrace, dropping its oldest span', () => {
    const hub = new BridgeHub({ maxSpansPerTrace: 2 })
    hub.ingest(spanFrame({ id: 's1', traceId: 't1', parentId: null }))
    hub.ingest(spanFrame({ id: 's2', traceId: 't1', parentId: 's1' }))
    hub.ingest(spanFrame({ id: 's3', traceId: 't1', parentId: 's2' }))
    expect(hub.spanSize).toBe(2)
    expect(hub.getSpans().map((s) => s.id)).toEqual(['s2', 's3'])
  })

  test('bounds total spans to maxSpans by evicting the whole oldest trace, not individual spans', () => {
    const hub = new BridgeHub({ maxSpans: 3, maxSpansPerTrace: 10 })
    hub.ingest(spanFrame({ id: 's1', traceId: 't1', parentId: null }))
    hub.ingest(spanFrame({ id: 's2', traceId: 't1', parentId: 's1' }))
    // t1 now has 2 spans. Adding t2 with 2 more spans pushes total to 4 (> 3),
    // which must evict all of t1 rather than trimming one span off it.
    hub.ingest(spanFrame({ id: 's3', traceId: 't2', parentId: null }))
    hub.ingest(spanFrame({ id: 's4', traceId: 't2', parentId: 's3' }))
    expect(hub.spanSize).toBe(2)
    expect(hub.getSpans().map((s) => s.id)).toEqual(['s3', 's4'])
  })

  test('clear wipes the span backlog', () => {
    const hub = new BridgeHub()
    hub.ingest(spanFrame({ id: 's1', traceId: 't1', parentId: null }))
    hub.clear()
    expect(hub.spanSize).toBe(0)
    expect(hub.getSpans()).toEqual([])
  })
})

describe('BridgeHub — dedup by id', () => {
  test('re-ingesting an id replaces the buffered record instead of appending', () => {
    const hub = new BridgeHub()
    hub.ingest(frame({ id: 'a', url: 'u', method: 'GET', status: null }))
    hub.ingest(frame({ id: 'a', url: 'u', method: 'GET', status: 200 }))
    expect(hub.size).toBe(1)
    expect(hub.getRecords()[0]?.status).toBe(200) // latest write wins
  })

  test('a whole-store replay (same ids re-sent) is idempotent', () => {
    const hub = new BridgeHub()
    const ids = ['r1', 'r2', 'r3']
    for (const id of ids) hub.ingest(frame({ id, url: 'u', method: 'GET' }))
    // Overlay reconnects and replays everything it holds.
    for (const id of ids) hub.ingest(frame({ id, url: 'u', method: 'GET' }))
    expect(hub.size).toBe(3)
    expect(hub.getRecords().map((r) => r.id)).toEqual(ids)
  })

  test('eviction keeps the id index consistent — replaced ids still land on the right slot', () => {
    const hub = new BridgeHub({ maxRecords: 2 })
    hub.ingest(frame({ id: 'a', url: 'u', method: 'GET' }))
    hub.ingest(frame({ id: 'b', url: 'u', method: 'GET' }))
    hub.ingest(frame({ id: 'c', url: 'u', method: 'GET' })) // evicts 'a'
    expect(hub.getRecords().map((r) => r.id)).toEqual(['b', 'c'])
    // Update 'b' in place — must replace, not append, despite the earlier shift.
    hub.ingest(frame({ id: 'b', url: 'u', method: 'GET', status: 500 }))
    expect(hub.size).toBe(2)
    expect(hub.getRecords().find((r) => r.id === 'b')?.status).toBe(500)
    // An evicted id re-ingested is a fresh append, not a stale-slot write.
    hub.ingest(frame({ id: 'a', url: 'u', method: 'GET' })) // evicts 'b'
    expect(hub.getRecords().map((r) => r.id)).toEqual(['c', 'a'])
  })
})
