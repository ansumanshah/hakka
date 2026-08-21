import type { MockRuleInput } from '../engine/MockEngine'
import { generateMockRules } from '../engine/mockFromTraffic'
import type { GenerateMockRulesOptions } from '../engine/mockFromTraffic'
import type { NetworkRequest } from '../model/types'
import { scrubRequestsForShare } from '../utils/shareScrub'
import type { ShareScrubOptions, ShareScrubSummary } from '../utils/shareScrub'

/**
 * Turns a failing request (or a filtered session slice) into a self-contained
 * repro bundle: the requests plus the mock rules (`generateMockRules`) that
 * replay them offline. Core's root export owns requests+mocks only — the
 * regression test file is stitched on by the `generate_repro` MCP tool, not
 * here. See /spec/export for the full design rationale.
 *
 * Share-time scrubbing (`shareScrub.ts`) runs by default before mocks are
 * derived — a repro bundle is built to hand to someone else or file as a bug,
 * so both `requests` and the mocks generated FROM them must not carry
 * secrets by default (a mock built from an unscrubbed capture would replay
 * the secret value forever). `redaction` on the returned bundle always says
 * whether the pass ran and exactly what it found — never silent.
 */

/** Current `.hakka-repro` file schema version. Bump on breaking shape changes. */
export const REPRO_BUNDLE_SCHEMA_VERSION = 1

/** Free-form metadata attached to a repro bundle export (device, app version, notes, failure description, …). */
export type ReproBundleMeta = Record<string, unknown>

/** A generated mock rule, with its minted `id`. */
export type ReproMockRule = MockRuleInput & { id: string }

/** The in-memory (and on-disk / on-wire) shape of a Hakka repro bundle. */
export interface ReproBundle {
  version: number
  exportedAt?: string
  meta?: ReproBundleMeta
  requests: NetworkRequest[]
  mocks: ReproMockRule[]
  /** Whether share-time scrubbing ran on this bundle and what it found. See `shareScrub.ts`. */
  redaction: ShareScrubSummary
}

export interface BuildReproBundleOptions {
  /** Free-form metadata to attach (failure description, device, app version, …). */
  meta?: ReproBundleMeta
  /** Forwarded to `generateMockRules` — e.g. a custom `idPrefix` for minted mock rule ids. Default idPrefix: 'repro'. */
  mockOptions?: GenerateMockRulesOptions
  /** ISO timestamp to stamp the bundle with. Default: `new Date().toISOString()`. Mainly for deterministic tests. */
  exportedAt?: string
  /**
   * Apply share-time scrubbing (`shareScrub.ts`) before bundling. Default true: a repro
   * bundle exists to leave this machine, so it defaults to scrubbed and the developer
   * opts OUT explicitly (e.g. when the requests were already scrubbed upstream, as
   * `buildEvidenceBundle` does to avoid a redundant second pass).
   */
  scrub?: boolean
  /** Forwarded to the scrub pass when `scrub` is true (or defaulted true). */
  scrubOptions?: ShareScrubOptions
}

/** Builds a self-contained repro bundle (requests + derived mocks) from already-captured requests. Scrubs for share by default — see the module docblock and `BuildReproBundleOptions.scrub`. */
export function buildReproBundle(requests: NetworkRequest[], options: BuildReproBundleOptions = {}): ReproBundle {
  const scrub = options.scrub ?? true
  const { requests: sourceRequests, removed } = scrub
    ? scrubRequestsForShare(requests, options.scrubOptions)
    : { requests: [...requests], removed: [] as ShareScrubSummary['removed'] }

  const mocks = generateMockRules(sourceRequests, { idPrefix: 'repro', ...options.mockOptions })

  const bundle: ReproBundle = {
    version: REPRO_BUNDLE_SCHEMA_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    ...(options.meta !== undefined ? { meta: options.meta } : {}),
    requests: sourceRequests,
    mocks,
    redaction: { applied: scrub, removed },
  }
  return bundle
}
