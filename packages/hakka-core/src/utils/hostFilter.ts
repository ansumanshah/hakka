/** Host filtering — blocklist mode (capture everything except listed hosts) or allowlist mode (only capture listed hosts). */

import { extractHost } from './domainUtils'
import { globToRegExp, regexLiteralToRegExp } from './patternUtils'

type FilterMode = 'blacklist' | 'whitelist'

export interface HostFilterConfig {
  /** 'blacklist' = block listed hosts; 'whitelist' = only allow listed hosts */
  mode: FilterMode
  /** Exact hostnames or glob patterns (e.g. '*.internal.example.com') */
  hosts: string[]
}

/** Max input length tested against user-supplied patterns — bounds catastrophic backtracking on very long URLs. */
const MAX_PATTERN_INPUT = 4096

/**
 * Module-level cache: pattern string → compiled RegExp (or null for non-regex literals), so
 * each unique pattern compiles at most once. User-supplied patterns with nested quantifiers
 * (e.g. `(a+)+$`) can cause catastrophic backtracking — prefer glob patterns over raw regex
 * literals when configuring ignorePatterns/ignoreHosts.
 */
const compiledPatternCache = new Map<string, RegExp | null>()

const getCachedRegex = (pattern: string): RegExp | null => {
  if (compiledPatternCache.has(pattern)) {
    return compiledPatternCache.get(pattern) ?? null
  }
  const re = regexLiteralToRegExp(pattern)
  compiledPatternCache.set(pattern, re)
  return re
}

/** Compiled glob RegExp, cached like `getCachedRegex` but under a distinct `__glob__` namespace so a glob and a regex-literal cache entry for the same raw string never collide. */
const getCachedGlob = (pattern: string): RegExp => {
  const cacheKey = `__glob__${pattern}`
  const cached = compiledPatternCache.get(cacheKey)
  if (cached) return cached
  const re = globToRegExp(pattern)
  compiledPatternCache.set(cacheKey, re)
  return re
}

/**
 * Check if a host matches any of the given patterns (exact or glob).
 */
export const hostMatchesList = (host: string, patterns: string[]): boolean => {
  const normalizedHost = host.toLowerCase()
  const boundedHost = host.slice(0, MAX_PATTERN_INPUT)
  return patterns.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase()
    const regex = getCachedRegex(pattern)
    if (regex) return regex.test(boundedHost)
    if (normalizedPattern.startsWith('.')) {
      return normalizedHost === normalizedPattern.slice(1) || normalizedHost.endsWith(normalizedPattern)
    }
    if (pattern.includes('*')) {
      return getCachedGlob(pattern).test(boundedHost)
    }
    return normalizedPattern === normalizedHost || normalizedHost.endsWith(`.${normalizedPattern}`)
  })
}

/**
 * Determine whether a request URL should be captured, given a filter config.
 *
 * @param url - The request URL
 * @param config - Filter configuration (mode + hosts list)
 * @returns true if the request should be captured, false if it should be ignored
 */
export const shouldCaptureUrl = (url: string, config: HostFilterConfig): boolean => {
  const host = extractHost(url)

  if (config.mode === 'blacklist') {
    return !hostMatchesList(host, config.hosts)
  }

  if (config.mode === 'whitelist') {
    return hostMatchesList(host, config.hosts)
  }

  return true
}

/**
 * Filter a URL list against regex patterns (existing ignoredPatterns behaviour).
 *
 * @param url - URL to test
 * @param patterns - Array of regex pattern strings
 * @returns true if URL matches any pattern (and should be ignored)
 */
export const matchesIgnoredPattern = (url: string, patterns: string[]): boolean => {
  const boundedUrl = url.slice(0, MAX_PATTERN_INPUT)
  return patterns.some((pattern) => {
    const regex = getCachedRegex(pattern)
    if (regex) return regex.test(boundedUrl)
    // Glob takes precedence over raw-regex interpretation: a glob like `https://*.example.com/debug/*`
    // is also a *valid* (but different-meaning) RegExp.
    if (pattern.includes('*')) return getCachedGlob(pattern).test(boundedUrl)
    // Raw RegExp, cached to avoid per-call construction on the hot ingest path.
    const rawCacheKey = `__raw__${pattern}`
    let rawRe: RegExp | null | undefined = compiledPatternCache.get(rawCacheKey)
    if (rawRe === undefined) {
      try {
        rawRe = new RegExp(pattern, 'i')
      } catch {
        rawRe = null
      }
      compiledPatternCache.set(rawCacheKey, rawRe)
    }
    if (rawRe) return rawRe.test(boundedUrl)
    return boundedUrl.toLowerCase().includes(pattern.toLowerCase())
  })
}
