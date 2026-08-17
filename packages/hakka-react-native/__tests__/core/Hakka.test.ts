// Mock __DEV__ as true for tests
Object.defineProperty(globalThis, '__DEV__', { value: true, writable: true })

// Mock XMLHttpRequest for node environment
class MockXHR {
  static UNSENT = 0
  static OPENED = 1
  static HEADERS_RECEIVED = 2
  static LOADING = 3
  static DONE = 4
  readyState = 0
  status = 0
  responseType = ''
  responseText = ''
  private _listeners: Map<string, Function[]> = new Map()
  open() {}
  send() {}
  setRequestHeader() {}
  getAllResponseHeaders() {
    return ''
  }
  addEventListener(evt: string, fn: Function) {
    const l = this._listeners.get(evt) ?? []
    l.push(fn)
    this._listeners.set(evt, l)
  }
}
globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest

// Mock WebSocket for node environment
class MockWS {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = 0
  url: string
  constructor(url: string) {
    this.url = url
  }
  addEventListener() {}
  close() {}
}
globalThis.WebSocket = MockWS as unknown as typeof WebSocket

import '../../src/bootstrap'
import { Hakka } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'
import { TurboModuleRegistry } from 'react-native'

// Mock fetch so interceptors can install
const mockFetch = jest.fn().mockResolvedValue({
  status: 200,
  headers: new Headers(),
  // Faithful clone: readCappedBody inspects `headers` before the `.text()` fallback.
  clone: () => ({ headers: new Headers(), text: () => Promise.resolve('') }),
})
globalThis.fetch = mockFetch as unknown as typeof fetch

