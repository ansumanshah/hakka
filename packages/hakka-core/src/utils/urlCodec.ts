/**
 * URL encode/decode helpers for the Hakka inspector display toggle.
 * Platform-neutral — no DOM or browser-only deps.
 */

/** True if the string contains at least one percent-encoded sequence (%XX). */
export function isUrlEncoded(url: string): boolean {
  return /%[0-9A-Fa-f]{2}/.test(url)
}

/** Falls back to the original string if `decodeURIComponent` throws (malformed %XX). */
export function decodeUrl(url: string): string {
  try {
    return decodeURIComponent(url)
  } catch {
    return url
  }
}

/**
 * Re-encode a decoded URL for display, escaping everything except characters legal
 * unencoded in a URI (RFC 3986 unreserved + sub-delimiters + structural chars).
 * Idempotent: already-encoded strings (containing %XX) are returned as-is.
 */
export function encodeUrl(url: string): string {
  const SAFE_PATH = /[A-Za-z0-9\-._~!$&'()*+,;=:@/%?#[\]]/

  if (isUrlEncoded(url)) return url

  return url
    .split('')
    .map((ch) => (SAFE_PATH.test(ch) ? ch : encodeURIComponent(ch)))
    .join('')
}
