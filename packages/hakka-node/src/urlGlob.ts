/**
 * Convert a `*`-wildcard glob to a RegExp matched against a full URL
 * (protocol+host+path+query). Lives here rather than in `hakka-core` —
 * core only exports the HOST-scoped `hostMatchesList`/`shouldCaptureUrl`
 * (its internal `patternUtils.globToRegExp` isn't public surface), and both
 * of this package's consumers (ADR 0002's `captureUrls` allowlist and
 * `ignorePatterns` noise filtering) need to match the whole URL, path
 * included.
 */
export function globToUrlRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}
