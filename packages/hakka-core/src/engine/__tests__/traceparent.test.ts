import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import { buildTraceparent, deriveTraceId } from '../traceparent'

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i

describe('traceparent', () => {
  describe('deriveTraceId', () => {
    it('strips dashes from a UUID-shaped correlationId', () => {
      expect(deriveTraceId('491a91c3-8b12-496a-94ab-d86bae71b8ed')).toBe('491a91c38b12496a94abd86bae71b8ed')
    })

    it('passes a 32-hex correlationId through unchanged (lowercased)', () => {
      const hex = '3037E8F4E14C65FC97FB7DAE597B053A'
      expect(deriveTraceId(hex)).toBe(hex.toLowerCase())
    })

    it('hashes any other string to a deterministic 32-hex value', () => {
      const a = deriveTraceId('not-a-uuid')
      expect(a).toMatch(/^[0-9a-f]{32}$/)
      expect(deriveTraceId('not-a-uuid')).toBe(a)
    })

    it('preserves SHA-256 prefixes across padding boundaries, Unicode and cache eviction', () => {
      const ids = [
        '',
        'abc',
        'network-r_1999',
        'é漢字🚀',
        '\ud800',
        ...[55, 56, 63, 64, 65, 119, 120, 127, 128, 199, 200].map((length) => 'x'.repeat(length)),
        ...Array.from({ length: 600 }, (_, index) => `synthetic-${index}`),
      ]
      for (const id of [...ids, ...ids.toReversed()]) {
        expect(deriveTraceId(id)).toBe(createHash('sha256').update(id).digest('hex').slice(0, 32))
      }
    })

    it('different correlationIds derive different trace-ids', () => {
      expect(deriveTraceId('trace-a')).not.toBe(deriveTraceId('trace-b'))
    })
  })

  describe('buildTraceparent', () => {
    it('produces a well-formed traceparent whose trace-id matches deriveTraceId', () => {
      const header = buildTraceparent('T-CLIENT')
      const match = TRACEPARENT_RE.exec(header)
      expect(match).not.toBeNull()
      expect(match?.[2]).toBe(deriveTraceId('T-CLIENT'))
      expect(match?.[1]).toBe('00')
      expect(match?.[4]).toBe('01')
    })

    it('generates a fresh span id per call', () => {
      const a = buildTraceparent('T-CLIENT')
      const b = buildTraceparent('T-CLIENT')
      const spanA = TRACEPARENT_RE.exec(a)?.[3]
      const spanB = TRACEPARENT_RE.exec(b)?.[3]
      expect(spanA).not.toBe(spanB)
    })
  })
})
