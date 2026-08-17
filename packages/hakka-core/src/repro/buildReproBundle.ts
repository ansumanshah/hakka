import type { MockRuleInput } from '../engine/MockEngine'
import { generateMockRules } from '../engine/mockFromTraffic'
import type { GenerateMockRulesOptions } from '../engine/mockFromTraffic'
import type { NetworkRequest } from '../model/types'

/**
 * Turns a failing request (or a filtered session slice) into a self-contained
 * repro bundle: the requests plus the mock rules (`generateMockRules`) that
 * replay them offline. Core's root export owns requests+mocks only — the
 * regression test file is stitched on by the `generate_repro` MCP tool, not
 * here. See /spec/export for the full design rationale.
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
}

export interface BuildReproBundleOptions {
  /** Free-form metadata to attach (failure description, device, app version, …). */
  meta?: ReproBundleMeta
  /** Forwarded to `generateMockRules` — e.g. a custom `idPrefix` for minted mock rule ids. Default idPrefix: 'repro'. */
  mockOptions?: GenerateMockRulesOptions
  /** ISO timestamp to stamp the bundle with. Default: `new Date().toISOString()`. Mainly for deterministic tests. */
  exportedAt?: string
}

/** Builds a self-contained repro bundle (requests + derived mocks) from already-captured requests. */
export function buildReproBundle(requests: NetworkRequest[], options: BuildReproBundleOptions = {}): ReproBundle {
  const mocks = generateMockRules(requests, { idPrefix: 'repro', ...options.mockOptions })

  const bundle: ReproBundle = {
    version: REPRO_BUNDLE_SCHEMA_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    ...(options.meta !== undefined ? { meta: options.meta } : {}),
    requests: [...requests],
    mocks,
  }
  return bundle
}
