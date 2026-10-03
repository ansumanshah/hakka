import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { BridgeHub } from '../BridgeHub'
import { MAX_DIAGNOSTIC_FRAME_BYTES, parseBridgeMessage } from '../protocol'

const metric = { id: 'cpu', kind: 'metric.cpu', schemaVersion: 1, timestamp: 123, processCpuPercent: 175 }
const frame = (payload: unknown): string => JSON.stringify({ type: 'performance', payload })

describe('performance bridge', () => {
  test('relays golden canonical records unchanged without retaining requests', () => {
    const hub = new BridgeHub()
    for (const name of ['performance-bridge-v1.json', 'performance-bridge-missing-v1.json']) {
      const raw = readFileSync(new URL(`../../../../fixtures/performance/${name}`, import.meta.url), 'utf8')
      expect(parseBridgeMessage(raw)).toEqual(JSON.parse(raw))
      expect(hub.ingest(raw)).toEqual({ kind: 'performance', entries: JSON.parse(raw).payload })
    }
    expect(hub.size).toBe(0)
    expect(hub.getRecords()).toEqual([])
    expect(hub.getSpans()).toEqual([])
  })

  test('rejects invalid versions, nonmetrics, fractional bytes and null optional values', () => {
    for (const record of [
      { ...metric, schemaVersion: 2 },
      { ...metric, kind: 'network.request' },
      { ...metric, processCpuPercent: -1 },
      { ...metric, processCpuPercent: null },
      { ...metric, kind: 'metric.memory', pssBytes: 1.5 },
      { ...metric, kind: 'metric.network_usage', rxBytes: Number.MAX_SAFE_INTEGER + 1 },
      { ...metric, kind: 'metric.frame', durationMs: 20, slow: 'true', frozen: false },
      { ...metric, kind: 'metric.js_thread' },
    ])
      expect(parseBridgeMessage(frame([record]))).toBeNull()
  })

  test('accepts at most 100 records and caps record/frame byte sizes', () => {
    expect(parseBridgeMessage(frame(Array.from({ length: 100 }, () => metric)))?.type).toBe('performance')
    expect(parseBridgeMessage(frame(Array.from({ length: 101 }, () => metric)))).toBeNull()
    expect(parseBridgeMessage(frame([{ ...metric, tags: { oversized: 'x'.repeat(8192) } }]))).toBeNull()
    expect(parseBridgeMessage(frame([metric]) + ' '.repeat(MAX_DIAGNOSTIC_FRAME_BYTES))).toBeNull()
  })
})
