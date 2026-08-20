import type { Exporter } from '../contract/exporter'
import type { NetworkRequest } from '../model/types'
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
}

/** Result of a successful `deserializeReproBundle` parse. */
export interface DeserializedReproBundle {
  requests: NetworkRequest[]
  mocks: ReproMockRule[]
  meta?: ReproBundleMeta
  version: number
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

  return {
    requests: obj.requests as NetworkRequest[],
    mocks: obj.mocks as ReproMockRule[],
    ...(meta !== undefined ? { meta } : {}),
    version: obj.hakkaReproBundle,
  }
}

/**
 * `Exporter` (ADR 0003) wrapper around `buildReproBundle()` +
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
      return serializeReproBundle(buildReproBundle([...requests], options))
    },
  }
}
