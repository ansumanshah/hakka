import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type ObjectJson = Record<string, Json>

interface Header {
  name: string
  value: string
  enabled?: boolean
}
interface RequestSpec {
  id: string
  name: string
  method: string
  url: string
  headers?: Header[]
  query?: Header[]
  body?: ObjectJson
  auth?: ObjectJson
  assertions?: ObjectJson[]
  captures?: ObjectJson[]
  timeout?: number
  followRedirects?: boolean
  scripts?: ObjectJson
}
interface Collection {
  id: string
  name: string
  defaultHeaders?: Header[]
  auth?: ObjectJson
}
interface RunItem {
  name: string
  id: string
  status?: number
  durationMs: number
  outcome: 'passed' | 'failed' | 'error'
  assertions: string[]
  error?: string
}
export interface RunReport {
  collection: string
  startedAt: string
  durationMs: number
  iterations: number
  passed: number
  failed: number
  items: RunItem[]
}

export interface RunOptions {
  environment?: Record<string, string>
  folder?: string
  dataFile?: string
  repeat?: number
  delayMs?: number
  timeoutMs?: number
  jsonReport?: string
  junitReport?: string
  json?: boolean
}

function safeText(value: string): string {
  return value
    .replace(/((?:bearer|basic)\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:token|secret|password|api[-_ ]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
}

function object(value: Json | undefined): ObjectJson {
  return value != null && !Array.isArray(value) && typeof value === 'object' ? value : {}
}
function text(value: Json | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function number(value: Json | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined
}
function enabled(value: ObjectJson): boolean {
  return value.enabled !== false
}

function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/{{\s*([^{}\s]+)\s*}}/g, (whole, key: string) => variables[key] ?? whole)
}

function unresolved(value: string): string[] {
  return [...value.matchAll(/{{\s*([^{}\s]+)\s*}}/g)].map((match) => match[1]!)
}

async function readJson(path: string): Promise<ObjectJson> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (value == null || Array.isArray(value) || typeof value !== 'object')
    throw new Error(`${path} must contain a JSON object`)
  return value as ObjectJson
}

interface LoadedRequest {
  request: RequestSpec
  headers: Header[]
  auth: ObjectJson
  path: string
}
async function loadDirectory(
  path: string,
  inheritedHeaders: Header[] = [],
  inheritedAuth: ObjectJson = {},
): Promise<LoadedRequest[]> {
  const entries = await readdir(path, { withFileTypes: true })
  const candidates: Array<{
    seq: number
    name: string
    run?: LoadedRequest
    folder?: string
    headers?: Header[]
    auth?: ObjectJson
  }> = []
  for (const entry of entries) {
    const absolute = join(path, entry.name)
    if (entry.isDirectory()) {
      try {
        const meta = await readJson(join(absolute, 'folder.hakka'))
        candidates.push({
          seq: number(meta.seq) ?? Number.MAX_SAFE_INTEGER,
          name: entry.name,
          folder: absolute,
          headers: (meta.headers as unknown as Header[] | undefined) ?? [],
          auth: object(meta.auth),
        })
      } catch {
        /* folders without metadata are not collection nodes */
      }
    } else if (extname(entry.name) === '.hakka' && entry.name !== 'collection.hakka' && entry.name !== 'folder.hakka') {
      const disk = await readJson(absolute)
      const spec = object(disk.spec) as unknown as RequestSpec
      if (!text(spec.name) || !text(spec.url) || !text(spec.method))
        throw new Error(`${absolute} has no valid RequestSpec`)
      candidates.push({
        seq: number(disk.seq) ?? Number.MAX_SAFE_INTEGER,
        name: entry.name,
        run: { request: spec, headers: inheritedHeaders, auth: inheritedAuth, path: absolute },
      })
    }
  }
  candidates.sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name))
  const result: LoadedRequest[] = []
  for (const candidate of candidates) {
    if (candidate.run) result.push(candidate.run)
    else if (candidate.folder) {
      const auth =
        candidate.auth == null || Object.keys(candidate.auth).length === 0 || 'inherit' in candidate.auth
          ? inheritedAuth
          : candidate.auth
      result.push(...(await loadDirectory(candidate.folder, [...inheritedHeaders, ...(candidate.headers ?? [])], auth)))
    }
  }
  return result
}

