/**
 * MSW (Mock Service Worker v2) interop — capture ↔ `http.<method>`/`HttpResponse` handlers,
 * both directions. `parseMswHandlers` is static analysis only — a small bracket-balancing
 * scanner, no TS compiler — and reports anything outside the supported literal subset in
 * `unsupported` rather than dropping it silently.
 *
 * Handler predicates are always `origin + pathname`, query dropped: MSW matches only
 * origin+pathname, and a literal `?` in the pattern is a `path-to-regexp` "optional token"
 * modifier, not a query separator, so embedding the query would risk a compile error.
 *
 * Every emitted handler is exactly one statement/line
 * (`http.<method>('<origin+pathname>', () => HttpResponse.<json|text>(...))`) so it round-trips
 * through `parseMswHandlers` unchanged, and anything hand-written in that same shape parses too.
 * Full behavior: docs/src/content/docs/guides/msw.md.
 */
import type { Exporter } from '../contract/exporter'
import type { MockRule } from '../engine/MockEngine'
import type { NetworkRequest } from '../model/types'
import { estimateBodySize } from '../utils/bodySizeLimit'

const HTTP_METHODS = ['all', 'head', 'get', 'post', 'put', 'delete', 'patch', 'options'] as const
type HttpMethodName = (typeof HTTP_METHODS)[number]

/** Escape a string for embedding inside a JS single-quoted string literal (mirrors codegen/escaping.ts). */
function jsSingleQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

/** True when the trimmed text looks like a JSON object/array (same heuristic as codegen/escaping.ts). */
function looksLikeJson(body: string): boolean {
  const t = body.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
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

/** Pathname only — MSW matches origin+pathname; the query string is dropped (see file header). */
function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    // Not a parseable absolute URL — treat the whole string as the path, stripping any query.
    const qIdx = url.indexOf('?')
    return qIdx === -1 ? url : url.slice(0, qIdx)
  }
}

/** Response headers never carried over verbatim into a synthetic handler response. */
const DROP_RESPONSE_HEADERS = new Set(['content-length', 'content-encoding', 'transfer-encoding'])

