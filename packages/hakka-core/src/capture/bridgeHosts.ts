/**
 * Hakka's own bridge endpoints — every interceptor skips URLs containing these so the SDK
 * never captures its own bridge traffic (a feedback loop). 8989 is the bridge hub's default
 * port (mirrored here since core can't import hakka-bridge without a cycle); 8990 is its
 * reserved fallback. Internal — not exported from index.ts.
 */
const BRIDGE_HOST_MARKERS = ['localhost:8989', 'localhost:8990']

/** True when `url` targets Hakka's own bridge — capture must skip it. */
export function isOwnBridgeUrl(url: string): boolean {
  return BRIDGE_HOST_MARKERS.some((marker) => url.includes(marker))
}