async function loadCollection(
  input: string,
  folder?: string,
): Promise<{ collection: Collection; requests: LoadedRequest[] }> {
  const path = resolve(input)
  if (extname(path) === '.hakka') {
    const disk = await readJson(path)
    const spec = object(disk.spec) as unknown as RequestSpec
    return {
      collection: { id: 'single', name: basename(path) },
      requests: [{ request: spec, headers: [], auth: {}, path }],
    }
  }
  const collection = (await readJson(join(path, 'collection.hakka'))) as unknown as Collection
  if (!folder)
    return { collection, requests: await loadDirectory(path, collection.defaultHeaders ?? [], object(collection.auth)) }
  const pieces = folder.split(/[\\/]/).filter(Boolean)
  if (!pieces.length || pieces.some((piece) => piece === '.' || piece === '..'))
    throw new Error('--folder must be a collection-relative folder path')
  let root = path
  let headers = collection.defaultHeaders ?? []
  let auth = object(collection.auth)
  for (const piece of pieces) {
    root = join(root, piece)
    const metadata = await readJson(join(root, 'folder.hakka'))
    headers = [...headers, ...((metadata.headers as unknown as Header[] | undefined) ?? [])]
    const candidate = object(metadata.auth)
    if (!('inherit' in candidate) && Object.keys(candidate).length) auth = candidate
  }
  return { collection, requests: await loadDirectory(root, headers, auth) }
}

function decodeBody(
  body: ObjectJson | undefined,
  variables: Record<string, string>,
): { body?: string; contentType?: string } {
  if (!body || 'none' in body) return {}
  const raw = object(body.raw)
  if (Object.keys(raw).length)
    return { body: interpolate(text(raw.text) ?? '', variables), contentType: text(raw.contentType) }
  const graphql = object(body.graphql)
  if (Object.keys(graphql).length)
    return {
      body: JSON.stringify({
        query: interpolate(text(graphql.query) ?? '', variables),
        variables: JSON.parse(interpolate(text(graphql.variables) ?? '{}', variables)),
        operationName: text(graphql.operationName),
      }),
      contentType: 'application/json',
    }
  const form = object(body.form)
  const formItems = Array.isArray(form._0) ? form._0 : body.form
  if (Array.isArray(formItems))
    return {
      body: formItems
        .map((item) => object(item))
        .filter(enabled)
        .map(
          (item) =>
            `${encodeURIComponent(interpolate(text(item.name) ?? '', variables))}=${encodeURIComponent(interpolate(text(item.value) ?? '', variables))}`,
        )
        .join('&'),
      contentType: 'application/x-www-form-urlencoded',
    }
  throw new Error(`unsupported body type in portable runner (${Object.keys(body).join(', ')})`)
}

function applyAuth(auth: ObjectJson, headers: Headers, url: URL, variables: Record<string, string>): void {
  if ('inherit' in auth || 'none' in auth || Object.keys(auth).length === 0) return
  const basic = object(auth.basic)
  if (Object.keys(basic).length) {
    headers.set(
      'Authorization',
      `Basic ${Buffer.from(`${interpolate(text(basic.username) ?? '', variables)}:${interpolate(text(basic.password) ?? '', variables)}`).toString('base64')}`,
    )
    return
  }
  const bearer = object(auth.bearer)
  if (Object.keys(bearer).length) {
    headers.set('Authorization', `Bearer ${interpolate(text(bearer.token) ?? '', variables)}`)
    return
  }
  const apiKey = object(auth.apiKey)
  if (Object.keys(apiKey).length) {
    const name = interpolate(text(apiKey.name) ?? '', variables)
    const value = interpolate(text(apiKey.value) ?? '', variables)
    if (text(apiKey.placement) === 'query') url.searchParams.set(name, value)
    else headers.set(name, value)
    return
  }
  throw new Error(`unsupported auth type in portable runner (${Object.keys(auth).join(', ')})`)
}

