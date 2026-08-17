/**
 * Tiny string-escaping helpers shared by the "copy as code" generators
 * (buildFetch, buildAxios, buildHttpie, buildPython).
 */

/** Escape a string for use inside a shell single-quoted argument. */
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** Escape a string for embedding inside a JS single-quoted string literal. */
export function jsSingleQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

/** Escape a string for embedding inside a Python single-quoted string literal. */
export function pySingleQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

/** True when the request body looks like JSON (used to pick a nicer code path). */
export function looksLikeJson(body: string | null | undefined): boolean {
  if (!body) return false
  const trimmed = body.trim()
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
}
