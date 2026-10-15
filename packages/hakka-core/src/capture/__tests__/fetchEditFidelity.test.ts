// Breakpoint resumes and rewrite rules must send the app's real request, not the redacted
// text preview the inspector shows: an edit only replaces what the user actually changed.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { breakpointEngine } from '../../engine/BreakpointEngine'
import { mockEngine } from '../../engine/MockEngine'
import type { NetworkRequest } from '../../model/types'
import { configureBodyRedaction } from '../../utils/bodyRedaction'
import { enableFetchInterceptor } from '../fetch'

const REAL_FETCH = globalThis.fetch
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

interface SentRequest {
  url: string
  method: string
  headers: Headers
  bodyText: string
  signal: AbortSignal | null
}

/** Stub network that normalizes whatever the interceptor sent into a real Request for inspection. */
function withInterceptor(respond: () => Response): {
  records: NetworkRequest[]
  sent: SentRequest[]
  rawInits: Array<RequestInit | undefined>
  dispose: () => void
} {
  const sent: SentRequest[] = []
  const rawInits: Array<RequestInit | undefined> = []
  const records: NetworkRequest[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    rawInits.push(init)
    const req = new Request(input, init)
    sent.push({
      url: req.url,
      method: req.method,
      headers: req.headers,
      bodyText: await req.text(),
      signal: init?.signal ?? (input instanceof Request ? input.signal : null),
    })
    return respond()
  }) as typeof fetch
  const dispose = enableFetchInterceptor((r) => records.push(r), 1_000_000, [])
  return { records, sent, rawInits, dispose }
}

beforeEach(() => {
  mockEngine.clearRules()
})

afterEach(() => {
  breakpointEngine.resumeAll()
  breakpointEngine.clearBreakpoints()
  mockEngine.clearRules()
  configureBodyRedaction([])
  globalThis.fetch = REAL_FETCH
})

describe('request breakpoint resume', () => {
  test('a body equal to the redacted preview sends the real body, not "[REDACTED]"', async () => {
    configureBodyRedaction(['password'])
    breakpointEngine.addBreakpoint({ pattern: '/login', on: 'request', enabled: true })
    const { sent, dispose } = withInterceptor(() => new Response('ok'))
    try {
      const p = globalThis.fetch('https://api.example.com/login', {
        method: 'POST',
        body: JSON.stringify({ user: 'a', password: 'hunter2' }),
      })
      await settle()
      const [entry] = breakpointEngine.getPaused()
      if (entry?.phase !== 'request') throw new Error('expected a request pause')
      expect(entry.request.body).toContain('[REDACTED]')
      breakpointEngine.resume(entry.id, { url: entry.request.url, body: entry.request.body })
      await p
      expect(JSON.parse(sent[0]!.bodyText)).toEqual({ user: 'a', password: 'hunter2' })
    } finally {
      dispose()
    }
  })

  test('a URL edit keeps a FormData body as FormData', async () => {
    breakpointEngine.addBreakpoint({ pattern: '/upload', on: 'request', enabled: true })
    const { sent, rawInits, dispose } = withInterceptor(() => new Response('ok'))
    try {
      const form = new FormData()
      form.append('name', 'value-1')
      const p = globalThis.fetch('https://api.example.com/upload', { method: 'POST', body: form })
      await settle()
      const [entry] = breakpointEngine.getPaused()
      if (entry?.phase !== 'request') throw new Error('expected a request pause')
      breakpointEngine.resume(entry.id, { url: 'https://api.example.com/upload?v=2', body: entry.request.body })
      await p
      expect(sent[0]!.url).toBe('https://api.example.com/upload?v=2')
      expect(rawInits[0]?.body).toBe(form)
      expect(sent[0]!.bodyText).toContain('value-1')
    } finally {
      dispose()
    }
  })

  test('a URL edit on a Request input keeps its headers, body, and signal', async () => {
    breakpointEngine.addBreakpoint({ pattern: '/orders', on: 'request', enabled: true })
    const { sent, dispose } = withInterceptor(() => new Response('ok'))
    try {
      const controller = new AbortController()
      const request = new Request('https://api.example.com/orders', {
        method: 'POST',
        headers: { 'x-app': 'shop' },
        body: 'order-payload',
        signal: controller.signal,
      })
      const p = globalThis.fetch(request)
      await settle()
      const [entry] = breakpointEngine.getPaused()
      if (entry?.phase !== 'request') throw new Error('expected a request pause')
      breakpointEngine.resume(entry.id, { url: 'https://api.example.com/orders?edited=1' })
      await p
      expect(sent[0]!.url).toBe('https://api.example.com/orders?edited=1')
      expect(sent[0]!.method).toBe('POST')
      expect(sent[0]!.headers.get('x-app')).toBe('shop')
      expect(sent[0]!.bodyText).toBe('order-payload')
      controller.abort()
      expect(sent[0]!.signal?.aborted).toBe(true)
    } finally {
      dispose()
    }
  })

  test('an edited body is sent and recorded redacted', async () => {
    configureBodyRedaction(['password'])
    breakpointEngine.addBreakpoint({ pattern: '/login', on: 'request', enabled: true })
    const { sent, records, dispose } = withInterceptor(() => new Response('ok'))
    try {
      const p = globalThis.fetch('https://api.example.com/login', { method: 'POST', body: '{"password":"a"}' })
      await settle()
      const [entry] = breakpointEngine.getPaused()
      breakpointEngine.resume(entry!.id, { body: '{"password":"b"}' })
      await p
      expect(sent[0]!.bodyText).toBe('{"password":"b"}')
      expect(records.at(-1)?.requestBody).toBe('{"password":"[REDACTED]"}')
    } finally {
      dispose()
    }
  })
})