function pathValue(value: Json, path: string): Json | undefined {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let current: Json | undefined = value
  for (const part of parts) {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) return undefined
      current = current[Number(part)]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = current[part]
  }
  return current
}
function sourceValue(
  source: ObjectJson,
  status: number,
  durationMs: number,
  headers: Headers,
  body: string,
): string | undefined {
  if ('status' in source) return String(status)
  if ('durationMs' in source) return String(durationMs)
  if ('bodyText' in source) return body
  const header = object(source.header)
  if (Object.keys(header).length) return headers.get(text(header.name) ?? '') ?? undefined
  const jsonPath = text(source.jsonPath) ?? text(object(source.jsonPath)._0)
  if (jsonPath != null) {
    try {
      const value = pathValue(JSON.parse(body) as Json, jsonPath)
      return value == null ? undefined : typeof value === 'string' ? value : JSON.stringify(value)
    } catch {
      return undefined
    }
  }
  return undefined
}
function assertionResult(
  assertion: ObjectJson,
  status: number,
  durationMs: number,
  headers: Headers,
  body: string,
  variables: Record<string, string>,
): string | undefined {
  if (!enabled(assertion)) return undefined
  const actual = sourceValue(object(assertion.target), status, durationMs, headers, body)
  const expected = interpolate(text(assertion.expected) ?? '', variables)
  const op = text(assertion.op) ?? 'equals'
  const pass =
    op === 'exists'
      ? actual != null
      : op === 'notExists'
        ? actual == null
        : op === 'equals'
          ? actual === expected
          : op === 'notEquals'
            ? actual !== expected
            : op === 'contains'
              ? actual?.includes(expected)
              : op === 'notContains'
                ? !actual?.includes(expected)
                : op === 'lessThan'
                  ? Number(actual) < Number(expected)
                  : op === 'greaterThan'
                    ? Number(actual) > Number(expected)
                    : op === 'matches'
                      ? new RegExp(expected).test(actual ?? '')
                      : false
  return pass ? undefined : `assertion ${op} failed`
}

