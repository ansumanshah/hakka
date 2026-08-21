import type { Exporter } from '../contract/exporter'
import type { NetworkRequest } from '../model/types'
import type { ShareScrubSummary } from '../utils/shareScrub'
import type { BuildReproBundleOptions, ReproBundle, ReproBundleMeta, ReproMockRule } from './buildReproBundle'
import { buildReproBundle, REPRO_BUNDLE_SCHEMA_VERSION } from './buildReproBundle'

/**
 * Versioned `.hakka-repro` JSON serialize/deserialize for a `ReproBundle`.
 * Mirrors `session/serialize.ts`'s conventions (schema-version marker,
 * tolerant parse); see /spec/export for why this is a distinct format.
 */

/** The on-disk / on-wire shape of a `.hakka-repro` file. */
export interface HakkaReproBundleFile {
  hakkaReproBundle: number
  exportedAt?: string
  meta?: ReproBundleMeta
  requests: NetworkRequest[]
  mocks: ReproMockRule[]
  /** Whether share-time scrubbing ran before this file was written, and what it found. Absent on files written before this field existed — `deserializeReproBundle` treats that tolerantly as "unknown," never as "confirmed clean." */
  redaction?: ShareScrubSummary
}

/** Result of a successful `deserializeReproBundle` parse. */
export interface DeserializedReproBundle {
  requests: NetworkRequest[]
  mocks: ReproMockRule[]
  meta?: ReproBundleMeta
  version: number
  /** `undefined` when the file predates this field — treat as unknown scrub status, not as "not scrubbed." */
  redaction?: ShareScrubSummary
}

/**
 * Serialize a `ReproBundle` into a versioned `.hakka-repro` JSON string.
 */
export function serializeReproBundle(bundle: ReproBundle): string {
  const file: HakkaReproBundleFile = {
    hakkaReproBundle: bundle.version ?? REPRO_BUNDLE_SCHEMA_VERSION,
    ...(bundle.exportedAt !== undefined ? { exportedAt: bundle.exportedAt } : {}),
    ...(bundle.meta !== undefined ? { meta: bundle.meta } : {}),
    requests: [...bundle.requests],
    mocks: [...bundle.mocks],
    ...(bundle.redaction !== undefined ? { redaction: bundle.redaction } : {}),
  }
  return JSON.stringify(file, null, 2)
}

/**
 * Parse a `.hakka-repro` JSON string back into a `ReproBundle`'s constituent
 * parts. Tolerant parse: unknown/extra fields on the payload or on individual
 * requests/mocks are ignored rather than rejected, so older or newer bundle
 * files still load.
 *
 * @throws {Error} when the input is not valid JSON, or is valid JSON that is
 *   not a recognisable Hakka repro bundle payload (missing `hakkaReproBundle`
 *   marker, or `requests`/`mocks` is not an array).
 */
export function deserializeReproBundle(json: string): DeserializedReproBundle {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`deserializeReproBundle: invalid JSON — ${reason}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('deserializeReproBundle: not a Hakka repro bundle payload (expected a JSON object)')
  }

  const obj = parsed as Record<string, unknown>

  if (typeof obj.hakkaReproBundle !== 'number') {
    throw new Error(
      'deserializeReproBundle: not a Hakka repro bundle payload (missing "hakkaReproBundle" schema marker)',
    )
  }

  if (!Array.isArray(obj.requests)) {
    throw new Error('deserializeReproBundle: not a Hakka repro bundle payload ("requests" is missing or not an array)')
  }

  if (!Array.isArray(obj.mocks)) {
    throw new Error('deserializeReproBundle: not a Hakka repro bundle payload ("mocks" is missing or not an array)')
  }

  const meta =
    typeof obj.meta === 'object' && obj.meta !== null && !Array.isArray(obj.meta)
      ? (obj.meta as ReproBundleMeta)
      : undefined

  const redaction =
    typeof obj.redaction === 'object' && obj.redaction !== null && !Array.isArray(obj.redaction)
      ? (obj.redaction as ShareScrubSummary)
      : undefined

  return {
    requests: obj.requests as NetworkRequest[],
    mocks: obj.mocks as ReproMockRule[],
    ...(meta !== undefined ? { meta } : {}),
    ...(redaction !== undefined ? { redaction } : {}),
    version: obj.hakkaReproBundle,
  }
}

/**
 * `Exporter` (ADR 0009) wrapper around `buildReproBundle()` +
 * `serializeReproBundle()` (this module owns the "last mile to a string"
 * step, so the wrapper lives here rather than on `buildReproBundle.ts` —
 * that module already depends on this one, and a wrapper needing both
 * functions the other way round would create an import cycle for no
 * benefit). The ONE exporter on this contract that declares `lossy: false`:
 * `requests` are stored verbatim inside the bundle (`buildReproBundle`'s own
 * `[...requests]` — no field is dropped, redacted, or projected) and
 * `deserializeReproBundle` above reads them back byte-for-byte unchanged;
 * the only thing added is the derived `mocks` array, which is new
 * information, not lost information. `options` (meta, mock-generation
 * options, `exportedAt`) is captured at construction time, not per-call.
 *
 * `buildReproBundle` defaults to share-time scrubbing ON (see its
 * docblock) because most callers (the `generate_repro` MCP tool chief among
 * them) build a bundle specifically to hand to an agent or file as a bug.
 * This exporter is the one caller that must NOT inherit that default: it is
 * the `Exporter` contract's byte-for-byte "save this session to a file"
 * path, `lossy: false` is a binding claim `exporterConformance.ts` checks,
 * and scrubbing is itself a lossy transform. `scrub` is force-set to
 * `false` here regardless of what `options` requests, so a caller wanting a
 * scrubbed `.hakka-repro` file must call `buildReproBundle` +
 * `serializeReproBundle` directly rather than through this wrapper.
 */
export function createReproBundleExporter(options?: BuildReproBundleOptions): Exporter {
  return {
    id: 'hakka.repro-bundle',
    label: 'Repro Bundle (.hakka-repro)',
    fileExtension: 'hakka-repro',
    mimeType: 'application/json',
    lossy: false,
    includesBodies: true,
    streaming: false,
    export(requests) {
      return serializeReproBundle(buildReproBundle([...requests], { ...options, scrub: false }))
    },
  }
}
