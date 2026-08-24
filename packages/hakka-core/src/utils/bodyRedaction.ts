/**
 * Body redaction — replaces sensitive JSON field values with a placeholder before a
 * NetworkRequest is stored. Mirrors headerRedaction.ts, but walks parsed JSON instead
 * of a flat header map.
 */

const REDACTION_PLACEHOLDER = '[REDACTED]'
const MAX_DEPTH = 100

let configuredFields: string[] = []

/** Configure JSON body field names to redact (case-insensitive, exact match, no glob/regex). Empty array (default) disables redaction — zero overhead on the capture hot path. */
export function configureBodyRedaction(fields: string[]): void {
  configuredFields = fields.map((f) => f.toLowerCase())
}

/**
 * Return the currently configured body redaction fields (lowercased).
 */
export function getBodyRedactionFields(): string[] {
  return configuredFields
}

/**
 * Set `k` as an own property of `obj`, even when `k` is the literal string `"__proto__"` —
 * plain assignment (`obj[k] = v`) routes that key through `Object.prototype`'s `__proto__`
 * accessor ([[Set]]) instead of creating an own property, silently reassigning `obj`'s
 * prototype and dropping the key from the rebuilt object entirely. `defineProperty` creates
 * the own property directly, bypassing the inherited accessor.
 */
function setOwn(obj: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(obj, k, { value: v, writable: true, enumerable: true, configurable: true })
}

/** Replace values of keys matching `fields` (lowercased) with the redaction placeholder. `depth` bounds recursion against stack overflow on pathological input. */
function redactValue(value: unknown, fields: string[], depth: number): unknown {
  if (depth > MAX_DEPTH) return value

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, fields, depth + 1))
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (fields.includes(k.toLowerCase())) {
        setOwn(result, k, REDACTION_PLACEHOLDER)
      } else {
        setOwn(result, k, redactValue(v, fields, depth + 1))
      }
    }
    return result
  }

  return value
}

/**
 * Redact sensitive field values inside a JSON body string. Non-JSON or empty input, and any
 * error, returns `body` unchanged — this must never throw on the capture path.
 *
 * @param body - Raw body string to process
 * @param fields - Lowercased field names to redact (defaults to configured fields)
 */
export function redactJsonBody(body: string | null | undefined, fields?: string[]): string | null {
  if (body == null || body === '') return null

  // Explicit fields need lowercasing here; configuredFields is already lowercased.
  const activeFields = fields != null ? fields.map((f) => f.toLowerCase()) : configuredFields
  if (activeFields.length === 0) return body

  try {
    const parsed: unknown = JSON.parse(body)

    if (parsed === null || (typeof parsed !== 'object' && !Array.isArray(parsed))) {
      return body
    }

    const redacted = redactValue(parsed, activeFields, 0)
    return JSON.stringify(redacted)
  } catch {
    return body
  }
}

/** Same parse as redactJsonBody, returning `undefined` instead of throwing — lets a caller that needs the parsed value for more than one purpose (fetch.ts: redaction + GraphQL metadata) parse the body exactly once. */
export function tryParseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/** Result of redacting an already-parsed JSON value — see {@link redactParsedBody}. */
export interface ParsedBodyRedaction {
  /** The re-stringified, redacted body — or `rawBody` unchanged when there was nothing to redact. */
  text: string
  /** Possibly-redacted value — read the POST-redaction value without re-parsing `text`, so a redacted field's real value never leaks into anything derived afterwards (e.g. GraphQL extraction). */
  value: unknown
}

/** Parse-once counterpart to tryParseJsonBody/redactJsonBody: redacts an already-parsed value instead of re-parsing `rawBody`. `rawBody` must be non-null/non-empty. */
export function redactParsedBody(rawBody: string, parsed: unknown, fields?: string[]): ParsedBodyRedaction {
  const activeFields = fields != null ? fields.map((f) => f.toLowerCase()) : configuredFields
  if (activeFields.length === 0) return { text: rawBody, value: parsed }

  if (parsed === null || parsed === undefined || (typeof parsed !== 'object' && !Array.isArray(parsed))) {
    return { text: rawBody, value: parsed }
  }

  try {
    const redacted = redactValue(parsed, activeFields, 0)
    return { text: JSON.stringify(redacted), value: redacted }
  } catch {
    // redactValue/JSON.stringify shouldn't throw on parser output, but never break capture.
    return { text: rawBody, value: parsed }
  }
}