describe('response breakpoint resume', () => {
  const BYTES = [0xff, 0xfe, 0x00, 0x81]

  test('resuming without edits hands back the original response (binary body, url, redirected)', async () => {
    breakpointEngine.addBreakpoint({ pattern: '/image', on: 'response', enabled: true })
    const original = new Response(new Uint8Array(BYTES), { status: 200 })
    Object.defineProperty(original, 'url', { value: 'https://cdn.example.com/image' })
    Object.defineProperty(original, 'redirected', { value: true })
    const { dispose } = withInterceptor(() => original)
    try {
      const p = globalThis.fetch('https://api.example.com/image')
      await settle()
      const [entry] = breakpointEngine.getPaused()
      if (entry?.phase !== 'response') throw new Error('expected a response pause')
      // The UI resends the values it was handed when the user changed nothing.
      breakpointEngine.resume(entry.id, {
        status: entry.response.status,
        headers: entry.response.headers,
        body: entry.response.body,
      })
      const res = await p
      expect(res.url).toBe('https://cdn.example.com/image')
      expect(res.redirected).toBe(true)
      expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(BYTES)
    } finally {
      dispose()
    }
  })

  test('a status-only edit keeps the binary body intact', async () => {
    breakpointEngine.addBreakpoint({ pattern: '/image', on: 'response', enabled: true })
    const { dispose } = withInterceptor(() => new Response(new Uint8Array(BYTES), { status: 200 }))
    try {
      const p = globalThis.fetch('https://api.example.com/image')
      await settle()
      const [entry] = breakpointEngine.getPaused()
      breakpointEngine.resume(entry!.id, { status: 404 })
      const res = await p
      expect(res.status).toBe(404)
      expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(BYTES)
    } finally {
      dispose()
    }
  })
})

describe('rewrite rules', () => {
  test('a request-only rewrite keeps a FormData body object', async () => {
    mockEngine.addRule({
      pattern: 'api.example.com/upload',
      response: { status: 200 },
      enabled: true,
      redirectTo: 'https://staging.example.com/upload',
    })
    const { sent, rawInits, dispose } = withInterceptor(() => new Response('ok'))
    try {
      const form = new FormData()
      form.append('file', 'contents-1')
      await globalThis.fetch('https://api.example.com/upload', { method: 'POST', body: form })
      expect(sent[0]!.url).toBe('https://staging.example.com/upload')
      expect(rawInits[0]?.body).toBe(form)
    } finally {
      dispose()
    }
  })

  test('a redirect rule on a Request input keeps its headers and body', async () => {
    mockEngine.addRule({
      pattern: 'api.example.com/orders',
      response: { status: 200 },
      enabled: true,
      redirectTo: 'https://staging.example.com/orders',
    })
    const { sent, dispose } = withInterceptor(() => new Response('ok'))
    try {
      await globalThis.fetch(
        new Request('https://api.example.com/orders', {
          method: 'POST',
          headers: { 'x-app': 'shop' },
          body: 'order-payload',
        }),
      )
      expect(sent[0]!.url).toBe('https://staging.example.com/orders')
      expect(sent[0]!.headers.get('x-app')).toBe('shop')
      expect(sent[0]!.bodyText).toBe('order-payload')
    } finally {
      dispose()
    }
  })

  test('a request-only rewrite resolves without waiting for a never-ending body', async () => {
    mockEngine.addRule({
      pattern: 'api.example.com/events',
      response: { status: 200 },
      enabled: true,
      redirectTo: 'https://staging.example.com/events',
    })
    const endless = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\n'))
      },
    })
    const { dispose } = withInterceptor(() => new Response(endless, { status: 200 }))
    try {
      const outcome = await Promise.race([
        globalThis.fetch('https://api.example.com/events').then(() => 'resolved'),
        new Promise((r) => setTimeout(() => r('stalled'), 200)),
      ])
      expect(outcome).toBe('resolved')
    } finally {
      dispose()
    }
  })

  test('graphql variables are redacted on a rewritten request', async () => {
    configureBodyRedaction(['password'])
    mockEngine.addRule({
      pattern: 'api.example.com/graphql',
      response: { status: 200 },
      enabled: true,
      redirectTo: 'https://staging.example.com/graphql',
    })
    const { records, dispose } = withInterceptor(() => new Response('{}'))
    try {
      await globalThis.fetch('https://api.example.com/graphql', {
        method: 'POST',
        body: JSON.stringify({ query: 'mutation Login { login }', variables: { password: 'hunter2' } }),
      })
      const rec = records.at(-1)
      expect(rec?.graphql?.operationName).toBe('Login')
      expect(rec?.graphql?.variables).toEqual({ password: '[REDACTED]' })
    } finally {
      dispose()
    }
  })
})

describe('mock rules', () => {
  const BunResponse = globalThis.Response
  /** Bun accepts a body on 204/304; browsers and Node throw, per the Fetch spec. Enforce the spec. */
  class SpecResponse extends BunResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      const status = init?.status ?? 200
      if (body != null && (status === 204 || status === 205 || status === 304)) {
        throw new TypeError(`Response constructor: Invalid response status code ${status}`)
      }
      super(body, init)
    }
  }

  afterEach(() => {
    globalThis.Response = BunResponse
  })

  test.each([204, 304])('a mock with status %d resolves with an empty body', async (status) => {
    mockEngine.addRule({ pattern: 'api.example.com/empty', response: { status, body: '' }, enabled: true })
    const { dispose } = withInterceptor(() => new BunResponse('real'))
    globalThis.Response = SpecResponse as typeof Response
    try {
      const res = await globalThis.fetch('https://api.example.com/empty')
      expect(res.status).toBe(status)
      expect(await res.text()).toBe('')
    } finally {
      dispose()
    }
  })
})
