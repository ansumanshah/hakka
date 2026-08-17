import { Hakka } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

import { hakkaBridge } from '../../src/core/HakkaBridge'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url: string

  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  sent: string[] = []

  constructor(url: string) {
    this.url = url
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.({ target: this } as unknown)
    }, 0)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as { data: unknown })
  }
}

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

  open() {}
  send() {}
  setRequestHeader() {}
  getAllResponseHeaders() {
    return ''
  }
  addEventListener() {}
}

type SmokeFrame = { type: string; payload?: NetworkRequest }
type SmokeArtifact = { type: string; requestId?: string; source?: NetworkRequest['source'] | undefined }

function frameToArtifact(frame: SmokeFrame): SmokeArtifact {
  // Canonical bridge protocol: every request frame is `{ type: 'request', payload }`.
  return { type: frame.type, requestId: frame.payload?.id, source: frame.payload?.source }
}

describe('Hakka desktop bridge smoke', () => {
  let origWebSocket: typeof WebSocket
  let origXHR: typeof XMLHttpRequest
  let origFetch: typeof fetch
  let wsInstance: MockWebSocket | null = null
  const mockFetch = jest.fn().mockResolvedValue(new Response('{"smoke":"ok"}', { status: 200 }))

  beforeEach(() => {
    Hakka.stop()
    Hakka.configure({ enabled: undefined, maxRequests: 100, maxAge: 86400 })
    Hakka.configure({ mode: 'auto' })

    origWebSocket = globalThis.WebSocket
    origXHR = globalThis.XMLHttpRequest
    const MockBridgeWebSocket = function MockBridgeWebSocket(url: string) {
      const socket = new MockWebSocket(url)
      wsInstance = socket
      return socket
    }
    MockBridgeWebSocket.CONNECTING = MockWebSocket.CONNECTING
    MockBridgeWebSocket.OPEN = MockWebSocket.OPEN
    MockBridgeWebSocket.CLOSING = MockWebSocket.CLOSING
    MockBridgeWebSocket.CLOSED = MockWebSocket.CLOSED
    globalThis.WebSocket = MockBridgeWebSocket as unknown as typeof WebSocket
    globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest
    origFetch = globalThis.fetch
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  afterEach(() => {
    hakkaBridge.disconnect()
    Hakka.stop()
    globalThis.WebSocket = origWebSocket
    globalThis.XMLHttpRequest = origXHR
    globalThis.fetch = origFetch
    wsInstance = null
  })

  it('opens socket, sends canonical request frames (payload), and handles storage messages without throwing', async () => {
    const statusStates: string[] = []
    const unsubStatus = hakkaBridge.onStatus((status) => {
      statusStates.push(status.state)
    })

    const seedLog: NetworkRequest = {
      id: 'seed',
      url: 'https://example.com/seed',
      method: 'GET',
      status: 200,
      startTime: 1_700_000_000_001,
      duration: 10,
      requestHeaders: {},
      responseHeaders: {},
      requestBodySize: 0,
      responseBodySize: 0,
      requestBody: null,
      responseBody: null,
      error: null,
      source: 'native',
    }

    jest.spyOn(Hakka, 'getLogs').mockReturnValueOnce([seedLog])

    hakkaBridge.connect('ws://localhost:3000')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(statusStates).toContain('connected')
    expect(hakkaBridge.isConnected).toBe(true)
    expect(wsInstance).not.toBeNull()

    Hakka.start({ mode: 'js' })
    await globalThis.fetch('https://example.com/streamed')

    await new Promise((resolve) => setTimeout(resolve, 5))
    const frames = wsInstance!.sent.map((frame) => JSON.parse(frame) as SmokeFrame)
    const artifacts = frames.map(frameToArtifact)
    // Canonical protocol: the backlog flush + live captures are all `{ type: 'request', payload }`.
    // No 'batch' frame is emitted (the bridge hub doesn't accept one).
    expect(frames.some((frame) => frame.type === 'batch')).toBe(false)
    expect(frames.some((frame) => frame.type === 'request' && frame.payload != null)).toBe(true)
    // Both the seeded backlog entry and the streamed live request reach the wire as request frames.
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'request', requestId: 'seed' }),
        expect.objectContaining({ type: 'request', source: 'fetch' }),
      ]),
    )

    expect(() => {
      wsInstance!.emitMessage({
        type: 'storage:set',
        payload: {
          key: 'hakka:smoke',
          value: 'v1',
        },
      })
    }).not.toThrow()

    unsubStatus()
  })
})
