import type { NetworkRequest } from '../model/types'
import { extractHost } from '../utils/domainUtils'

// Groups by host, asserts response shape (not values), uses generous 10x duration bounds, and skips
// no-status requests with a comment — deliberate, don't "fix" these; rationale in docs/testing/overview.md#codegen.

export type TestFramework = 'vitest' | 'bun' | 'jest'

export interface GenerateTestFileOptions {
  /** Top-level `describe` suite name. Default: 'Hakka captured session'. */
  suiteName?: string
  /** Which test runner's globals to import. Default: 'vitest'. */
  framework?: TestFramework
}

const DEFAULT_SUITE_NAME = 'Hakka captured session'
const DEFAULT_FRAMEWORK: TestFramework = 'vitest'

/** Per-framework import line for `describe`/`it`/`expect`. */
function runnerImportLine(framework: TestFramework): string {
  switch (framework) {
    case 'bun':
      return "import { describe, it, expect } from 'bun:test'"
    case 'jest':
      // Explicit import keeps the generated file self-contained and typecheckable without
      // relying on ambient global types being present in every consumer's tsconfig.
      return "import { describe, it, expect } from '@jest/globals'"
    case 'vitest':
    default:
      return "import { describe, it, expect } from 'vitest'"
  }
}

/** JSON-escape a string for embedding as a quoted TS string literal. */
function quote(value: string): string {
  return JSON.stringify(value)
}

/** True when `text` parses as a JSON object or array (not a primitive). */
function tryParseJsonShape(text: string | null | undefined): Record<string, unknown> | unknown[] | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as Record<string, unknown> | unknown[]
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Sanitize a request into a short, readable `it()` title. */
function testTitle(req: NetworkRequest): string {
  const method = req.method.toUpperCase()
  let path = req.url
  try {
    const u = new URL(req.url)
    path = u.pathname + u.search
  } catch {
    // relative/opaque URL — use as-is
  }
  const status = req.status != null ? ` → ${req.status}` : ''
  return `${method} ${path}${status}`
}

/** Top-level keys of a JSON shape — for an array, the keys of its first object element (empty if none). */
function topLevelKeys(shape: Record<string, unknown> | unknown[]): string[] {
  if (Array.isArray(shape)) {
    const first = shape.find((el) => el !== null && typeof el === 'object') as Record<string, unknown> | undefined
    return first ? Object.keys(first) : []
  }
  return Object.keys(shape)
}

/** Emit the body of a single `it()` block for one captured request. Indentation is the caller's responsibility (4 spaces). */
function emitTestBody(req: NetworkRequest, varName: string): string[] {
  const lines: string[] = []

  lines.push(`      const ${varName} = expectRequest(requests).toHaveBeenCalledWith({`)
  lines.push(`        method: ${quote(req.method.toUpperCase())},`)
  lines.push(`        url: ${quote(req.url)},`)
  lines.push(`      })`)

  if (req.status != null) {
    lines.push(`      ${varName}.withStatus(${req.status})`)
  }

  const shape = tryParseJsonShape(req.responseBody)
  if (shape) {
    const keys = topLevelKeys(shape)
    if (keys.length > 0) {
      // Shape only — deliberately not asserting values (avoids flaking on legitimate churn).
      lines.push(
        `      const ${varName}Body = JSON.parse(${varName}.get().responseBody ?? '{}') as Record<string, unknown>`,
      )
      lines.push(
        `      // Response-shape assertion: top-level keys only, so this survives value churn (timestamps, counters, ids).`,
      )
      lines.push(`      expect(Object.keys(${varName}Body)).toEqual(expect.arrayContaining(${JSON.stringify(keys)}))`)
    }
  }

  if (typeof req.duration === 'number' && Number.isFinite(req.duration) && req.duration >= 0) {
    const bound = Math.max(Math.ceil(req.duration * 10), 1)
    lines.push(
      `      // Generous duration budget: 10x the captured ${req.duration}ms, to catch real regressions without flaking on normal variance.`,
    )
    lines.push(`      expect(${varName}.get().duration ?? 0).toBeLessThanOrEqual(${bound})`)
  }

  return lines
}

/**
 * Generates a runnable test file from captured requests — method/url/status, response-shape, and
 * duration-bound assertions, grouped by host. See docs/testing/overview.md#codegen for the design rationale.
 */
export function generateTestFile(requests: NetworkRequest[], opts: GenerateTestFileOptions = {}): string {
  const suiteName = opts.suiteName ?? DEFAULT_SUITE_NAME
  const framework = opts.framework ?? DEFAULT_FRAMEWORK

  const byHost = new Map<string, NetworkRequest[]>()
  for (const req of requests) {
    const host = extractHost(req.url)
    const bucket = byHost.get(host)
    if (bucket) bucket.push(req)
    else byHost.set(host, [req])
  }
  const hosts = Array.from(byHost.keys()).sort()

  const lines: string[] = []
  lines.push('/**')
  lines.push(` * ${suiteName}`)
  lines.push(' *')
  lines.push(' * Auto-generated by hakka-core/test codegen from a captured Hakka session.')
  lines.push(' * Response-shape assertions check top-level keys only (not deep values), so')
  lines.push(' * this file survives normal value churn. Duration bounds are a generous 10x')
  lines.push(' * the captured value — see inline comments. Regenerate rather than hand-edit')
  lines.push(' * when the underlying API contract changes.')
  lines.push(' */')
  lines.push(runnerImportLine(framework))
  lines.push("import { expectRequest } from 'hakka-core/test'")
  lines.push("import type { NetworkRequest } from 'hakka-core'")
  lines.push('')
  lines.push("// Wire this to your own capture source — e.g. hakka-core/test's `captureWith`/")
  lines.push('// `captureFromProvider`, or a plain array of NetworkRequest you already have.')
  lines.push('declare const requests: NetworkRequest[]')
  lines.push('')
  lines.push(`describe(${quote(suiteName)}, () => {`)

  if (hosts.length === 0) {
    lines.push('  // No requests were captured in this session — nothing to assert.')
  }

  hosts.forEach((host, hostIdx) => {
    const reqs = byHost.get(host)!
    lines.push(`  describe(${quote(host)}, () => {`)

    reqs.forEach((req, reqIdx) => {
      if (req.status == null) {
        lines.push(
          `    // skipped: ${req.method.toUpperCase()} ${req.url} has no status (pending or capture-truncated) — nothing to assert.`,
        )
        return
      }

      const title = testTitle(req)
      const varName = `req${hostIdx}_${reqIdx}`
      lines.push(`    it(${quote(title)}, () => {`)
      lines.push(...emitTestBody(req, varName))
      lines.push('    })')
    })

    lines.push('  })')
  })

  lines.push('})')
  lines.push('')

  return lines.join('\n')
}
