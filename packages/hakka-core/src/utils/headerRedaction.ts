/** Header redaction (replace sensitive values with a placeholder) and stripping (remove the header entirely). */

import { globToRegExp, regexLiteralToRegExp } from './patternUtils'

/** Default sensitive header names (case-insensitive) */
export const DEFAULT_SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'proxy-authorization',
  'www-authenticate',
  // Expanded coverage for common secret-bearing headers
  'x-token',
  'token',
  'x-secret',
  'x-session-token',
  'x-amz-security-token',
  'private-token',
  'x-client-secret',
  'session',
  // Glob patterns catch future variants (x-foo-token, x-bar-secret, etc.)
  'x-*-token',
  'x-*-secret',
]

const REDACTION_PLACEHOLDER = '[REDACTED]'

/** A pattern compiled to its cheapest matcher form; cached so `isSensitiveHeader` never calls `new RegExp` per header on the capture hot path. */
type CompiledPattern = { kind: 'regex' | 'glob'; re: RegExp } | { kind: 'literal'; lower: string }

const patternCache = new Map<string, CompiledPattern>()

const compilePattern = (pattern: string): CompiledPattern => {
  const cached = patternCache.get(pattern)
  if (cached) return cached
  const literal = regexLiteralToRegExp(pattern)
  const compiled: CompiledPattern = literal
    ? { kind: 'regex', re: literal }
    : pattern.includes('*')
      ? { kind: 'glob', re: globToRegExp(pattern) }
      : { kind: 'literal', lower: pattern.toLowerCase() }
  patternCache.set(pattern, compiled)
  return compiled
}

const matchesHeaderPattern = (headerName: string, pattern: string): boolean => {
  const compiled = compilePattern(pattern)
  if (compiled.kind === 'literal') return headerName.toLowerCase() === compiled.lower
  return compiled.re.test(headerName)
}

/** A pattern list split once into a lowercased-literal Set (O(1) membership, the common case) plus the small remainder of glob/regex patterns needing a fallback scan. */
interface PatternGroup {
  literals: Set<string>
  rest: string[]
}

/** Cached by list identity (WeakMap): config.redactHeaders is a stable array, so this hits cache on the hot capture path; a fresh array literal just misses and recomputes — correctness is unaffected either way. */
const patternGroupCache = new WeakMap<string[], PatternGroup>()

const getPatternGroup = (sensitiveHeaders: string[]): PatternGroup => {
  const cached = patternGroupCache.get(sensitiveHeaders)
  if (cached) return cached

  const literals = new Set<string>()
  const rest: string[] = []
  for (const pattern of sensitiveHeaders) {
    const compiled = compilePattern(pattern)
    if (compiled.kind === 'literal') {
      literals.add(compiled.lower)
    } else {
      rest.push(pattern)
    }
  }
  const group: PatternGroup = { literals, rest }
  patternGroupCache.set(sensitiveHeaders, group)
  return group
}

/** Whether `headerName` is covered by any pattern in `sensitiveHeaders` (O(1) for the common literal case). */
const matchesSensitiveList = (headerName: string, sensitiveHeaders: string[]): boolean => {
  const { literals, rest } = getPatternGroup(sensitiveHeaders)
  if (literals.has(headerName.toLowerCase())) return true
  return rest.some((pattern) => matchesHeaderPattern(headerName, pattern))
}

/**
 * Redact (replace with placeholder) sensitive header values.
 * Case-insensitive matching. The header key is preserved; only the value changes.
 *
 * @param headers - Headers object to process
 * @param sensitiveHeaders - Header names to redact (defaults to DEFAULT_SENSITIVE_HEADERS)
 * @returns New headers object with sensitive values replaced
 */
export const redactHeaders = (
  headers?: Record<string, string>,
  sensitiveHeaders: string[] = DEFAULT_SENSITIVE_HEADERS,
): Record<string, string> => {
  if (!headers) return {}

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (matchesSensitiveList(key, sensitiveHeaders)) {
        return [key, REDACTION_PLACEHOLDER]
      }
      return [key, value]
    }),
  )
}

/**
 * Same redaction as `redactHeaders`, for the additive multi-value sibling
 * (`NetworkRequest.responseHeaderValues` / `MockResponse.headerValues`) — a
 * map of header name to its full ordered list of real values. Every value in
 * a sensitive name's array is replaced, not just the first, so a caller that
 * only redacts `headers` (the single folded value) can't leak the rest
 * through this field. `undefined` in, `undefined` out — mirrors how callers
 * already treat "no multi-value headers on this response" as absent, not `{}`.
 */
export const redactHeaderValues = (
  headerValues?: Record<string, string[]>,
  sensitiveHeaders: string[] = DEFAULT_SENSITIVE_HEADERS,
): Record<string, string[]> | undefined => {
  if (!headerValues) return undefined

  return Object.fromEntries(
    Object.entries(headerValues).map(([key, values]) => {
      if (matchesSensitiveList(key, sensitiveHeaders)) {
        return [key, values.map(() => REDACTION_PLACEHOLDER)]
      }
      return [key, values]
    }),
  )
}

/**
 * Strip (completely remove) sensitive headers.
 * Case-insensitive matching.
 *
 * @param headers - Headers object to process
 * @param sensitiveHeaders - Header names to strip (defaults to DEFAULT_SENSITIVE_HEADERS)
 * @returns New headers object with sensitive keys removed
 */
export const stripHeaders = (
  headers?: Record<string, string>,
  sensitiveHeaders: string[] = DEFAULT_SENSITIVE_HEADERS,
): Record<string, string> => {
  if (!headers) return {}

  return Object.fromEntries(Object.entries(headers).filter(([key]) => !matchesSensitiveList(key, sensitiveHeaders)))
}

/**
 * Check if a header name is sensitive.
 *
 * @param headerName - The header name to check
 * @param sensitiveHeaders - List of sensitive header names
 */
export const isSensitiveHeader = (
  headerName: string,
  sensitiveHeaders: string[] = DEFAULT_SENSITIVE_HEADERS,
): boolean => {
  return matchesSensitiveList(headerName, sensitiveHeaders)
}
