import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { mockEngine } from '../../engine/MockEngine'
import { ThrottleEngine } from '../../engine/ThrottleEngine'
import type { NetworkRequest } from '../../model/types'
import { configureBodyRedaction } from '../../utils/bodyRedaction'
import { enableFetchInterceptor } from '../fetch'
import { enableWebSocketInterceptor } from '../websocket'
import { enableXHRInterceptor } from '../xhr'

const globals = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, XMLHttpRequest: globalThis.XMLHttpRequest }
let dispose: (() => void) | undefined

class TestSocket extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  sent: unknown[] = []
  failSend = false
  constructor(readonly url: string) {
    super()
  }
  send(data: unknown) {
    if (this.failSend) throw new Error('socket not open')
    this.sent.push(data)
  }
}

class TestXHR extends EventTarget {
  private state = 1
  get readyState() {
    return this.state
  }
  get status() {
    return 200
  }
  responseType = ''
  get responseText() {
    return '{}'
  }
  get response(): unknown {
    return '{}'
  }
  sends = 0
  open(_method: string, _url: string) {
    this.state = 1
  }
  send() {
    this.sends += 1
  }
  setRequestHeader(_name: string, _value: string) {}
  getAllResponseHeaders() {
    return 'content-type: application/json'
  }
  finish() {
    this.state = 4
    this.dispatchEvent(new Event('loadend'))
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  mockEngine.clearRules()
  ThrottleEngine.setProfile('none')
  globalThis.WebSocket = TestSocket as unknown as typeof WebSocket
  globalThis.XMLHttpRequest = TestXHR as unknown as typeof XMLHttpRequest
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  mockEngine.clearRules()
  configureBodyRedaction([])
  globalThis.fetch = globals.fetch
  globalThis.WebSocket = globals.WebSocket
  globalThis.XMLHttpRequest = globals.XMLHttpRequest
})

describe('capture teardown and application behavior', () => {
  test('fetch in flight returns to the caller without emitting after disposal', async () => {
    let resolve!: (response: Response) => void
    globalThis.fetch = (() =>
      new Promise<Response>((done) => {
        resolve = done
      })) as typeof fetch
    const records: NetworkRequest[] = []
    dispose = enableFetchInterceptor((record) => records.push(record), 1024, [])
    const response = fetch('https://example.com/late')
    dispose()
    resolve(new Response('{}'))
    expect((await response).status).toBe(200)
    await tick()
    expect(records).toEqual([])
  })

  test('existing sockets keep sending after disposal without emitting', () => {
    const records: NetworkRequest[] = []
    dispose = enableWebSocketInterceptor((record) => records.push(record))
    const socket = new WebSocket('wss://example.com') as unknown as TestSocket
    dispose()
    socket.send('late')
    socket.dispatchEvent(new Event('open'))
    expect(socket.sent).toEqual(['late'])
    expect(records).toEqual([])
  })

  test('an async socket blob preview cannot mutate a captured frame after disposal', async () => {
    let resolve!: (value: ArrayBuffer) => void
    const blob = new Blob(['private'])
    blob.arrayBuffer = () =>
      new Promise<ArrayBuffer>((done) => {
        resolve = done
      })
    const records: NetworkRequest[] = []
    dispose = enableWebSocketInterceptor((record) => records.push(record))
    const socket = new WebSocket('wss://example.com')
    socket.send(blob)
    expect(records[0]?.messages?.[0]?.data).toBe(7)
    dispose()
    resolve(new TextEncoder().encode('private').buffer)
    await tick()
    expect(records[0]?.messages?.[0]?.data).toBe(7)
  })

  test('a failed socket send does not capture a frame', () => {
    const records: NetworkRequest[] = []
    dispose = enableWebSocketInterceptor((record) => records.push(record))
    const socket = new WebSocket('wss://example.com') as unknown as TestSocket
    socket.failSend = true
    expect(() => socket.send('unsent')).toThrow('socket not open')
    expect(records).toEqual([])
  })

  test('a throwing capture listener does not escape a socket open callback', () => {
    let callbackError = false
    dispose = enableWebSocketInterceptor(() => {
      callbackError = true
      throw new Error('capture failed')
    })
    const socket = new WebSocket('wss://example.com')
    expect(() => socket.dispatchEvent(new Event('open'))).not.toThrow()
    expect(callbackError).toBe(true)
  })

  test('reusing an XHR emits once per request and skips reused bridge requests', () => {
    const records: NetworkRequest[] = []
    dispose = enableXHRInterceptor((record) => records.push(record), 1024, [])
    const xhr = new XMLHttpRequest() as unknown as TestXHR
    xhr.open('GET', 'https://example.com/first')
    xhr.send()
    xhr.finish()
    xhr.open('GET', 'https://example.com/second')
    xhr.send()
    xhr.finish()
    expect(records.map((record) => record.url)).toEqual(['https://example.com/first', 'https://example.com/second'])
    xhr.open('GET', 'http://localhost:8989/bridge')
    xhr.send()
    xhr.finish()
    expect(records).toHaveLength(2)
  })

  test('XHR completion after disposal cannot emit into a restarted capture', () => {
    const records: NetworkRequest[] = []
    dispose = enableXHRInterceptor((record) => records.push(record), 1024, [])
    const xhr = new XMLHttpRequest() as unknown as TestXHR
    xhr.open('GET', 'https://example.com/late')
    xhr.send()
    dispose()
    dispose = enableXHRInterceptor((record) => records.push(record), 1024, [])
    xhr.finish()
    expect(records).toEqual([])
  })
})

