#!/usr/bin/env bun
import { mock } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const count = Math.max(Number.parseInt(process.env.HAKKA_RN_MODE_BENCHMARK_COUNT ?? '100', 10) || 100, 1)
const reportFile =
  process.env.HAKKA_RN_MODE_BENCHMARK_REPORT ?? resolve(rootDir, 'artifacts/benchmarks/rn/modes-runtime.json')
const benchmarkUrl = process.env.HAKKA_RN_MODE_BENCHMARK_URL ?? 'https://example.com/rn-mode'
const nativeEventName = 'onHakkaRequests'

const nativeState = {
  available: false,
  module: null,
  listeners: new Set(),
  emitted: 0,
  initializeCalls: 0,
  getLogsCalls: 0,
  addListenerCalls: 0,
  removeListenersCalls: 0,
}

function resetNativeState(available) {
  nativeState.available = available
  nativeState.listeners = new Set()
  nativeState.emitted = 0
  nativeState.initializeCalls = 0
  nativeState.getLogsCalls = 0
  nativeState.addListenerCalls = 0
  nativeState.removeListenersCalls = 0
  nativeState.module = available ? makeNativeModule() : null
}

function makeNativeModule() {
  return {
    addListener(eventName) {
      if (eventName === nativeEventName) nativeState.addListenerCalls += 1
    },
    removeListeners(countToRemove) {
      nativeState.removeListenersCalls += Number(countToRemove) || 0
    },
    initialize() {
      nativeState.initializeCalls += 1
      return Promise.resolve()
    },
    getLogs() {
      nativeState.getLogsCalls += 1
      return Promise.resolve([])
    },
    getHealthReport() {
      return Promise.resolve({
        summary: 'requests=0 errorRate=0.0000 components=[capture=running, storage=ok]',
        tags: { 'benchmark.mode': 'rn' },
      })
    },
    clearLogs() {},
    setSensitiveHeaders() {},
    setIgnoredHosts() {},
    setIgnoredPatterns() {},
  }
}

class MockNativeEventEmitter {
  addListener(eventName, callback) {
    if (eventName !== nativeEventName) {
      return { remove() {} }
    }
    nativeState.listeners.add(callback)
    return {
      remove() {
        nativeState.listeners.delete(callback)
      },
    }
  }
}

mock.module('react-native', () => ({
  NativeEventEmitter: MockNativeEventEmitter,
  TurboModuleRegistry: {
    get() {
      return nativeState.available ? nativeState.module : null
    },
  },
}))

Object.defineProperty(globalThis, '__DEV__', { value: false, writable: true, configurable: true })

class BenchmarkXHR {
  static UNSENT = 0
  static OPENED = 1
  static HEADERS_RECEIVED = 2
  static LOADING = 3
  static DONE = 4
  readyState = 0
  status = 200
  responseType = ''
  responseText = ''
  open() {}
  send() {}
  setRequestHeader() {}
  getAllResponseHeaders() {
    return ''
  }
  addEventListener() {}
}

class BenchmarkWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = BenchmarkWebSocket.OPEN
  constructor(url) {
    this.url = url
  }
  addEventListener() {}
  send() {}
  close() {
    this.readyState = BenchmarkWebSocket.CLOSED
  }
}

globalThis.XMLHttpRequest = BenchmarkXHR
globalThis.WebSocket = BenchmarkWebSocket

const baseFetch = async (input, init) =>
  new Response('{"ok":true}', {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-benchmark-mode': init?.headers?.['X-Hakka-Mode'] ?? 'unknown',
    },
  })
globalThis.fetch = baseFetch

const { Hakka } = await import(new URL('../packages/hakka-react-native/src/core/Hakka.ts', import.meta.url).href)

const scenarios = [
  { name: 'native', mode: 'native', nativeAvailable: true },
  { name: 'js', mode: 'js', nativeAvailable: false },
  { name: 'auto-native', mode: 'auto', nativeAvailable: true },
  { name: 'auto-fallback', mode: 'auto', nativeAvailable: false },
]

const rows = []
for (const scenario of scenarios) {
  // Run scenarios sequentially so each mode measures an isolated Hakka runtime.
  // eslint-disable-next-line no-await-in-loop
  rows.push(await runScenario(scenario))
}

