import { readFileSync, statSync } from 'node:fs'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { resolve } from 'node:path'

import { Intrinsics, QuickJS } from 'quickjs-wasi'

export const PROXY_SCRIPT_MAX_BODY_BYTES = 1024 * 1024
const PROXY_SCRIPT_MAX_SOURCE_BYTES = 256 * 1024
const PROXY_SCRIPT_MEMORY_BYTES = 16 * 1024 * 1024
const PROXY_SCRIPT_TIMEOUT_MS = 50
const MAX_HEADERS = 256
const MAX_HEADER_VALUE_BYTES = 16 * 1024
const MAX_URL_BYTES = 16 * 1024

interface ProxyScriptRequest {
  url: string
  method: string
  headers: Record<string, string>
  /** UTF-8 text, or null when the body is absent, binary, or larger than the configured cap. */
  body: string | null
}

interface ProxyScriptResponse {
  status: number
  headers: Record<string, string>
  /** UTF-8 text, or null when the body is absent, binary, or larger than the configured cap. */
  body: string | null
}

export type ProxyScriptHookInput =
  | { phase: 'request'; request: ProxyScriptRequest }
  | { phase: 'response'; request: ProxyScriptRequest; response: ProxyScriptResponse }

type ProxyScriptErrorCode = 'invalid-input' | 'invalid-output' | 'memory-limit' | 'script-error' | 'timeout'

export type ProxyScriptHookResult =
  | { outcome: 'applied'; request: ProxyScriptRequest; response?: ProxyScriptResponse }
  | { outcome: 'skipped' }
  | { outcome: 'error'; code: ProxyScriptErrorCode; diagnostic: string }

export interface ProxyScriptProgram {
  path: string
  source: string
}

let quickJSWasmBytes: Buffer | undefined

function quickJSWasm(): Buffer {
  quickJSWasmBytes ??= readFileSync(new URL('./quickjs.wasm', import.meta.resolve('quickjs-wasi/package.json')))
  return quickJSWasmBytes
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validHeaders(value: unknown): value is Record<string, string> {
  if (!isObject(value) || Object.keys(value).length > MAX_HEADERS) return false
  try {
    for (const [name, header] of Object.entries(value)) {
      if (typeof header !== 'string' || byteLength(header) > MAX_HEADER_VALUE_BYTES) return false
      validateHeaderName(name)
      validateHeaderValue(name, header)
    }
    return true
  } catch {
    return false
  }
}

function validBody(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && byteLength(value) <= PROXY_SCRIPT_MAX_BODY_BYTES)
}

function parseRequest(value: unknown): ProxyScriptRequest | null {
  if (!isObject(value) || typeof value.url !== 'string' || typeof value.method !== 'string') return null
  if (byteLength(value.url) > MAX_URL_BYTES || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value.method)) return null
  try {
    const protocol = new URL(value.url).protocol
    if (protocol !== 'http:' && protocol !== 'https:') return null
  } catch {
    return null
  }
  if (!validHeaders(value.headers) || !validBody(value.body)) return null
  return { url: value.url, method: value.method, headers: value.headers, body: value.body }
}

function parseResponse(value: unknown): ProxyScriptResponse | null {
  if (
    !isObject(value) ||
    !Number.isInteger(value.status) ||
    (value.status as number) < 100 ||
    (value.status as number) > 999
  )
    return null
  if (!validHeaders(value.headers) || !validBody(value.body)) return null
  return { status: value.status as number, headers: value.headers, body: value.body }
}

function diagnostic(code: ProxyScriptErrorCode): string {
  switch (code) {
    case 'invalid-input':
      return 'The proxy script received an invalid or oversized flow and left it unchanged.'
    case 'invalid-output':
      return 'The proxy script returned an invalid or oversized mutation and left the flow unchanged.'
    case 'memory-limit':
      return 'The proxy script exceeded its 16 MiB memory limit and left the flow unchanged.'
    case 'timeout':
      return 'The proxy script exceeded its 50 ms execution limit and left the flow unchanged.'
    case 'script-error':
      return 'The proxy script threw an exception and left the flow unchanged.'
  }
}

function errorResult(code: ProxyScriptErrorCode): ProxyScriptHookResult {
  return { outcome: 'error', code, diagnostic: diagnostic(code) }
}

function classifyEvaluationError(dumped: unknown, interrupted: boolean): ProxyScriptErrorCode {
  if (interrupted) return 'timeout'
  const text = typeof dumped === 'string' ? dumped : JSON.stringify(dumped)
  return /out of memory|allocation failed/i.test(text) ? 'memory-limit' : 'script-error'
}

