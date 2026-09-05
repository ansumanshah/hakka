import '../../src/bootstrap'
import { Hakka } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'
import { TurboModuleRegistry } from 'react-native'

describe('React Native capture', () => {
  beforeEach(() => {
    Hakka.stop()
    Hakka.clearLogs()
    Hakka.configure({ enabled: undefined, mode: 'native', maxRequests: 100 })
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(makeNativeModule([]))
  })

  afterEach(() => {
    Hakka.stop()
    Hakka.clearLogs()
    Hakka.sinks([])
    jest.restoreAllMocks()
  })

  it('starts native capture by default and delivers its startup records', async () => {
    const nativeModule = makeNativeModule([makeNativeRequest('native-default')])
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(nativeModule)
    const received: NetworkRequest[] = []
    const unsubscribe = Hakka.onRequest((record) => received.push(record))
    Hakka.start()
    await flushAsync()
    expect(Hakka.getConfig().mode).toBe('native')
    expect(nativeModule.initialize).toHaveBeenCalledTimes(1)
    expect(received).toEqual([expect.objectContaining({ id: 'native-default', source: 'native' })])
    unsubscribe()
  })

  it('fails without a native module instead of installing JS fallback interceptors', () => {
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(null)
    const originalFetch = globalThis.fetch
    expect(() => Hakka.start()).toThrow('TurboModule was not found')
    expect(Hakka.isActive).toBe(false)
    expect(globalThis.fetch).toBe(originalFetch)
  })

  it.each(['auto', 'js', 'store'] as const)('rejects %s without changing the active native session', (mode) => {
    Hakka.start()
    expect(() => Hakka.configure({ mode })).toThrow('supports only "native"')
    expect(() => Hakka.start({ mode })).toThrow('supports only "native"')
    expect(Hakka.getConfig().mode).toBe('native')
    expect(Hakka.isActive).toBe(true)
  })

  it('keeps native as the mode when configuration omits or clears mode', () => {
    Hakka.configure({ maxRequests: 200, mode: undefined })
    expect(Hakka.getConfig()).toMatchObject({ mode: 'native', maxRequests: 200 })
  })

  it('rejects the shared core JS-mode shortcut on the RN runtime', () => {
    expect(() => Hakka.enableJsCapture()).toThrow('supports only "native"')
    expect(Hakka.isActive).toBe(false)
  })

  it('stops native capture when disabled', () => {
    Hakka.start()
    expect(Hakka.isActive).toBe(true)
    Hakka.configure({ enabled: false })
    expect(Hakka.isActive).toBe(false)
  })

  it('does not start when disabled', () => {
    Hakka.start({ enabled: false })
    expect(Hakka.isActive).toBe(false)
  })

  it('dispatches native records to configured sinks', async () => {
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(makeNativeModule([makeNativeRequest('sink')]))
    const records: unknown[] = []
    Hakka.start({ sinks: [(record) => records.push(record)] })
    await flushAsync()
    expect(records).toEqual([expect.objectContaining({ kind: 'network.request' })])
  })

  it('does not ingest native startup records after stop', async () => {
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(makeNativeModule([makeNativeRequest('stopped')]))
    Hakka.start()
    Hakka.stop()
    await flushAsync()
    expect(Hakka.getLogs()).toHaveLength(0)
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
