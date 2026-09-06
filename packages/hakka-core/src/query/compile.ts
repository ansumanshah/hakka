/**
 * Query compiler — converts an AdvancedQuery into a fast predicate function.
 * Regex and glob patterns are compiled once per query, not per request.
 * Pure functions, no side effects, no DOM.
 */

import type { NetworkRequest } from '../model/types'
import { parseStatusDsl } from './parser'
import type { AdvancedQuery, SearchScope, SearchToken } from './types'

/** Convert a glob pattern (star and question mark wildcards only) to a RegExp. */
// NOTE: utils/patternUtils.ts has a separate, deliberately-different
// globToRegExp (anchored ^...$, `*` only) for allow-list matching — do NOT
// merge the two; anchoring is the semantic difference.
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((seg) => seg.split('?').map(escapeRegex).join('.'))
    .join('.*')
  return new RegExp(escaped, 'i')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface CompiledToken {
  scope: SearchScope
  negate: boolean
  test: (text: string) => boolean
}

function compileToken(token: SearchToken): CompiledToken {
  let test: (text: string) => boolean

  if (token.mode === 'regex') {
    let re: RegExp
    try {
      re = new RegExp(token.value, 'i')
    } catch {
      // Invalid regex — never matches
      re = /(?!)/
    }
    test = (text) => re.test(text)
  } else if (token.mode === 'wildcard') {
    const re = globToRegex(token.value)
    test = (text) => re.test(text)
  } else {
    const lower = token.value.toLowerCase()
    test = (text) => text.toLowerCase().includes(lower)
  }

  return { scope: token.scope, negate: token.negate, test }
}

function getHeaderText(req: NetworkRequest): string {
  const parts: string[] = []
  for (const headers of [req.requestHeaders, req.responseHeaders]) {
    if (!headers) continue
    for (const [k, v] of Object.entries(headers)) {
      parts.push(k, v)
    }
  }
  return parts.join('\n')
}

function getBodyText(req: NetworkRequest): string {
  return [req.requestBody ?? '', req.responseBody ?? ''].join('\n')
}

function getAllText(req: NetworkRequest): string {
  return [req.url, getHeaderText(req), getBodyText(req)].join('\n')
}

function getScopedText(req: NetworkRequest, scope: SearchScope): string {
  switch (scope) {
    case 'url':
      return req.url
    case 'header':
      return getHeaderText(req)
    case 'body':
      return getBodyText(req)
    case 'all':
      return getAllText(req)
  }
}

// Mirrors filter.ts's content-type helper.
function responseContentType(req: NetworkRequest): string {
  const headers = req.responseHeaders
  if (headers) {
    for (const key in headers) {
      if (key.toLowerCase() === 'content-type') return (headers[key] ?? '').toLowerCase()
    }
  }
  return (req.contentType ?? '').toLowerCase()
}

/**
 * Compile an AdvancedQuery into a predicate function.
 *
 * Regex/glob patterns are compiled exactly once here. The returned function
 * can be called on many requests without re-compiling.
 *
 * All active filters are ANDed together.
 */
export function compileQuery(q: AdvancedQuery): (req: NetworkRequest) => boolean {
  const compiled: CompiledToken[] = (q.tokens ?? []).map(compileToken)
  const statusRange = q.statusDsl ? parseStatusDsl(q.statusDsl) : null
  const method = q.method?.toUpperCase().trim() || null
  const contentType = q.contentType?.toLowerCase().trim() || null
  const runtime = q.runtime?.toLowerCase().trim() || null
  const durationMin = q.durationMin ?? null
  const durationMax = q.durationMax ?? null
  // Size bounds — total = requestBodySize + responseBodySize
  const sizeMin = q.sizeMin ?? null
  const sizeMax = q.sizeMax ?? null

  return function matchRequest(req: NetworkRequest): boolean {
    for (const token of compiled) {
      const text = getScopedText(req, token.scope)
      const matched = token.test(text)
      if (token.negate ? matched : !matched) return false
    }

    if (statusRange !== null) {
      const [lo, hi] = statusRange
      const status = req.status ?? null
      if (status === null) return false
      if (status < lo || status > hi) return false
    }

    if (method !== null) {
      if (req.method.toUpperCase() !== method) return false
    }

    if (contentType !== null) {
      if (!responseContentType(req).includes(contentType)) return false
    }

    if (runtime !== null) {
      const reqRuntime = req.runtime ?? 'client'
      if (reqRuntime !== runtime) return false
    }

    // Duration bounds — missing/null duration is treated as 0.
    // A request with no duration yet (in-flight) passes a durationMax filter but
    // is excluded by any durationMin > 0 (it can't be known to qualify yet).
    if (durationMin !== null || durationMax !== null) {
      const dur = req.duration ?? 0
      if (durationMin !== null && dur < durationMin) return false
      if (durationMax !== null && dur > durationMax) return false
    }

    // Size bounds — missing sizes default to 0.
    if (sizeMin !== null || sizeMax !== null) {
      const totalSize = (req.requestBodySize ?? 0) + (req.responseBodySize ?? 0)
      if (sizeMin !== null && totalSize < sizeMin) return false
      if (sizeMax !== null && totalSize > sizeMax) return false
    }

    return true
  }
}
