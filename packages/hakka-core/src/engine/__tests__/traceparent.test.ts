import { describe, expect, it } from 'bun:test'

import { TRACEPARENT_HEADER, buildTraceparent, deriveTraceId } from '../traceparent'

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i

describe('traceparent', () => {
  it('exposes the W3C header name', () => {
    expect(TRACEPARENT_HEADER).toBe('traceparent')
  })

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

    it('different correlationIds derive different trace-ids', () => {
      expect(deriveTraceId('trace-a')).not.toBe(deriveTraceId('trace-b'))
    })

    // Known SHA-256 test vectors (FIPS 180-4) — the hash-fallback branch
    // truncates the digest to its first 32 hex chars.
    it('matches the known SHA-256 vector for the empty string', () => {
      expect(deriveTraceId('')).toBe('e3b0c44298fc1c149afbf4c8996fb924')
    })

    it('matches the known SHA-256 vector for "abc"', () => {
      expect(deriveTraceId('abc')).toBe('ba7816bf8f01cfea414140de5dae2223')
    })

    it('handles a >64-byte message needing two blocks the same as a short one (no length-dependent bug)', () => {
      const long = 'x'.repeat(200)
      const digest = deriveTraceId(long)
      expect(digest).toMatch(/^[0-9a-f]{32}$/)
      expect(deriveTraceId(long)).toBe(digest)
      expect(digest).not.toBe(deriveTraceId('x'.repeat(199)))
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