const maxResponseBytes = 5 * 1024 * 1024
async function readResponseBody(response: Response, controller: AbortController): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maxResponseBytes) {
        controller.abort()
        throw new Error('response body exceeds 5 MiB limit')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

async function execute(
  item: LoadedRequest,
  variables: Record<string, string>,
  defaultTimeout: number,
): Promise<RunItem> {
  const request = item.request
  if (
    request.scripts &&
    ((Array.isArray(request.scripts.preRequestLines) && request.scripts.preRequestLines.length) ||
      (Array.isArray(request.scripts.postResponseLines) && request.scripts.postResponseLines.length))
  )
    return {
      name: request.name,
      id: request.id,
      durationMs: 0,
      outcome: 'error',
      assertions: [],
      error: 'JavaScript hooks require the desktop runner and are unsupported by hakka run.',
    }
  const urlText = interpolate(request.url, variables)
  const missing = [
    ...new Set(unresolved(JSON.stringify({ url: request.url, headers: item.headers, request, auth: item.auth }))),
  ].filter((key) => variables[key] == null)
  if (missing.length)
    return {
      name: request.name,
      id: request.id,
      durationMs: 0,
      outcome: 'error',
      assertions: [],
      error: `missing variables: ${missing.join(', ')}`,
    }
  try {
    const url = new URL(urlText)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`unsupported protocol ${url.protocol}`)
    const headers = new Headers()
    for (const pair of [...item.headers, ...(request.headers ?? [])])
      if (pair.enabled !== false) headers.set(interpolate(pair.name, variables), interpolate(pair.value, variables))
    for (const pair of request.query ?? [])
      if (pair.enabled !== false)
        url.searchParams.set(interpolate(pair.name, variables), interpolate(pair.value, variables))
    applyAuth(request.auth && !('inherit' in request.auth) ? request.auth : item.auth, headers, url, variables)
    const encoded = decodeBody(request.body, variables)
    if (encoded.contentType && !headers.has('content-type')) headers.set('content-type', encoded.contentType)
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.round((request.timeout ?? defaultTimeout / 1000) * 1000)),
    )
    const started = performance.now()
    let response: Response
    try {
      response = await fetch(url, {
        method: request.method,
        headers,
        body: encoded.body,
        redirect: request.followRedirects === false ? 'manual' : 'follow',
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      throw error
    }
    const responseBody = await readResponseBody(response, controller)
    clearTimeout(timeout)
    const durationMs = Math.round(performance.now() - started)
    const failures = (request.assertions ?? [])
      .map((assertion) =>
        assertionResult(assertion, response.status, durationMs, response.headers, responseBody, variables),
      )
      .filter((value): value is string => value != null)
    for (const capture of request.captures ?? [])
      if (enabled(capture)) {
        const value = sourceValue(object(capture.source), response.status, durationMs, response.headers, responseBody)
        const key = text(capture.variable)
        if (key && value != null) variables[key] = value
      }
    return {
      name: request.name,
      id: request.id,
      status: response.status,
      durationMs,
      outcome: failures.length ? 'failed' : 'passed',
      assertions: failures,
    }
  } catch (error) {
    return {
      name: request.name,
      id: request.id,
      durationMs: 0,
      outcome: 'error',
      assertions: [],
      error: error instanceof Error && error.name === 'AbortError' ? 'request timed out' : 'request failed',
    }
  }
}

function parseCsv(data: string): Record<string, string>[] {
  const rows: string[][] = [[]]
  let cell = ''
  let quoted = false
  for (let index = 0; index < data.length; index++) {
    const char = data[index]!
    if (char === '"') {
      if (quoted && data[index + 1] === '"') {
        cell += '"'
        index++
      } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      rows.at(-1)!.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && data[index + 1] === '\n') index++
      rows.at(-1)!.push(cell)
      rows.push([])
      cell = ''
    } else cell += char
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field')
  if (cell.length || rows.at(-1)!.length) rows.at(-1)!.push(cell)
  else rows.pop()
  const [headers, ...values] = rows
  if (!headers?.length || headers.some((header) => !header)) throw new Error('CSV requires a non-empty header row')
  return values
    .filter((row) => row.some((value) => value.length))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
}
async function datasets(path?: string): Promise<Record<string, string>[]> {
  if (!path) return [{}]
  const data = await readFile(path, 'utf8')
  if (extname(path).toLowerCase() === '.csv') return parseCsv(data)
  const parsed: unknown = JSON.parse(data)
  if (!Array.isArray(parsed) || !parsed.every((row) => row != null && typeof row === 'object' && !Array.isArray(row)))
    throw new Error('--data must be a JSON array of objects or CSV')
  return parsed.map((row) =>
    Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, String(value)])),
  )
}

function junit(report: RunReport): string {
  const failures = report.items.filter((item) => item.outcome !== 'passed')
  const cases = report.items
    .map(
      (item) =>
        `<testcase name="${escapeXml(item.name)}" time="${(item.durationMs / 1000).toFixed(3)}">${item.outcome === 'passed' ? '' : `<failure message="${escapeXml(item.error ?? item.assertions.join('; '))}"/>`}</testcase>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Hakka collection" tests="${report.items.length}" failures="${failures.length}" time="${(report.durationMs / 1000).toFixed(3)}">${cases}</testsuite>\n`
}
function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  )
}