export function loadProxyScriptFile(path: string): ProxyScriptProgram {
  const absolutePath = resolve(path)
  const stat = statSync(absolutePath)
  if (!stat.isFile()) throw new Error('Proxy script must be a regular file.')
  if (stat.size > PROXY_SCRIPT_MAX_SOURCE_BYTES) throw new Error('Proxy script must be 256 KiB or smaller.')
  return { path: absolutePath, source: readFileSync(absolutePath, 'utf8') }
}

/** Validates syntax and hook presence without exposing filesystem, network, timers, or Node APIs. */
export async function validateProxyScript(program: ProxyScriptProgram): Promise<void> {
  const result = await evaluate(program.source, undefined)
  if (result.outcome === 'error') throw new Error(result.diagnostic)
  if (result.outcome === 'skipped')
    throw new Error('Define onRequest(request), onResponse(response, request), or both.')
}

/** Runs one hook in a fresh bounded QuickJS/WASM runtime. Failures leave the original flow unchanged. */
export async function runProxyScriptHook(
  program: ProxyScriptProgram,
  input: ProxyScriptHookInput,
): Promise<ProxyScriptHookResult> {
  const request = parseRequest(input.request)
  const response = input.phase === 'response' ? parseResponse(input.response) : undefined
  if (!request || (input.phase === 'response' && !response)) return errorResult('invalid-input')
  return input.phase === 'request'
    ? evaluate(program.source, { phase: 'request', request })
    : evaluate(program.source, { phase: 'response', request, response: response! })
}

async function evaluate(source: string, input: ProxyScriptHookInput | undefined): Promise<ProxyScriptHookResult> {
  const wasm = quickJSWasm()
  let deadline = Number.POSITIVE_INFINITY
  let interrupted = false
  const vm = await QuickJS.create({
    wasm,
    memoryLimit: PROXY_SCRIPT_MEMORY_BYTES,
    interruptHandler: () => {
      interrupted = Date.now() >= deadline
      return interrupted
    },
    intrinsics: Intrinsics.ALL & ~Intrinsics.PROMISE & ~Intrinsics.WEAK_REF,
    timezoneOffset: 0,
  })
  try {
    const invocation = input
      ? `
const __hakkaInput = ${JSON.stringify(input)};
const __hakkaHook = __hakkaInput.phase === "request" ? globalThis.onRequest : globalThis.onResponse;
if (typeof __hakkaHook !== "function") {
  JSON.stringify({ outcome: "skipped" });
} else {
  const __hakkaValue = __hakkaInput.phase === "request"
    ? __hakkaHook(__hakkaInput.request)
    : __hakkaHook(__hakkaInput.response, __hakkaInput.request);
  const __hakkaTarget = __hakkaValue === undefined
    ? (__hakkaInput.phase === "request" ? __hakkaInput.request : __hakkaInput.response)
    : __hakkaValue;
  JSON.stringify({ outcome: "applied", request: __hakkaInput.request,
    response: __hakkaInput.phase === "response" ? __hakkaTarget : undefined,
    requestResult: __hakkaInput.phase === "request" ? __hakkaTarget : undefined });
}`
      : `JSON.stringify({ outcome: (typeof globalThis.onRequest === "function" || typeof globalThis.onResponse === "function") ? "valid" : "skipped" });`
    deadline = Date.now() + PROXY_SCRIPT_TIMEOUT_MS
    const evaluated = vm.evalCode(`"use strict";\n${source}\n;${invocation}`, 'proxy-script.js')
    const serialized = evaluated.toString()
    evaluated.dispose()
    if (byteLength(serialized) > 3 * PROXY_SCRIPT_MAX_BODY_BYTES) return errorResult('invalid-output')
    const value: unknown = JSON.parse(serialized)
    if (!isObject(value)) return errorResult('invalid-output')
    if (!input)
      return value.outcome === 'valid' ? { outcome: 'applied', request: null as never } : { outcome: 'skipped' }
    if (value.outcome === 'skipped') return { outcome: 'skipped' }
    const editedRequest = parseRequest(input.phase === 'request' ? value.requestResult : value.request)
    const editedResponse = input.phase === 'response' ? parseResponse(value.response) : undefined
    if (!editedRequest || (input.phase === 'response' && !editedResponse)) return errorResult('invalid-output')
    return { outcome: 'applied', request: editedRequest, ...(editedResponse ? { response: editedResponse } : {}) }
  } catch (error: unknown) {
    const text = error instanceof Error ? error.message : String(error)
    return errorResult(classifyEvaluationError(text, interrupted))
  } finally {
    vm.dispose()
  }
}
