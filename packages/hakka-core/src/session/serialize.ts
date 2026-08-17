import type { NetworkRequest } from '../model/types'

/**
 * Session serialize/deserialize — a portable `.hakka` JSON snapshot of captured
 * requests, for save/share/re-open workflows. Pure, versioned, and tolerant to
 * parse, mirroring the schema-versioning conventions used elsewhere in `model/`.
 */

/** Current `.hakka` session file schema version. Bump on breaking shape changes. */
export const SESSION_SCHEMA_VERSION = 1

/** Free-form metadata attached to a session export (device, app version, notes, …). */
export type SessionMeta = Record<string, unknown>

/** The on-disk / on-wire shape of a `.hakka` session file. */
export interface HakkaSessionFile {
  hakkaSession: number
  exportedAt?: string
  meta?: SessionMeta
  requests: NetworkRequest[]
}

/** Result of a successful `deserializeSession` parse. */
export interface DeserializedSession {
  requests: NetworkRequest[]
  meta?: SessionMeta
  version: number
}

/** Serializes captured requests into a versioned `.hakka` session JSON string. */
export function serializeSession(requests: readonly NetworkRequest[], meta?: SessionMeta): string {
  const file: HakkaSessionFile = {
    hakkaSession: SESSION_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ...(meta !== undefined ? { meta } : {}),
    requests: [...requests],
  }
  return JSON.stringify(file, null, 2)
}

/**
 * Parses a `.hakka` session JSON string back into requests + metadata. Tolerant
 * parse: unknown/extra fields are ignored rather than rejected, so older or newer
 * session files still load.
 *
 * @throws {Error} when the input is not valid JSON, or is valid JSON that is not
 *   a recognisable Hakka session payload (missing `hakkaSession` marker, or
 *   `requests` is not an array).
 */
export function deserializeSession(json: string): DeserializedSession {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`deserializeSession: invalid JSON — ${reason}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('deserializeSession: not a Hakka session payload (expected a JSON object)')
  }

  const obj = parsed as Record<string, unknown>

  if (typeof obj.hakkaSession !== 'number') {
    throw new Error('deserializeSession: not a Hakka session payload (missing "hakkaSession" schema marker)')
  }

  if (!Array.isArray(obj.requests)) {
    throw new Error('deserializeSession: not a Hakka session payload ("requests" is missing or not an array)')
  }

  const meta =
    typeof obj.meta === 'object' && obj.meta !== null && !Array.isArray(obj.meta)
      ? (obj.meta as SessionMeta)
      : undefined

  return {
    requests: obj.requests as NetworkRequest[],
    ...(meta !== undefined ? { meta } : {}),
    version: obj.hakkaSession,
  }
}