describe('Hakka singleton', () => {
  afterEach(() => {
    Hakka.stop()
    Hakka.clearLogs()
    Hakka.configure({ enabled: undefined, maxAge: 86400, maxRequests: 100 })
    Hakka.configure({ mode: 'auto' })
    Hakka.sinks([])
    ;(TurboModuleRegistry.get as jest.Mock).mockReset()
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(null)
    jest.useRealTimers()
  })

  it('starts and stops', () => {
    expect(Hakka.isActive).toBe(false)
    Hakka.start()
    expect(Hakka.isActive).toBe(true)
    Hakka.stop()
    expect(Hakka.isActive).toBe(false)
  })

  it('configure updates config', () => {
    Hakka.configure({ maxRequests: 100, redactHeaders: ['x-api-key'] })
    const config = Hakka.getConfig()
    expect(config.maxRequests).toBe(100)
    expect(config.redactHeaders).toContain('x-api-key')
  })

  it('onRequest callback fires on intercepted fetch', async () => {
    const received: NetworkRequest[] = []
    Hakka.onRequest((r) => received.push(r))
    Hakka.start()

    await globalThis.fetch('https://example.com/test')

    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received[0]!.url).toBe('https://example.com/test')
    expect(received[0]!.source).toBe('fetch')
  })

  it('auto mode prefers native interception when native module is available', async () => {
    const nativeModule = makeNativeModule([makeNativeRequest('auto-native')])
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(nativeModule)
    const received: NetworkRequest[] = []
    Hakka.onRequest((r) => received.push(r))

    Hakka.start({ mode: 'auto' })
    await flushAsync()
    await globalThis.fetch('https://example.com/native-only')
    await flushAsync()

    expect(received).toHaveLength(1)
    expect(received[0]!.source).toBe('native')
    expect((received[0] as NetworkRequest).id).toBe('auto-native')
    expect(nativeModule.initialize).toHaveBeenCalledTimes(1)
    expect(nativeModule.getLogs).toHaveBeenCalledTimes(1)
  })

  it('getLogs returns captured requests', async () => {
    Hakka.start()
    await globalThis.fetch('https://example.com/a')
    await globalThis.fetch('https://example.com/b')

    const logs = Hakka.getLogs()
    expect(logs.length).toBe(2)
  })

  it('clearLogs empties storage', async () => {
    Hakka.start()
    await globalThis.fetch('https://example.com/x')
    expect(Hakka.getLogCount()).toBe(1)
    Hakka.clearLogs()
    expect(Hakka.getLogCount()).toBe(0)
  })

  it('ignoreHosts filters out matching requests', async () => {
    Hakka.configure({ ignoreHosts: ['analytics.example.com'] })
    Hakka.start()

    await globalThis.fetch('https://analytics.example.com/track')
    await globalThis.fetch('https://api.example.com/data')

    const logs = Hakka.getLogs()
    expect(logs.length).toBe(1)
    expect(logs[0]!.url).toBe('https://api.example.com/data')
  })

  it('merges JS fetch header and body updates into one stored request', async () => {
    Hakka.start({ mode: 'js' })

    await globalThis.fetch('https://example.com/body')
    await flushAsync()

    const logs = Hakka.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]!.url).toBe('https://example.com/body')
    expect(logs[0]!.responseBody).toBe('')
  })

  it('does not start when enabled is false', () => {
    Hakka.start({ enabled: false })
    expect(Hakka.isActive).toBe(false)
  })

  it('configure merges with current config, not defaults', () => {
    Hakka.configure({ mode: 'native', maxRequests: 200 })
    Hakka.configure({ ignoreHosts: ['sentry.io'] })
    const config = Hakka.getConfig()
    expect(config.mode).toBe('native') // not reset to 'auto'
    expect(config.maxRequests).toBe(200) // not reset to default
    expect(config.ignoreHosts).toContain('sentry.io')
  })

  it('configure enabled:false stops running interceptors', () => {
    Hakka.start()
    expect(Hakka.isActive).toBe(true)
    Hakka.configure({ enabled: false })
    expect(Hakka.isActive).toBe(false)
  })

  it('start accepts inline config', () => {
    Hakka.start({ maxRequests: 300 })
    expect(Hakka.isActive).toBe(true)
    expect(Hakka.getConfig().maxRequests).toBe(300)
  })

  it('dispatches captured requests to JS record sinks', async () => {
    const records: unknown[] = []
    Hakka.start({ mode: 'js', sinks: [(record) => records.push(record)] })

    await globalThis.fetch('https://example.com/sink')

    expect(records.length).toBeGreaterThanOrEqual(1)
    expect(records[0]).toMatchObject({ kind: 'network.request' })
  })

  it('does not ingest native startup logs after stop', async () => {
    const nativeRequest = makeNativeRequest('native-after-stop')
    const nativeModule = makeNativeModule([nativeRequest])
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(nativeModule)

    Hakka.start({ mode: 'native' })
    Hakka.stop()

    await flushAsync()

    expect(Hakka.getLogs()).toHaveLength(0)
  })

  it('applies maxAge retention to JS fallback logs', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(10_000)

    Hakka.start({ mode: 'js', maxAge: 1 })
    await globalThis.fetch('https://example.com/old')

    jest.setSystemTime(12_000)
    await globalThis.fetch('https://example.com/new')

    const logs = Hakka.getLogs()
    expect(logs.some((request) => request.url === 'https://example.com/old')).toBe(false)
    expect(logs.some((request) => request.url === 'https://example.com/new')).toBe(true)

    jest.useRealTimers()
  })

  it('dedups same request from native and JS sources when IDs match and timing window aligns', async () => {
    const now = Date.now()
    const nativeStart = now
    const nativeRequest = {
      ...makeNativeRequest('native-js-dupe', nativeStart),
      source: 'native' as const,
      duration: 5,
    }
    const jsRequest = {
      ...makeNativeRequest('native-js-dupe', nativeStart + 20),
      source: 'fetch' as const,
      duration: 6,
    }

    const nativeModule = makeNativeModule([nativeRequest, jsRequest])
    ;(Hakka as unknown as { native: unknown }).native = nativeModule
    expect((Hakka as unknown as { native: unknown }).native).toBeDefined()
    expect(Hakka.isActive).toBe(false)
    Hakka.start({ mode: 'native' })
    expect(Hakka.isActive).toBe(true)
    await flushAsync()
    expect(nativeModule.initialize).toHaveBeenCalledTimes(1)
    expect(nativeModule.getLogs).toHaveBeenCalledTimes(1)

    const logs = Hakka.getLogs()
    expect(logs).toHaveLength(1)
    expect(Hakka.getLogCount()).toBe(1)
    expect(logs[0]!.source).toBe('native')
    expect(logs[0]!.duration).toBe(5)
  })

  it('enableNativeCapture switches config to native and restarts active capture', () => {
    const nativeModule = makeNativeModule([])
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(nativeModule)

    Hakka.start({ mode: 'js' })
    expect(nativeModule.initialize).not.toHaveBeenCalled()

    Hakka.enableNativeCapture()
    expect(Hakka.getConfig().mode).toBe('native')
    expect(nativeModule.initialize).toHaveBeenCalledTimes(1)
    expect(nativeModule.addListener).toHaveBeenCalledTimes(1)
    expect(Hakka.getLogCount()).toBe(0)
  })

  it('enableJsCapture sets capture mode to js for future starts', () => {
    Hakka.configure({ mode: 'native' })
    Hakka.enableJsCapture(false)
    expect(Hakka.getConfig().mode).toBe('js')
  })
})

function makeNativeRequest(id: string, startTime = Date.now()): NetworkRequest {
  return {
    id,
    url: `https://example.com/${id}`,
    method: 'GET',
    status: 200,
    startTime,
    duration: 12,
    requestHeaders: {},
    responseHeaders: {},
    requestBodySize: 0,
    responseBodySize: 0,
    requestBody: null,
    responseBody: null,
    error: null,
    source: 'native',
  }
}

function makeNativeModule(logs: NetworkRequest[]) {
  return {
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
    getLogs: jest.fn().mockResolvedValue(logs),
    clearLogs: jest.fn(),
    setSensitiveHeaders: jest.fn(),
    setIgnoredHosts: jest.fn(),
    setIgnoredPatterns: jest.fn(),
  }
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}
