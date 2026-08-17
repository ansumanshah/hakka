/** Truncates bodies over the size limit (with a marker) to prevent OOM on large payloads. */

export const DEFAULT_MAX_BODY_SIZE = 100 * 1024

const TRUNCATION_MARKER = '\n[TRUNCATED — body exceeded size limit]'

export const limitBodySize = (
  body: string | undefined,
  maxBytes: number = DEFAULT_MAX_BODY_SIZE,
): string | undefined => {
  if (body === undefined || body === null) return body
  if (body.length <= maxBytes) return body
  return body.substring(0, maxBytes) + TRUNCATION_MARKER
}

export const isBodyTruncated = (body?: string): boolean => {
  if (!body) return false
  return body.endsWith(TRUNCATION_MARKER)
}

/** String length — exact for ASCII, an approximation for UTF-8. */
export const estimateBodySize = (body?: string): number => {
  if (!body) return 0
  return body.length
}
