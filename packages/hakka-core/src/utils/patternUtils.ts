/** Shared pattern-matching helpers used by hostFilter and headerRedaction. */

/** Parse a regex literal string (e.g. '/foo/') into a RegExp, or null if invalid. */
export const regexLiteralToRegExp = (pattern: string): RegExp | null => {
  if (pattern.length <= 2 || !pattern.startsWith('/') || !pattern.endsWith('/')) return null
  try {
    return new RegExp(pattern.slice(1, -1), 'i')
  } catch {
    return null
  }
}

/**
 * Convert a simple glob pattern ('*' wildcard only) to an anchored RegExp.
 * query/compile.ts has a separate, deliberately-different globToRegex (unanchored,
 * supports `?`) for search-DSL substring matching — do NOT merge the two.
 */
export const globToRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}