/** Execute an authored Hakka collection with no secret values in stdout or reports. */
export async function runCollection(input: string, options: RunOptions = {}): Promise<RunReport> {
  const { collection, requests } = await loadCollection(input, options.folder)
  if (!requests.length) throw new Error('collection contains no runnable requests')
  const rows = await datasets(options.dataFile)
  if (!rows.length) throw new Error('dataset contains no rows')
  const repeats = positiveInteger(options.repeat ?? 1, '--repeat', 10_000)
  const delayMs = nonNegativeInteger(options.delayMs ?? 0, '--delay-ms', 3_600_000)
  const timeoutMs = positiveInteger(options.timeoutMs ?? 30_000, '--timeout-ms', 3_600_000)
  const started = Date.now()
  const items: RunItem[] = []
  for (let repeat = 0; repeat < repeats; repeat++)
    for (const row of rows) {
      const variables = { ...options.environment, ...row }
      for (const request of requests) items.push(await execute(request, variables, timeoutMs))
      if (delayMs && (repeat < repeats - 1 || row !== rows.at(-1)))
        await new Promise((done) => setTimeout(done, delayMs))
    }
  const report: RunReport = {
    collection: collection.name,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    iterations: repeats * rows.length,
    passed: items.filter((item) => item.outcome === 'passed').length,
    failed: items.filter((item) => item.outcome !== 'passed').length,
    items,
  }
  if (options.jsonReport) {
    await mkdir(dirname(resolve(options.jsonReport)), { recursive: true })
    await writeFile(options.jsonReport, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (options.junitReport) {
    await mkdir(dirname(resolve(options.junitReport)), { recursive: true })
    await writeFile(options.junitReport, junit(report))
  }
  return report
}

function positiveInteger(value: number, flag: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${flag} must be an integer from 1 to ${maximum}`)
  return value
}
function nonNegativeInteger(value: number, flag: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new Error(`${flag} must be an integer from 0 to ${maximum}`)
  return value
}

/** CLI adapter. The parent CLI owns command routing; this owns the run grammar. */
export async function runCommand(args: string[]): Promise<number> {
  let input: string | undefined
  const options: RunOptions = { environment: {} }
  try {
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!
      const next = (): string => {
        const value = args[++index]
        if (!value) throw new Error(`${arg} requires a value`)
        return value
      }
      if (!arg.startsWith('--') && !input) input = arg
      else if (arg === '--env') {
        const pair = next()
        const equals = pair.indexOf('=')
        if (equals < 1) throw new Error('--env requires NAME=value')
        options.environment![pair.slice(0, equals)] = pair.slice(equals + 1)
      } else if (arg === '--folder') options.folder = next()
      else if (arg === '--data') options.dataFile = next()
      else if (arg === '--repeat') options.repeat = Number(next())
      else if (arg === '--delay-ms') options.delayMs = Number(next())
      else if (arg === '--timeout-ms') options.timeoutMs = Number(next())
      else if (arg === '--json') options.json = true
      else if (arg === '--json-report') options.jsonReport = next()
      else if (arg === '--junit-report') options.junitReport = next()
      else throw new Error(`unknown run option: ${arg}`)
    }
  } catch (error) {
    return commandError(args.includes('--json'), error)
  }
  if (!input)
    return commandError(
      options.json,
      new Error(
        'Usage: hakka run <collection-directory|request.hakka> [--env NAME=value] [--folder path] [--data rows.json|rows.csv] [--repeat N] [--delay-ms N] [--timeout-ms N] [--json-report path] [--junit-report path]',
      ),
    )
  let report: RunReport
  try {
    report = await runCollection(input, options)
  } catch (error) {
    return commandError(options.json, error)
  }
  process.stdout.write(
    options.json
      ? `${JSON.stringify(report)}\n`
      : `Hakka run: ${report.passed} passed, ${report.failed} failed (${report.items.length} requests)\n`,
  )
  return report.failed ? 1 : 0
}

function commandError(json: boolean | undefined, error: unknown): number {
  const message = safeText(error instanceof Error ? error.message : 'run failed')
  if (json) process.stdout.write(`${JSON.stringify({ outcome: 'error', error: message })}\n`)
  else process.stderr.write(`hakka run: ${message}\n`)
  return 2
}
