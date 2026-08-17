/**
 * Query parser — converts raw user input into structured tokens and DSL values.
 * Pure functions, no side effects, no DOM.
 */

import type { SearchMode, SearchScope, SearchToken } from './types'

/**
 * Parse a status DSL string ("2xx", "200..299", ">=400", "404", …) into an
 * inclusive [lo, hi] range. See docs/spec/search-dsl.md for the full grammar.
 * Returns null for unrecognised input.
 */
export function parseStatusDsl(dsl: string): [number, number] | null {
  const s = dsl.trim()
  if (!s) return null

  // "NXX" class notation — 1xx/2xx/3xx/4xx/5xx (case-insensitive)
  const classMatch = s.match(/^([1-5])[xX]{2}$/)
  if (classMatch) {
    const base = parseInt(classMatch[1]!, 10) * 100
    return [base, base + 99]
  }

  // "200..<300" exclusive upper
  const exclRange = s.match(/^(\d{3})\.\.<(\d{3})$/)
  if (exclRange) {
    const lo = parseInt(exclRange[1]!, 10)
    const hi = parseInt(exclRange[2]!, 10) - 1
    if (lo > hi) return null
    return [lo, hi]
  }

  // "200..299" inclusive range
  const inclRange = s.match(/^(\d{3})\.\.(\d{3})$/)
  if (inclRange) {
    const lo = parseInt(inclRange[1]!, 10)
    const hi = parseInt(inclRange[2]!, 10)
    if (lo > hi) return null
    return [lo, hi]
  }

  // ">=400" / ">400"
  const geMatch = s.match(/^(>=?)(\d{3})$/)
  if (geMatch) {
    const inclusive = geMatch[1] === '>='
    const val = parseInt(geMatch[2]!, 10)
    const lo = inclusive ? val : val + 1
    return [lo, 599]
  }

  // "<=404" / "<500"
  const leMatch = s.match(/^(<=?)(\d{3})$/)
  if (leMatch) {
    const inclusive = leMatch[1] === '<='
    const val = parseInt(leMatch[2]!, 10)
    const hi = inclusive ? val : val - 1
    return [100, hi]
  }

  // "404" exact single code
  const exact = s.match(/^(\d{3})$/)
  if (exact) {
    const code = parseInt(exact[1]!, 10)
    return [code, code]
  }

  return null
}

/** Scope prefix aliases → canonical SearchScope */
const SCOPE_PREFIXES: Record<string, SearchScope> = {
  'url:': 'url',
  'header:': 'header',
  'headers:': 'header',
  'body:': 'body',
}

/**
 * Detect the search mode from a raw value string (after prefix/negate stripping).
 * Returns mode and the cleaned value.
 */
function detectMode(raw: string): { mode: SearchMode; value: string } {
  // /regex/ notation
  if (raw.startsWith('/') && raw.endsWith('/') && raw.length > 2) {
    return { mode: 'regex', value: raw.slice(1, -1) }
  }
  // wildcard — contains * or ?
  if (raw.includes('*') || raw.includes('?')) {
    return { mode: 'wildcard', value: raw }
  }
  return { mode: 'substring', value: raw }
}

/**
 * Tokenise a raw search bar string into structured SearchTokens
 * (whitespace-separated, quoted phrases kept whole). See
 * docs/spec/search-dsl.md for the full grammar.
 */
export function parseSearchTokens(raw: string): SearchToken[] {
  const tokens: SearchToken[] = []
  if (!raw.trim()) return tokens

  // Tokenise respecting quoted strings
  const parts = splitRespectingQuotes(raw)

  for (const part of parts) {
    if (!part) continue

    let rest = part
    let negate = false

    // Leading '-' means negate only when there is content after it.
    // A lone '-' token carries no search meaning and is skipped below.
    if (rest.startsWith('-') && rest.length > 1) {
      negate = true
      rest = rest.slice(1)
    }

    // A bare '-' (or empty after stripping) has no search meaning.
    if (rest === '-' || !rest) continue

    // Detect scope prefix
    let scope: SearchScope = 'all'
    for (const prefix of Object.keys(SCOPE_PREFIXES)) {
      if (rest.toLowerCase().startsWith(prefix)) {
        scope = SCOPE_PREFIXES[prefix]!
        rest = rest.slice(prefix.length)
        break
      }
    }

    if (!rest) continue

    const { mode, value } = detectMode(rest)
    if (!value) continue

    tokens.push({ scope, mode, value, negate })
  }

  return tokens
}

/**
 * Split a string on whitespace while keeping quoted substrings together.
 * Quotes are stripped from the result.
 */
function splitRespectingQuotes(input: string): string[] {
  const results: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true
      quoteChar = ch
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        results.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }

  if (current) results.push(current)
  return results
}

export interface RangeFilters {
  durationMin?: number
  durationMax?: number
  sizeMin?: number
  sizeMax?: number
}

const SIZE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 * 1024 }

/**
 * Extract numeric range tokens (`dur>100`, `size<2mb`, …) from a raw search
 * string, returning structured bounds plus the remaining text with those
 * tokens stripped — keeps duration/size filtering in the single search box.
 * `>`/`<` are strict, mapped to ±1 on the inclusive [min,max] the engine
 * uses. See docs/spec/search-dsl.md for the full grammar.
 */
export function parseRangeFilters(raw: string): { ranges: RangeFilters; rest: string } {
  const ranges: RangeFilters = {}
  const re = /\b(dur|duration|size)\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?)(b|kb|mb)?\b/gi
  const rest = raw
    .replace(re, (_m, field: string, op: string, num: string, unit?: string) => {
      const isSize = field.toLowerCase() === 'size'
      const value = isSize
        ? Math.round(parseFloat(num) * (SIZE_UNITS[(unit ?? 'b').toLowerCase()] ?? 1))
        : Math.round(parseFloat(num))
      if (isSize) {
        if (op === '>') ranges.sizeMin = value + 1
        else if (op === '>=') ranges.sizeMin = value
        else if (op === '<') ranges.sizeMax = value - 1
        else ranges.sizeMax = value
      } else {
        if (op === '>') ranges.durationMin = value + 1
        else if (op === '>=') ranges.durationMin = value
        else if (op === '<') ranges.durationMax = value - 1
        else ranges.durationMax = value
      }
      return ' '
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { ranges, rest }
}
