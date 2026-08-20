/**
 * Playwright route-mock codegen — captured traffic → `page.route(...)` registrations. Export
 * direction only; there is no import/parse direction here.
 *
 * `page.route(url, handler)` matches purely on URL with no per-method registration, and the
 * most recently registered route wins when several match — so two requests captured against
 * the same pathname but different methods would naively shadow each other. Every generated
 * handler opens with a method guard (`if (route.request().method() !== '<METHOD>') return
 * route.fallback()`) so routes for the same URL coexist instead of one eating the other.
 *
 * URL matching is origin + pathname only, query dropped — same as `interop/msw.ts` (this file's
 * helpers mirror msw.ts's local copies rather than importing them, keeping `interop/`
 * independent of `codegen/`, which re-exports from both).
 */
import type { Exporter } from '../contract/exporter'
import type { NetworkRequest } from '../model/types'
import { estimateBodySize } from '../utils/bodySizeLimit'

// Helpers below mirror msw.ts's local copies — see file header for why they aren't imported.

/** Escape a string for embedding inside a JS single-quoted string literal (mirrors codegen/escaping.ts). */
function jsSingleQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

/** True when the trimmed text looks like a JSON object/array (same heuristic as codegen/escaping.ts). */
function looksLikeJson(body: string): boolean {
  const t = body.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return '(relative)'
  }
}

/** True when `url` is parseable as an absolute URL (has a real origin). */
function isAbsoluteUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/** Pathname only — matches origin+pathname; the query string is dropped (see file header). */
function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    // Not a parseable absolute URL — treat the whole string as the path, stripping any query.
    const qIdx = url.indexOf('?')
    return qIdx === -1 ? url : url.slice(0, qIdx)
  }
}

/** Response headers never carried over verbatim into a synthetic route response. */
const DROP_RESPONSE_HEADERS = new Set(['content-length', 'content-encoding', 'transfer-encoding'])