const report = {
  generatedAt: new Date().toISOString(),
  count,
  url: benchmarkUrl,
  rows,
}

mkdirSync(dirname(reportFile), { recursive: true })
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`)

console.log(`RN mode benchmark result: ${reportFile}`)
for (const row of rows) {
  console.log(
    `${row.name.padEnd(13)} captured=${String(row.capturedRecords).padStart(3)} ` +
      `native=${String(row.nativeRecords).padStart(3)} js=${String(row.jsRecords).padStart(3)} ` +
      `avgMs=${row.averageLoopMs.toFixed(3)} duplicates=${row.duplicateRecords}`,
  )
}

async function runScenario(scenario) {
  Hakka.stop()
  Hakka.clearLogs()
  Hakka.configure({
    enabled: undefined,
    mode: 'auto',
    maxAge: 86400,
    maxRequests: count * 4,
    ignoreHosts: [],
    ignorePatterns: [],
    redactHeaders: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie'],
  })
  Hakka.sinks([])
  globalThis.fetch = baseFetch
  resetNativeState(scenario.nativeAvailable)

  const loopDurations = []
  Hakka.start({ mode: scenario.mode, maxRequests: count * 4 })
  await flushAsync()

  for (let index = 0; index < count; index += 1) {
    const url = `${benchmarkUrl}/${scenario.name}/${index}`
    const startedAt = performance.now()
    // Keep request timing serial so per-iteration capture latency stays comparable.
    // eslint-disable-next-line no-await-in-loop
    await globalThis.fetch(url, { headers: { 'X-Hakka-Mode': scenario.name } })
    if (scenario.nativeAvailable && (scenario.mode === 'native' || scenario.mode === 'auto')) {
      emitNativeRequest(scenario.name, index, url)
    }
    // Flush after each request to capture the bridge cost in the same iteration.
    // eslint-disable-next-line no-await-in-loop
    await flushAsync()
    loopDurations.push(performance.now() - startedAt)
  }

  await flushAsync()
  const logs = Hakka.getLogs()
  const sourceCounts = logs.reduce((acc, request) => {
    const source = request.source ?? 'unknown'
    acc[source] = (acc[source] ?? 0) + 1
    return acc
  }, {})
  const uniqueIds = new Set(logs.map((request) => request.id))
  const expectedNative = scenario.nativeAvailable && (scenario.mode === 'native' || scenario.mode === 'auto')
  const expectedJs = scenario.mode === 'js' || (scenario.mode === 'auto' && !scenario.nativeAvailable)

  const row = {
    name: scenario.name,
    mode: scenario.mode,
    nativeAvailable: scenario.nativeAvailable,
    requestedCount: count,
    capturedRecords: logs.length,
    uniqueRecordIds: uniqueIds.size,
    duplicateRecords: logs.length - uniqueIds.size,
    nativeRecords: sourceCounts.native ?? 0,
    jsRecords: (sourceCounts.fetch ?? 0) + (sourceCounts.xhr ?? 0) + (sourceCounts.websocket ?? 0),
    expectedNative,
    expectedJs,
    averageLoopMs: average(loopDurations),
    p95LoopMs: percentile(loopDurations, 95),
    nativeInitializeCalls: nativeState.initializeCalls,
    nativeGetLogsCalls: nativeState.getLogsCalls,
    nativeAddListenerCalls: nativeState.addListenerCalls,
    nativeRemoveListenersCalls: nativeState.removeListenersCalls,
    nativeEventsEmitted: nativeState.emitted,
  }

  Hakka.stop()
  globalThis.fetch = baseFetch
  return row
}

function emitNativeRequest(modeName, index, url) {
  const request = {
    id: `native-${modeName}-${index}`,
    url,
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    duration: 1,
    requestHeaders: {},
    responseHeaders: { 'content-type': 'application/json' },
    requestBodySize: 0,
    responseBodySize: 11,
    requestBody: null,
    responseBody: '{"ok":true}',
    error: null,
    source: 'native',
  }
  nativeState.emitted += 1
  for (const listener of nativeState.listeners) {
    listener([request])
  }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function average(values) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1))
  return sorted[index]
}
