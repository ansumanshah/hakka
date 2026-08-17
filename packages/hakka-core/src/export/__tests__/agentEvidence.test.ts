import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { buildEvidenceBundle } from '../../repro/buildEvidenceBundle'
import { formatEvidenceBundleForAgent } from '../agentEvidence'

const EXPORTED_AT = '2026-01-01T00:00:00.000Z'

function req(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/checkout',
    method: 'POST',
    status: 500,
    startTime: 0,
    endTime: 10,
    ...overrides,
  }
}

/** Pulls the single ```json fenced block's contents out of the formatted string. */
function extractJsonFence(formatted: string): string {
  const match = formatted.match(/```json\n([\s\S]*?)\n```/)
  if (!match?.[1]) throw new Error('no ```json fence found')
  return match[1]
}

describe('formatEvidenceBundleForAgent', () => {
  test('preamble is 2-3 lines before the json fence', () => {
    const bundle = buildEvidenceBundle([req()], { exportedAt: EXPORTED_AT })
    const formatted = formatEvidenceBundleForAgent(bundle)
    const preamble = formatted.split('```json')[0]!
    const lines = preamble.split('\n').filter((l) => l.trim().length > 0)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  test('contains exactly one ```json fence', () => {
    const bundle = buildEvidenceBundle([req()], { exportedAt: EXPORTED_AT })
    const formatted = formatEvidenceBundleForAgent(bundle)
    const occurrences = formatted.match(/```json/g) ?? []
    expect(occurrences).toHaveLength(1)
    expect(formatted.match(/```/g)).toHaveLength(2)
  })

  test('the fenced block round-trips via JSON.parse to the same EvidenceBundle passed in', () => {
    const bundle = buildEvidenceBundle(
      [req(), req({ id: 'req-2', startTime: 5, url: 'https://api.example.com/next' })],
      {
        exportedAt: EXPORTED_AT,
      },
    )
    const formatted = formatEvidenceBundleForAgent(bundle)
    const parsed = JSON.parse(extractJsonFence(formatted))
    expect(parsed).toEqual(bundle)
  })

  test('preamble mentions the focal request method + path + outcome', () => {
    const bundle = buildEvidenceBundle([req({ status: 500 })], { exportedAt: EXPORTED_AT })
    const formatted = formatEvidenceBundleForAgent(bundle)
    expect(formatted).toContain('POST /checkout')
    expect(formatted).toContain('500')
  })

  test('appends an optional reason to the preamble', () => {
    const bundle = buildEvidenceBundle([req()], { exportedAt: EXPORTED_AT })
    const formatted = formatEvidenceBundleForAgent(bundle, { reason: 'checkout 500s under load' })
    expect(formatted).toContain('checkout 500s under load')
  })

  test('handles an empty-requests bundle without throwing', () => {
    const bundle = buildEvidenceBundle([], { exportedAt: EXPORTED_AT })
    expect(() => formatEvidenceBundleForAgent(bundle)).not.toThrow()
    const formatted = formatEvidenceBundleForAgent(bundle)
    const parsed = JSON.parse(extractJsonFence(formatted))
    expect(parsed).toEqual(bundle)
  })
})
