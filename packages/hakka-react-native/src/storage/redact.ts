/**
 * Shared storage-value redaction.
 *
 * Used by both the monkey-patch storage monitors (`monitors/storage.ts`) and
 * the live Storage tab / bridge publisher (`ui/screens/StorageViewer.tsx`,
 * `core/HakkaBridge.ts`) so a value never leaves the device unredacted
 * regardless of which path reads it — one shared implementation instead of
 * each call site rolling its own.
 *
 * Storage is where tokens and credentials are *persisted*, not merely where
 * they transit, so this reuses the same `configureBodyRedaction` field list
 * a host app has already set for network bodies. Two passes:
 *
 * - If the key names a sensitive field, blank the whole value. Matching is a
 *   substring test, not exact, because storage keys are namespaced in
 *   practice (`@myapp:auth_token` should match a configured `token`).
 * - Otherwise run the value through JSON body redaction, so a stored blob
 *   whose *fields* are sensitive is covered too.
 *
 * With no fields configured this is the same no-op it is everywhere else.
 */
import { getBodyRedactionFields, redactJsonBody } from 'hakka-core'

const REDACTED = '[REDACTED]'

export function redactStorageValue(key: string, value: unknown): unknown {
  const fields = getBodyRedactionFields()
  if (fields.length === 0 || value == null) return value

  const lowerKey = key.toLowerCase()
  if (fields.some((field) => lowerKey.includes(field))) return REDACTED

  if (typeof value !== 'string') return value
  return redactJsonBody(value, fields) ?? value
}

/**
 * `redactStorageValue` specialised for the bridge's `StorageSnapshot.entries`
 * shape (`Record<string, string>`, every value already a string). Used to
 * redact a whole snapshot in one pass before it's sent over the bridge.
 */
export function redactStorageEntries(entries: Record<string, string>): Record<string, string> {
  const fields = getBodyRedactionFields()
  if (fields.length === 0) return entries
  const redacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(entries)) {
    redacted[key] = redactStorageValue(key, value) as string
  }
  return redacted
}