/** Forwards `req.responseHeaders` verbatim, whatever the capture pipeline already redacted — no re-redaction here, so a request captured with redaction disabled will still emit a real secret. */
function carriedResponseHeaders(req: NetworkRequest): Record<string, string> | undefined {
  if (!req.responseHeaders) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.responseHeaders)) {
    if (DROP_RESPONSE_HEADERS.has(k.toLowerCase())) continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** A request has nothing worth turning into a route when it has neither a status nor a body. */
function isUsable(req: NetworkRequest): boolean {
  return req.status != null || (req.responseBody != null && req.responseBody !== '')
}

export interface ToPlaywrightRoutesOptions {
  /** Name of the exported route-registration function. Default: `'mockRoutes'`. */
  exportName?: string
  /** Byte threshold above which a response body is truncated with a comment. Default: 10 KB. */
  maxBodyBytes?: number
}

const DEFAULT_MAX_BODY_BYTES = 10 * 1024

/** Dedup key within one origin group: method + pathname (query intentionally excluded — see file header). */
function dedupKey(req: NetworkRequest): string {
  return `${req.method.toUpperCase()} ${pathnameOf(req.url)}`
}

function formatHeaderObject(headers: Record<string, string>): string {
  const entries = Object.entries(headers).map(([k, v]) => `${jsSingleQuote(k)}: ${jsSingleQuote(v)}`)
  return `{ ${entries.join(', ')} }`
}

/** Build the multi-line source for a single `page.route(...)` block. */
function buildRouteLines(req: NetworkRequest, maxBodyBytes: number): string[] {
  const method = req.method.toUpperCase()
  const url = `${originOf(req.url)}${pathnameOf(req.url)}`
  const status = req.status ?? 200
  const headers = carriedResponseHeaders(req)
  const rawBody = req.responseBody ?? ''
  const originalBytes = estimateBodySize(rawBody)
  const truncated = originalBytes > maxBodyBytes
  const bodyForEmit = truncated ? rawBody.slice(0, maxBodyBytes) : rawBody

  const lines: string[] = []
  lines.push(`  await page.route(${jsSingleQuote(url)}, async (route) => {`)
  lines.push(`    if (route.request().method() !== ${jsSingleQuote(method)}) return route.fallback()`)
  lines.push(`    await route.fulfill({`)
  lines.push(`      status: ${status},`)
  if (headers) lines.push(`      headers: ${formatHeaderObject(headers)},`)
  if (truncated) {
    lines.push(`      // truncated: original body ${originalBytes} bytes, showing first ${maxBodyBytes}`)
  }

  const trimmedBody = bodyForEmit.trim()
  if (!truncated && trimmedBody && looksLikeJson(trimmedBody) && isValidJson(trimmedBody)) {
    // Valid JSON is already valid JS object/array literal syntax — embed verbatim, no re-escaping.
    lines.push(`      json: ${trimmedBody},`)
  } else if (bodyForEmit.length > 0) {
    // Truncated bodies always go through the string form — a cut-off JSON literal isn't valid
    // syntax, but a (possibly cut-off) single-quoted string literal always is.
    lines.push(`      body: ${jsSingleQuote(bodyForEmit)},`)
  } else {
    lines.push(`      json: null,`)
  }

  lines.push(`    })`)
  lines.push(`  })`)
  return lines
}

/**
 * Turn captured requests into a formatted Playwright route-mock module. Requests with no usable
 * response, or a non-absolute URL, are skipped (counted in a trailing comment for the latter);
 * grouped by origin and deduped by method+pathname (newest wins). Full behavior:
 * docs/src/content/docs/guides/playwright.md.
 */
export function toPlaywrightRoutes(requests: NetworkRequest[], opts: ToPlaywrightRoutesOptions = {}): string {
  const exportName = opts.exportName ?? 'mockRoutes'
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

  const byOrigin = new Map<string, Map<string, NetworkRequest>>()
  let skippedRelativeCount = 0
  for (const req of requests) {
    if (!isUsable(req)) continue
    if (!isAbsoluteUrl(req.url)) {
      skippedRelativeCount++
      continue
    }
    const origin = originOf(req.url)
    let group = byOrigin.get(origin)
    if (!group) {
      group = new Map()
      byOrigin.set(origin, group)
    }
    const key = dedupKey(req)
    const existing = group.get(key)
    if (!existing || (req.startTime ?? 0) >= (existing.startTime ?? 0)) {
      group.set(key, req)
    }
  }

  const lines: string[] = [
    `import type { Page } from '@playwright/test'`,
    '',
    `export async function ${exportName}(page: Page) {`,
  ]

  for (const origin of [...byOrigin.keys()].sort()) {
    const group = byOrigin.get(origin)
    if (!group) continue
    const reqs = [...group.values()].sort((a, b) => dedupKey(a).localeCompare(dedupKey(b)))
    lines.push(`  // ${origin}`)
    for (const req of reqs) lines.push(...buildRouteLines(req, maxBodyBytes))
  }

  if (skippedRelativeCount > 0) {
    lines.push(`  // skipped ${skippedRelativeCount} request(s) with relative URLs`)
  }

  lines.push('}')
  return `${lines.join('\n')}\n`
}

/**
 * `Exporter` (ADR 0009) wrapper around `toPlaywrightRoutes()`. `lossy: true`
 * — heavily so: query strings are dropped from every URL, same-method+
 * pathname duplicates collapse to only the newest, request headers/body are
 * never carried over at all, and response bodies above `maxBodyBytes` are
 * truncated. `includesBodies: false` — response body snippets DO appear (up
 * to `maxBodyBytes`) in generated `route.fulfill()` calls, but this
 * contract's `includesBodies` flag is defined and conformance-tested against
 * REQUEST body recoverability specifically (see `exporter.ts`), and
 * `toPlaywrightRoutes` never reads `requestBody` at all — so `false` is the
 * correct, tested declaration here. A caller that must guarantee zero body
 * text of any kind should not rely on this flag alone for this exporter.
 */
export function createPlaywrightRoutesExporter(options?: ToPlaywrightRoutesOptions): Exporter {
  return {
    id: 'hakka.playwright-routes',
    label: 'Playwright Route Mocks',
    fileExtension: 'routes.ts',
    mimeType: 'text/typescript',
    lossy: true,
    includesBodies: false,
    streaming: false,
    export(requests) {
      return toPlaywrightRoutes([...requests], options)
    },
  }
}
