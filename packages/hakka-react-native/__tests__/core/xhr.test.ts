import { enableXHRInterceptor } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

// Mock XMLHttpRequest
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
  private _headers: Map<string, string> = new Map()

  open(_method: string, _url: string) {}
  send(_data?: unknown) {
    // Simulate async response
    setTimeout(() => {
      this.readyState = 4
      this.status = 200
      this.responseText = '{"result":"ok"}'
      this._fire('loadend')
    }, 0)
  }
  setRequestHeader(key: string, value: string) {
    this._headers.set(key, value)
  }
  getAllResponseHeaders() {
    return 'content-type: application/json\r\nx-request-id: abc123'
  }
  addEventListener(event: string, handler: Function) {
    const list = this._listeners.get(event) ?? []
    list.push(handler)
    this._listeners.set(event, list)
  }
  private _fire(event: string) {
    for (const handler of this._listeners.get(event) ?? []) {
      handler.call(this)
    }
  }
}

describe('XHR interceptor', () => {
  let captured: NetworkRequest[]
  const OrigXHR = globalThis.XMLHttpRequest

  beforeEach(() => {
    captured = []
    globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = OrigXHR
  })

  it('captures XHR requests with WeakMap state', (done) => {
    const teardown = enableXHRInterceptor(
      (r) => {
        captured.push(r)
        expect(r.source).toBe('xhr')
        expect(r.url).toBe('https://api.example.com/data')
        expect(r.method).toBe('POST')
        expect(r.status).toBe(200)
        expect(r.responseBody).toBe('{"result":"ok"}')
        teardown()
        done()
      },
      262144,
      ['authorization'],
    )

    const xhr = new XMLHttpRequest()
    xhr.open('POST', 'https://api.example.com/data')
    xhr.setRequestHeader('Authorization', 'Bearer token')
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.send('{"q":"test"}')
  })

  it('restores original methods on teardown', () => {
    const origOpen = XMLHttpRequest.prototype.open
    const teardown = enableXHRInterceptor(() => {}, 262144, [])
    expect(XMLHttpRequest.prototype.open).not.toBe(origOpen)
    teardown()
    expect(XMLHttpRequest.prototype.open).toBe(origOpen)
  })
})