function carriedResponseHeaders(req: NetworkRequest): Record<string, string> | undefined {
  if (!req.responseHeaders) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.responseHeaders)) {
    if (DROP_RESPONSE_HEADERS.has(k.toLowerCase())) continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** A request has nothing worth turning into a handler when it has neither a status nor a body. */
function isUsable(req: NetworkRequest): boolean {
  return req.status != null || (req.responseBody != null && req.responseBody !== '')
}

export interface BuildMswHandlersOptions {
  /** Name of the exported handlers array. Default: `'handlers'`. */
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

/** Build the one-or-two-line source for a single handler (a leading truncation comment, then the statement). */
function buildHandlerLines(req: NetworkRequest, maxBodyBytes: number): string[] {
  const method = req.method.toLowerCase()
  const url = `${originOf(req.url)}${pathnameOf(req.url)}`
  const status = req.status ?? 200
  const headers = carriedResponseHeaders(req)
  const rawBody = req.responseBody ?? ''
  const originalBytes = estimateBodySize(rawBody)
  const truncated = originalBytes > maxBodyBytes
  const bodyForEmit = truncated ? rawBody.slice(0, maxBodyBytes) : rawBody

  const initParts: string[] = [`status: ${status}`]
  if (headers) initParts.push(`headers: ${formatHeaderObject(headers)}`)
  const init = `{ ${initParts.join(', ')} }`

  const lines: string[] = []
  if (truncated) {
    lines.push(`  // truncated: original body ${originalBytes} bytes, showing first ${maxBodyBytes}`)
  }

  const trimmedBody = bodyForEmit.trim()
  let call: string
  if (!truncated && trimmedBody && looksLikeJson(trimmedBody) && isValidJson(trimmedBody)) {
    // Valid JSON is already valid JS object/array literal syntax — embed verbatim, no re-escaping.
    call = `HttpResponse.json(${trimmedBody}, ${init})`
  } else if (bodyForEmit.length > 0) {
    // Truncated bodies always go through .text() — a cut-off JSON literal isn't valid syntax,
    // but a (possibly cut-off) string literal always is.
    call = `HttpResponse.text(${jsSingleQuote(bodyForEmit)}, ${init})`
  } else {
    call = `HttpResponse.json(null, ${init})`
  }

  lines.push(`  http.${method}(${jsSingleQuote(url)}, () => ${call}),`)
  return lines
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * Turn captured requests into a formatted MSW v2 handlers module. Requests with no usable
 * response, or a non-absolute URL, are skipped (counted in a trailing comment for the latter);
 * grouped by origin and deduped by method+pathname (newest wins). Full behavior:
 * docs/src/content/docs/guides/msw.md.
 */
export function buildMswHandlers(requests: NetworkRequest[], opts: BuildMswHandlersOptions = {}): string {
  const exportName = opts.exportName ?? 'handlers'
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

  const lines: string[] = [`import { http, HttpResponse } from 'msw'`, '', `export const ${exportName} = [`]

  for (const origin of [...byOrigin.keys()].sort()) {
    const group = byOrigin.get(origin)
    if (!group) continue
    const reqs = [...group.values()].sort((a, b) => dedupKey(a).localeCompare(dedupKey(b)))
    lines.push(`  // ${origin}`)
    for (const req of reqs) lines.push(...buildHandlerLines(req, maxBodyBytes))
  }

  if (skippedRelativeCount > 0) {
    lines.push(`  // skipped ${skippedRelativeCount} request(s) with relative URLs`)
  }

  lines.push(']')
  return `${lines.join('\n')}\n`
}

/**
 * `Exporter` (ADR 0003) wrapper around `buildMswHandlers()`. `lossy: true` —
 * heavily so: query strings are dropped from every URL, same-method+
 * pathname duplicates collapse to only the newest, request headers/body are
 * never carried over at all, and response bodies above `maxBodyBytes` are
 * truncated. `includesBodies: false` — response body snippets DO appear (up
 * to `maxBodyBytes`) in generated `HttpResponse.json/text(...)` calls, but
 * this contract's `includesBodies` flag is defined and conformance-tested
 * against REQUEST body recoverability specifically (see `exporter.ts`), and
 * `buildMswHandlers` never reads `requestBody` at all — so `false` is the
 * correct, tested declaration here. A caller that must guarantee zero body
 * text of any kind should not rely on this flag alone for this exporter.
 */
export function createMswHandlersExporter(options?: BuildMswHandlersOptions): Exporter {
  return {
    id: 'hakka.msw-handlers',
    label: 'MSW Handlers',
    fileExtension: 'handlers.ts',
    mimeType: 'text/typescript',
    lossy: true,
    includesBodies: false,
    streaming: false,
    export(requests) {
      return buildMswHandlers([...requests], options)
    },
  }
}

export interface UnsupportedMswHandler {
  /** HTTP method as written in source (uppercased), e.g. `'GET'`. */
  method: string
  /** The literal path/URL if it could be recovered, else a short placeholder. */
  path: string
  /** Human-readable reason, always starting with `'unsupported: dynamic resolver'`. */
  reason: string
}

export interface ParseMswHandlersResult {
  /** Successfully parsed handlers, converted to `MockRule`s (ready for `mockEngine.addRule`). */
  rules: MockRule[]
  /** Handlers that fell outside the supported static subset, reported instead of dropped. */
  unsupported: UnsupportedMswHandler[]
}

/**
 * Find the index of the bracket that closes the one opened at `openIdx` (`(`/`{`/`[`), skipping
 * over string/template literal contents. Returns -1 if unmatched. Depth is tracked generically
 * across bracket kinds — safe for syntactically valid source, where the first return-to-zero
 * always corresponds to the bracket opened at `openIdx`.
 */
function findMatchingBracket(src: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipStringLiteral(src, i)
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Return the index of the closing quote matching the quote char at `startIdx`. */
function skipStringLiteral(src: string, startIdx: number): number {
  const quote = src[startIdx]
  let i = startIdx + 1
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2
      continue
    }
    if (src[i] === quote) return i
    i++
  }
  return src.length - 1
}

/** Split `src` on top-level commas (depth 0, outside strings). Used for call args and object props. */
function splitTopLevel(src: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipStringLiteral(src, i)
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(src.slice(start, i))
      start = i + 1
    }
  }
  if (start < src.length) parts.push(src.slice(start))
  return parts.map((s) => s.trim()).filter((s) => s.length > 0)
}

