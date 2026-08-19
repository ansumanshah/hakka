import { afterEach, describe, expect, test } from 'bun:test'
import http from 'node:http'
import type { Server } from 'node:http'

import {
  checkCaptureSourceConformance,
  setTraceProvider,
  type CaptureSourceProbe,
  type NetworkRequest,
} from 'hakka-core'

import { createHttpCaptureSource, disableHttpInterceptor } from '../httpInterceptor'

/**
 * Deliberately a SEPARATE file from `httpInterceptor.test.ts`, not a `describe` block appended
 * to it: mirrors `websocketCaptureSource.test.ts`'s own rationale for the same split — running
 * inside that file's suite would compete for `enableHttpInterceptor`'s module-level `patched`
 * flag against tests calling `enableHttpInterceptor` directly outside the CaptureSource wrapper.
 */

afterEach(() => {
  disableHttpInterceptor()
  setTraceProvider(null)
})

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  )
}

/**
 * Fires one real GET request against a local server and resolves once the response fully
 * arrives — the same point `httpInterceptor.ts`'s `finish(true)` synchronously calls `emit()`.
 * No artificial delay: a real loopback round trip is already several event-loop ticks, more
 * than enough for the harness's "work in flight when stop() is called" check to interleave a
 * real `source.stop()` between `triggerOnce()` starting and its response arriving.
 */
function triggerOnce(port: number, path = '/conformance-ping'): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (resp) => {
      resp.resume()
      resp.on('end', () => resolve())
    })
    req.on('error', reject)
    req.end()
  })
}

describe('createHttpCaptureSource — CaptureSource conformance', () => {
  test('all 7 lifecycle checks pass against the real wrapper', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    try {
      const probe: CaptureSourceProbe = {
        createSource: () => createHttpCaptureSource(),
        triggerOnce: () => triggerOnce(port),
      }
      const report = await checkCaptureSourceConformance(probe)
      expect(
        report.checks.map((c) => `${c.passed ? 'PASS' : 'FAIL'}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`),
      ).toEqual(report.checks.map((c) => `PASS: ${c.name}`))
      expect(report.passed).toBe(true)
    } finally {
      server.close()
    }
  })

  test('identity and correlation match ADR 0006 row 7', () => {
    const source = createHttpCaptureSource()
    expect(source.id).toBe('hakka.http')
    expect(source.runtime).toBe('server')
    expect(source.transport).toBe('http')
    expect(source.correlation).toBe('inherits')
  })

  test("correlation 'inherits': an ambient trace id set by the host reaches ctx.ingest unmodified — the source never mints one", async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    setTraceProvider(() => 'T-INHERITED')

    const records: NetworkRequest[] = []
    const source = createHttpCaptureSource()
    try {
      source.start({ ingest: (r) => records.push(r) })
      await triggerOnce(port, '/inherits-check')
      const rec = records.find((r) => r.url.includes('/inherits-check'))
      expect(rec?.correlationId).toBe('T-INHERITED')
      expect(rec?.requestHeaders?.['x-hakka-trace']).toBe('T-INHERITED')
    } finally {
      await source.stop()
      server.close()
    }
  })

  test("does not tag `runtime` onto the ingested record — that stays serverCapture.ts-composed-onRequest's job, not this wrapper's, so existing public behavior is unchanged", async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)

    const records: NetworkRequest[] = []
    const source = createHttpCaptureSource()
    try {
      source.start({ ingest: (r) => records.push(r) })
      await triggerOnce(port, '/no-runtime-tag')
      const rec = records.find((r) => r.url.includes('/no-runtime-tag'))
      expect(rec).toBeTruthy()
      expect(rec?.runtime).toBeUndefined()
    } finally {
      await source.stop()
      server.close()
    }
  })

  test('options passthrough: maxBodySize/redactHeaders/interceptorOptions.shouldCapture reach the wrapped interceptor unchanged', async () => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => res.end('ok'))
    })
    const port = await listen(server)

    const records: NetworkRequest[] = []
    const source = createHttpCaptureSource({
      maxBodySize: 4,
      redactHeaders: ['x-secret'],
      interceptorOptions: { shouldCapture: () => true },
    })
    try {
      source.start({ ingest: (r) => records.push(r) })
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/opts', method: 'POST', headers: { 'x-secret': 'shh' } },
          (resp) => {
            resp.resume()
            resp.on('end', () => resolve())
          },
        )
        req.on('error', reject)
        req.write('this body is longer than 4 bytes')
        req.end()
      })
      const rec = records.find((r) => r.url.includes('/opts'))
      expect(rec?.requestHeaders?.['x-secret']).toBe('[REDACTED]')
      // maxBodySize: 4 caps the captured body far below the 33-byte payload sent above.
      expect((rec?.requestBody ?? '').length).toBeLessThanOrEqual(4)
    } finally {
      await source.stop()
      server.close()
    }
  })

  test("a second concurrently-started instance shares the underlying module-level patch and silently captures nothing until the first stops — a known singleton limitation, not a bug (see the wrapper's doc)", async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)

    const firstRecords: NetworkRequest[] = []
    const secondRecords: NetworkRequest[] = []
    const first = createHttpCaptureSource()
    const second = createHttpCaptureSource()
    try {
      first.start({ ingest: (r) => firstRecords.push(r) })
      second.start({ ingest: (r) => secondRecords.push(r) }) // no-op: module already patched by `first`
      await triggerOnce(port, '/concurrent')
      expect(secondRecords.length).toBe(0)
      expect(firstRecords.some((r) => r.url.includes('/concurrent'))).toBe(true)
    } finally {
      await second.stop()
      await first.stop()
      server.close()
    }
  })
})
