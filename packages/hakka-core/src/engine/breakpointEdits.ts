import type { PausedRequest, PausedResponse } from './BreakpointEngine'

function isSameHeaderSet(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k])
}

/**
 * Keep only the request edits that differ from what the pause handed out. A client that echoes
 * the paused values back (the body is a redacted text preview, or `null` for an over-cap,
 * FormData, or stream body) must not replace the app's real request with that preview.
 */
export function changedRequestEdits(
  handed: PausedRequest,
  edits: Partial<PausedRequest> | undefined,
): Partial<PausedRequest> {
  const changed: Partial<PausedRequest> = {}
  if (!edits) return changed
  if (edits.url != null && edits.url !== handed.url) changed.url = edits.url
  if (edits.method != null && edits.method.toUpperCase() !== handed.method.toUpperCase()) {
    changed.method = edits.method
  }
  if (edits.headers != null && !isSameHeaderSet(edits.headers, handed.headers)) changed.headers = edits.headers
  if (edits.body !== undefined && edits.body !== handed.body) changed.body = edits.body
  return changed
}

/** Response counterpart of {@link changedRequestEdits}: an unchanged field keeps the real response's value. */
export function changedResponseEdits(
  handed: PausedResponse,
  edits: Partial<PausedResponse> | undefined,
): Partial<PausedResponse> {
  const changed: Partial<PausedResponse> = {}
  if (!edits) return changed
  if (edits.status != null && edits.status !== handed.status) changed.status = edits.status
  if (edits.headers != null && !isSameHeaderSet(edits.headers, handed.headers)) changed.headers = edits.headers
  if (edits.body !== undefined && edits.body !== handed.body) changed.body = edits.body
  return changed
}
