/**
 * Baseline file format — the thing a team commits and reviews in PR diffs.
 *
 * Line-oriented (NDJSON), one endpoint per line, sorted by key. That means:
 *   - adding/removing/changing ONE endpoint touches exactly one line in `git
 *     diff`, not the whole file (a single JSON array/object would reformat
 *     the entire file on every write and make every diff unreadable)
 *   - key ordering inside each line is fixed (not `JSON.stringify`'s
 *     insertion-order default left to chance) so semantically-identical
 *     baselines always serialize byte-identical, and a re-record with no
 *     real change produces a clean `git diff` (empty)
 *   - a leading version line lets the format evolve without breaking old
 *     baselines silently
 */
import type { NormalizedEndpoint } from './normalize'

export const BASELINE_SCHEMA_VERSION = 1

interface BaselineHeaderLine {
  hakkaCiBaseline: number
}

/** Serialize normalized endpoints to the on-disk baseline format. Input order does not matter — output is always sorted by `key`. */
export function serializeBaseline(endpoints: readonly NormalizedEndpoint[]): string {
  const header: BaselineHeaderLine = { hakkaCiBaseline: BASELINE_SCHEMA_VERSION }
  const sorted = [...endpoints].sort((a, b) => a.key.localeCompare(b.key))
  const lines = [
    JSON.stringify(header),
    ...sorted.map((e) =>
      // Fixed key order, not object-spread — see module doc on byte-stable output.
      JSON.stringify({
        key: e.key,
        method: e.method,
        host: e.host,
        path: e.path,
        statuses: e.statuses,
        requestHeaderNames: e.requestHeaderNames,
        requestBodyShapes: e.requestBodyShapes,
      }),
    ),
  ]
  return lines.join('\n') + '\n'
}

export interface ParsedBaseline {
  version: number
  endpoints: NormalizedEndpoint[]
}

/**
 * Parse a baseline file. Tolerant of a trailing newline and blank lines;
 * throws with a line number on anything else malformed so a hand-edited or
 * merge-conflicted baseline fails loudly instead of silently comparing
 * against a partial baseline.
 */
export function parseBaseline(text: string): ParsedBaseline {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) {
    throw new Error('parseBaseline: empty baseline file')
  }

  let header: unknown
  try {
    header = JSON.parse(lines[0]!)
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`parseBaseline: line 1 is not valid JSON — ${reason}`)
  }
  if (
    typeof header !== 'object' ||
    header === null ||
    typeof (header as Record<string, unknown>).hakkaCiBaseline !== 'number'
  ) {
    throw new Error('parseBaseline: line 1 is not a Hakka CI baseline header (missing "hakkaCiBaseline")')
  }
  const version = (header as BaselineHeaderLine).hakkaCiBaseline

  const endpoints: NormalizedEndpoint[] = []
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1
    let parsed: unknown
    try {
      parsed = JSON.parse(lines[i]!)
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e)
      throw new Error(`parseBaseline: line ${lineNo} is not valid JSON — ${reason}`)
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`parseBaseline: line ${lineNo} is not a JSON object`)
    }
    const p = parsed as Record<string, unknown>
    if (
      typeof p.key !== 'string' ||
      typeof p.method !== 'string' ||
      typeof p.host !== 'string' ||
      typeof p.path !== 'string' ||
      !Array.isArray(p.statuses) ||
      !Array.isArray(p.requestHeaderNames) ||
      !Array.isArray(p.requestBodyShapes)
    ) {
      throw new Error(`parseBaseline: line ${lineNo} is missing required fields`)
    }
    endpoints.push({
      key: p.key,
      method: p.method,
      host: p.host,
      path: p.path,
      statuses: p.statuses as string[],
      requestHeaderNames: p.requestHeaderNames as string[],
      requestBodyShapes: p.requestBodyShapes as string[],
    })
  }

  return { version, endpoints }
}
