/**
 * Minimal HAR 1.2 → NetworkRequest loader for `hakka diagnose`.
 *
 * Only reads the fields analyzeRequests actually looks at (status, duration,
 * headers, bodies, method, url) — this is a read path for third-party HAR
 * files (e.g. exported from Chrome DevTools), not a full round-trip of
 * `model/har.ts`'s `buildHar` output.
 */
import type { NetworkRequest } from 'hakka-core'

interface HarNameValue {
  name: string
  value: string
}

interface HarContent {
  size?: number
  mimeType?: string
  text?: string
}

interface HarRequest {
  method?: string
  url?: string
  headers?: HarNameValue[]
  postData?: { mimeType?: string; text?: string }
}

interface HarResponse {
  status?: number
  headers?: HarNameValue[]
  content?: HarContent
}

interface HarEntry {
  startedDateTime?: string
  time?: number
  request?: HarRequest
  response?: HarResponse
}

interface HarFile {
  log?: {
    entries?: HarEntry[]
  }
}

function headersToRecord(headers?: HarNameValue[]): Record<string, string> | undefined {
  if (!headers || headers.length === 0) return undefined
  const out: Record<string, string> = {}
  for (const h of headers) out[h.name] = h.value
  return out
}

/** True when the parsed JSON looks like a HAR 1.2 log (`{ log: { entries: [...] } }`). */
export function isHarPayload(parsed: unknown): parsed is HarFile {
  if (typeof parsed !== 'object' || parsed === null) return false
  const log = (parsed as Record<string, unknown>).log
  return typeof log === 'object' && log !== null && Array.isArray((log as Record<string, unknown>).entries)
}

/** Convert a HAR 1.2 payload's entries into Hakka's NetworkRequest shape. */
export function harToRequests(har: HarFile): NetworkRequest[] {
  const entries = har.log?.entries ?? []
  return entries.map((entry, i) => {
    const startTime = entry.startedDateTime ? new Date(entry.startedDateTime).getTime() : 0
    const duration = entry.time
    const req = entry.request ?? {}
    const res = entry.response ?? {}
    const out: NetworkRequest = {
      id: `har-${i}`,
      url: req.url ?? '',
      method: (req.method ?? 'GET').toUpperCase(),
      status: res.status ?? null,
      startTime,
      duration: duration ?? null,
      requestHeaders: headersToRecord(req.headers),
      responseHeaders: headersToRecord(res.headers),
      requestBody: req.postData?.text ?? null,
      responseBody: res.content?.text ?? null,
      responseBodySize: res.content?.size,
      contentType: res.content?.mimeType,
      timestamp: startTime || undefined,
    }
    return out
  })
}