/** Parse a single/double/backtick-quoted string literal with no `${}` expressions. Null if not one. */
function parseStringLiteral(text: string): string | null {
  const t = text.trim()
  if (t.length < 2) return null
  const quote = t[0]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  if (t[t.length - 1] !== quote) return null
  const inner = t.slice(1, -1)
  if (quote === '`' && inner.includes('${')) return null
  let out = ''
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1]
      if (next === 'n') {
        out += '\n'
        i++
        continue
      }
      if (next === 't') {
        out += '\t'
        i++
        continue
      }
      out += next
      i++
      continue
    }
    out += inner[i]
  }
  return out
}

interface ParsedInit {
  status?: number
  headers?: Record<string, string>
}

/** Parse `{ status: 200, headers: { 'k': 'v' } }` (or `''` for "no second argument"). Null if unsupported. */
function parseInitObject(text: string): ParsedInit | null {
  const t = text.trim()
  if (t === '') return {}
  if (t[0] !== '{' || t[t.length - 1] !== '}') return null
  const fields = splitTopLevel(t.slice(1, -1))
  const result: ParsedInit = {}
  for (const field of fields) {
    const idx = field.indexOf(':')
    if (idx === -1) return null
    const key = field
      .slice(0, idx)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    const value = field.slice(idx + 1).trim()
    if (key === 'status') {
      const n = Number(value)
      if (!Number.isFinite(n)) return null
      result.status = n
    } else if (key === 'headers') {
      const headerObj = parseHeaderObject(value)
      if (headerObj === null) return null
      result.headers = headerObj
    } else {
      // Any other field (e.g. a dynamic `type`, spread, computed key) is out of the static subset.
      return null
    }
  }
  return result
}

/**
 * Find the first top-level `:` in a `key: value` field (skipping string contents and nested
 * brackets) — used to split object-literal fields where the key itself can't be `indexOf`'d
 * safely once values start nesting their own colons (e.g. `headers: { 'x-a': '1' }`).
 */
function indexOfTopLevelColon(field: string): number {
  let depth = 0
  for (let i = 0; i < field.length; i++) {
    const ch = field[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipStringLiteral(field, i)
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === ':' && depth === 0) return i
  }
  return -1
}

/**
 * Parse a literal JS value — not strict JSON. Real MSW resolvers are written as JS object
 * literals (`{ firstName: 'John' }` — unquoted keys, single-quoted strings), not JSON text,
 * so `JSON.parse` is too strict here. Handles `null`/`true`/`false`, numbers, quoted strings,
 * arrays, and objects (recursively) — anything else (a variable, function call, template
 * expression, spread) fails, which is exactly the "dynamic" signal callers report on.
 */
