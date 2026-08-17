/**
 * Natural language → search DSL, the grammar `parseSearchTokens` /
 * `parseRangeFilters` / `compileQuery` consume. See /spec/search-dsl for the
 * output grammar and matching strategy. Pure, no side effects, no DOM/runtime deps.
 */

interface Rule {
  /** Matches anywhere in the (lowercased) input; consumes the matched span. */
  pattern: RegExp
  /** Produce the DSL fragment(s) to emit for this match. */
  toDsl: (match: RegExpMatchArray) => string | null
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

// Ordered: more specific patterns first so e.g. "slower than 500ms" wins over a bare "slow".
const RULES: Rule[] = [
  // explicit duration comparisons: "slower than 500ms", "over 2s", "under 300ms"
  {
    pattern: /\b(?:slower than|takes? longer than|over|above|more than)\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?)?\b/i,
    toDsl: (m) => `dur>${toMs(m[1]!, m[2])}`,
  },
  {
    pattern: /\b(?:faster than|under|below|less than)\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?)?\b/i,
    toDsl: (m) => `dur<${toMs(m[1]!, m[2])}`,
  },
  // explicit size comparisons: "bigger than 1mb", "larger than 500kb"
  {
    pattern: /\b(?:bigger than|larger than|over)\s+(\d+(?:\.\d+)?)\s*(b|kb|mb)\b/i,
    toDsl: (m) => `size>${m[1]}${(m[2] ?? '').toLowerCase()}`,
  },
  {
    pattern: /\b(?:smaller than|under)\s+(\d+(?:\.\d+)?)\s*(b|kb|mb)\b/i,
    toDsl: (m) => `size<${m[1]}${(m[2] ?? '').toLowerCase()}`,
  },
  // explicit status codes: "401", "403", "500"
  {
    pattern: /\b([1-5]\d{2})\b/,
    toDsl: (m) => `status:${m[1]}`,
  },
  // failures / errors
  {
    pattern: /\b(failed|failing|failures?|errors?|broken)\b/i,
    toDsl: () => 'status:>=400',
  },
  // auth-related
  {
    pattern: /\b(auth|authentication|unauthori[sz]ed|unauthenticated|forbidden|permission denied)\b/i,
    toDsl: () => 'status:401..403',
  },
  // slow (generic, no explicit threshold)
  {
    pattern: /\b(slow|slowest|sluggish|laggy)\b/i,
    toDsl: () => 'dur>500',
  },
  // large / oversized (generic, no explicit threshold)
  {
    pattern: /\b(large|big|huge|oversized)\b/i,
    toDsl: () => 'size>1mb',
  },
  // HTTP methods (optional trailing 's' for a plural, e.g. "POSTs")
  {
    pattern: new RegExp(`\\b(${HTTP_METHODS.join('|')})s?\\b`, 'i'),
    toDsl: (m) => `method:${m[1]!.toUpperCase()}`,
  },
  // bare hostname or path → url: scope
  {
    pattern: /(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?|\/[a-z0-9_\-./]+/i,
    toDsl: (m) => `url:${m[0]}`,
  },
]

function toMs(value: string, unit: string | undefined): number {
  const n = parseFloat(value)
  const isSeconds = unit != null && /^s(ec(onds?)?)?$/i.test(unit)
  return Math.round(isSeconds ? n * 1000 : n)
}

/** Words that carry no search meaning on their own — stripped before the plain-text fallback. */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'requests',
  'request',
  'that',
  'are',
  'is',
  'was',
  'were',
  'to',
  'for',
  'with',
  'find',
  'show',
  'me',
  'all',
  'any',
]) satisfies ReadonlySet<string>

/** Maps a natural-language phrase to Hakka's search DSL string. Empty input returns ''. */
export function nlToQuery(text: string): string {
  if (!text || !text.trim()) return ''

  let remaining = text
  const fragments: string[] = []

  for (const rule of RULES) {
    // Re-run against remaining text each time so consumed spans aren't re-matched
    // by a later, more general rule (e.g. a matched "500" status code shouldn't
    // also fall through to the plain-text tail).
    const match = remaining.match(rule.pattern)
    if (!match) continue
    const dsl = rule.toDsl(match)
    if (dsl) fragments.push(dsl)
    remaining = remaining.slice(0, match.index ?? 0) + ' ' + remaining.slice((match.index ?? 0) + match[0].length)
  }

  // Whatever text is left over: strip punctuation/stopwords, keep the rest as
  // plain substring terms (quoted if it contains a space).
  const leftoverWords = remaining
    .toLowerCase()
    .replace(/[^a-z0-9\s._/-]/gi, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))

  if (leftoverWords.length > 0) {
    fragments.push(leftoverWords.join(' '))
  }

  return fragments.join(' ').trim()
}