describe('mock capture privacy', () => {
  test('fetch mock capture redacts headers/body and caps previews while the caller receives the original', async () => {
    configureBodyRedaction(['token'])
    const records: NetworkRequest[] = []
    mockEngine.addRule({
      pattern: '/mock',
      enabled: true,
      response: { status: 200, headers: { 'set-cookie': 'secret' }, body: '{"token":"private"}' },
    })
    dispose = enableFetchInterceptor((record) => records.push(record), 1024, ['set-cookie'])
    const response = await fetch('https://example.com/mock')
    expect(await response.text()).toBe('{"token":"private"}')
    expect(records[0]?.responseHeaders?.['set-cookie']).toBe('[REDACTED]')
    expect(records[0]?.responseBody).toBe('{"token":"[REDACTED]"}')
    dispose()
    dispose = enableFetchInterceptor((record) => records.push(record), 4, ['set-cookie'])
    await fetch('https://example.com/mock')
    expect(records.at(-1)?.responseBody).toBeNull()
    expect(records.at(-1)?.responseBodySize).toBe(19)
  })

  test('XHR mock body providers receive the original request while captured data stays redacted', async () => {
    configureBodyRedaction(['token'])
    let seenHeaders: Record<string, string> = {}
    let seenBody: string | undefined
    mockEngine.addRule({
      pattern: '/mock',
      enabled: true,
      response: {
        status: 200,
        body: '',
        bodyProvider(request) {
          seenHeaders = request.headers
          seenBody = request.body
          return '{}'
        },
      },
    })
    const records: NetworkRequest[] = []
    dispose = enableXHRInterceptor((record) => records.push(record), 1024, ['authorization'])
    const xhr = new XMLHttpRequest()
    xhr.open('POST', 'https://example.com/mock')
    xhr.setRequestHeader('Authorization', 'Bearer private')
    xhr.send('{"token":"private"}')
    await tick()
    expect(seenHeaders.Authorization).toBe('Bearer private')
    expect(seenBody).toBe('{"token":"private"}')
    expect(records[0]?.requestHeaders?.Authorization).toBe('[REDACTED]')
    expect(records[0]?.requestBody).toBe('{"token":"[REDACTED]"}')
  })

  test('a delayed mock completion cannot overwrite a reopened XHR', async () => {
    let resolve!: (value: string) => void
    mockEngine.addRule({
      pattern: '/mock',
      enabled: true,
      response: {
        status: 201,
        body: '',
        bodyProvider: () =>
          new Promise<string>((done) => {
            resolve = done
          }),
      },
    })
    const records: NetworkRequest[] = []
    dispose = enableXHRInterceptor((record) => records.push(record), 1024, [])
    const xhr = new XMLHttpRequest() as unknown as TestXHR
    xhr.open('GET', 'https://example.com/mock')
    xhr.send()
    xhr.open('GET', 'https://example.com/real')
    xhr.send()
    resolve('stale mock')
    await tick()
    expect(xhr.responseText).toBe('{}')
    xhr.finish()
    expect(records.map((record) => record.url)).toEqual(['https://example.com/real'])
  })

  test('XHR mock capture redacts headers/body and caps previews while the caller receives the original', async () => {
    configureBodyRedaction(['token'])
    const records: NetworkRequest[] = []
    mockEngine.addRule({
      pattern: '/mock',
      enabled: true,
      response: { status: 200, headers: { 'set-cookie': 'secret' }, body: '{"token":"private"}' },
    })
    dispose = enableXHRInterceptor((record) => records.push(record), 1024, ['set-cookie'])
    const xhr = new XMLHttpRequest() as unknown as TestXHR
    xhr.open('GET', 'https://example.com/mock')
    xhr.send()
    await tick()
    expect(xhr.responseText).toBe('{"token":"private"}')
    expect(records[0]?.responseHeaders?.['set-cookie']).toBe('[REDACTED]')
    expect(records[0]?.responseBody).toBe('{"token":"[REDACTED]"}')
    dispose()
    dispose = enableXHRInterceptor((record) => records.push(record), 4, ['set-cookie'])
    xhr.open('GET', 'https://example.com/mock')
    xhr.send()
    await tick()
    expect(records.at(-1)?.responseBody).toBeNull()
    expect(records.at(-1)?.responseBodySize).toBe(19)
  })
})