function parseLiteralValue(text: string): { ok: true; value: unknown } | { ok: false } {
  const t = text.trim()
  if (t === '') return { ok: false }
  if (t === 'null') return { ok: true, value: null }
  if (t === 'true') return { ok: true, value: true }
  if (t === 'false') return { ok: true, value: false }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return { ok: true, value: Number(t) }

  const str = parseStringLiteral(t)
  if (str !== null) return { ok: true, value: str }

  if (t[0] === '[' && t[t.length - 1] === ']') {
    const values: unknown[] = []
    for (const item of splitTopLevel(t.slice(1, -1))) {
      const parsed = parseLiteralValue(item)
      if (!parsed.ok) return { ok: false }
      values.push(parsed.value)
    }
    return { ok: true, value: values }
  }

  if (t[0] === '{' && t[t.length - 1] === '}') {
    const obj: Record<string, unknown> = {}
    for (const field of splitTopLevel(t.slice(1, -1))) {
      const idx = indexOfTopLevelColon(field)
      if (idx === -1) return { ok: false }
      const rawKey = field.slice(0, idx).trim()
      const key = parseStringLiteral(rawKey) ?? rawKey.replace(/^['"]|['"]$/g, '')
      if (!/^[A-Za-z_$][\w$]*$/.test(key) && parseStringLiteral(rawKey) === null) return { ok: false }
      const parsedValue = parseLiteralValue(field.slice(idx + 1))
      if (!parsedValue.ok) return { ok: false }
      obj[key] = parsedValue.value
    }
    return { ok: true, value: obj }
  }

  return { ok: false }
}

function parseHeaderObject(text: string): Record<string, string> | null {
  const t = text.trim()
  if (t[0] !== '{' || t[t.length - 1] !== '}') return null
  const fields = splitTopLevel(t.slice(1, -1))
  const out: Record<string, string> = {}
  for (const field of fields) {
    const idx = field.indexOf(':')
    if (idx === -1) return null
    const rawKey = field.slice(0, idx).trim()
    const rawVal = field.slice(idx + 1).trim()
    const key = parseStringLiteral(rawKey) ?? rawKey.replace(/^['"]|['"]$/g, '')
    const val = parseStringLiteral(rawVal)
    if (val === null) return null
    out[key] = val
  }
  return out
}

/** Result of pulling the body out of the resolver: either a recognized HttpResponse call, or nothing. */
interface HttpResponseCall {
  kind: 'json' | 'text'
  bodyArg: string
  initArg: string
}

/** Parse `HttpResponse.(json|text)(<args>)` — must consume the whole input, nothing trailing. */
function parseHttpResponseCall(call: string): HttpResponseCall | null {
  const m = /^HttpResponse\.(json|text)\s*\(/.exec(call)
  if (!m) return null
  const openIdx = m[0].length - 1
  const closeIdx = findMatchingBracket(call, openIdx)
  if (closeIdx === -1 || call.slice(closeIdx + 1).trim() !== '') return null
  const args = splitTopLevel(call.slice(openIdx + 1, closeIdx))
  return {
    kind: m[1] as 'json' | 'text',
    bodyArg: args[0] ?? 'null',
    initArg: args[1] ?? '',
  }
}

type ResolverParse = { call: string } | { unsupported: string }

/** Parse the resolver argument: must be a param-less arrow, concise or single-`return`-statement block. */
function parseResolverArg(argText: string): ResolverParse {
  const arrowIdx = argText.indexOf('=>')
  if (arrowIdx === -1) return { unsupported: 'unsupported: dynamic resolver (not an arrow function)' }

  const paramsText = argText.slice(0, arrowIdx).trim()
  if (paramsText !== '()') {
    return { unsupported: 'unsupported: dynamic resolver (resolver reads request/params/cookies)' }
  }

  let body = argText.slice(arrowIdx + 2).trim()
  if (body.startsWith('{')) {
    const closeIdx = findMatchingBracket(body, 0)
    if (closeIdx === -1) return { unsupported: 'unsupported: dynamic resolver (malformed block body)' }
    if (body.slice(closeIdx + 1).trim() !== '') {
      return { unsupported: 'unsupported: dynamic resolver (multiple statements)' }
    }
    const inner = body.slice(1, closeIdx).trim()
    const m = /^return\s+([\s\S]+?);?$/.exec(inner)
    if (!m) return { unsupported: 'unsupported: dynamic resolver (block body is not a single return)' }
    body = m[1].trim()
  }

  return { call: body }
}

let ruleIdCounter = 0

/** Build a `MockRule` from one parsed handler, or null when the body/init falls outside the static subset. */
function buildRule(method: HttpMethodName, urlLiteral: string, httpCall: HttpResponseCall): MockRule | null {
  const init = parseInitObject(httpCall.initArg)
  if (init === null) return null
  const status = init.status ?? 200

  let body: string | object
  if (httpCall.kind === 'json') {
    const trimmed = httpCall.bodyArg.trim()
    if (trimmed === '' || trimmed === 'undefined') {
      body = ''
    } else {
      // See parseLiteralValue — anything outside the literal subset fails here.
      const parsed = parseLiteralValue(trimmed)
      if (!parsed.ok) return null
      body =
        parsed.value !== null && typeof parsed.value === 'object'
          ? (parsed.value as object)
          : JSON.stringify(parsed.value)
    }
  } else {
    const str = parseStringLiteral(httpCall.bodyArg)
    if (str === null) {
      const trimmed = httpCall.bodyArg.trim()
      if (trimmed !== '' && trimmed !== 'undefined') return null
      body = ''
    } else {
      body = str
    }
  }

  ruleIdCounter++
  return {
    id: `msw-${ruleIdCounter}`,
    pattern: urlLiteral,
    method: method === 'all' ? undefined : method.toUpperCase(),
    mode: 'mock',
    response: { status, headers: init.headers, body },
    enabled: true,
    hitCount: 0,
  }
}

const HTTP_CALL_RE = new RegExp(`\\bhttp\\.(${HTTP_METHODS.join('|')})\\s*\\(`, 'g')

/**
 * Parse MSW v2 `http.<method>(path, resolver)` handlers out of a TS/JS source string. Anything
 * outside the static subset (see file header) is reported in `unsupported`, with the method and
 * path recovered when possible so the report is actionable.
 */
export function parseMswHandlers(source: string): ParseMswHandlersResult {
  const rules: MockRule[] = []
  const unsupported: UnsupportedMswHandler[] = []

  HTTP_CALL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HTTP_CALL_RE.exec(source)) !== null) {
    const method = match[1] as HttpMethodName
    const openIdx = match.index + match[0].length - 1
    const closeIdx = findMatchingBracket(source, openIdx)
    if (closeIdx === -1) continue // unterminated call — nothing sensible to report

    const args = splitTopLevel(source.slice(openIdx + 1, closeIdx))
    const urlArg = args[0] ?? ''
    const resolverArg = args[1] ?? ''
    const urlLiteral = parseStringLiteral(urlArg)

    if (urlLiteral === null) {
      unsupported.push({
        method: method.toUpperCase(),
        path: urlArg.trim() || '(unknown)',
        reason: 'unsupported: dynamic resolver (non-literal path)',
      })
      continue
    }

    const resolverResult = parseResolverArg(resolverArg)
    if ('unsupported' in resolverResult) {
      unsupported.push({ method: method.toUpperCase(), path: urlLiteral, reason: resolverResult.unsupported })
      continue
    }

    const httpCall = parseHttpResponseCall(resolverResult.call)
    if (!httpCall) {
      unsupported.push({
        method: method.toUpperCase(),
        path: urlLiteral,
        reason: 'unsupported: dynamic resolver (not a literal HttpResponse.json/text call)',
      })
      continue
    }

    const rule = buildRule(method, urlLiteral, httpCall)
    if (!rule) {
      unsupported.push({
        method: method.toUpperCase(),
        path: urlLiteral,
        reason: 'unsupported: dynamic resolver (non-literal body or response init)',
      })
      continue
    }

    rules.push(rule)
  }

  return { rules, unsupported }
}
