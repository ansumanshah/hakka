import { afterEach, describe, expect, test } from 'bun:test'
import http from 'node:http'
import type { Server } from 'node:http'

import { setTraceProvider } from 'hakka-core'

import { TRACEPARENT_HEADER } from '../trace'
import { disableTraceparentFetch, enableTraceparentFetch } from '../traceparentFetch'

afterEach(() => {
  disableTraceparentFetch()
  setTraceProvider(null)
})

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  )
}

describe('enableTraceparentFetch', () => {
  test('input: Request, no init — injects traceparent alongside the Request’s own headers', async () => {
    const seen: Record<string, string | undefined> = {}
    const server = http.createServer((req, res) => {
      seen['x-original'] = req.headers['x-original'] as string | undefined
      seen[TRACEPARENT_HEADER] = req.headers[TRACEPARENT_HEADER] as string | undefined
      res.end('ok')
    })
    const port = await listen(server)

    setTraceProvider(() => 'T-REQ-ONLY')
    enableTraceparentFetch()

    const request = new Request(`http://127.0.0.1:${port}/`, { headers: { 'x-original': '1' } })
    await fetch(request)
    server.close()

    expect(seen['x-original']).toBe('1')
    expect(seen[TRACEPARENT_HEADER]).toBeTruthy()
  })

  test('input: Request + init.headers — merges all three (Request headers, init headers, traceparent) instead of init.headers clobbering the rest', async () => {
    // Regression: on the Request branch, `nextInit` used to stay equal to the
    // original `init`. Per the Request constructor / fetch spec, when both a
    // Request and an init with `headers` are passed to fetch(), init.headers
    // wins outright rather than merging — so the caller's init.headers used
    // to silently clobber both the Request's own headers AND the traceparent
    // this wrapper just injected.
    const seen: Record<string, string | undefined> = {}
    const server = http.createServer((req, res) => {
      seen['x-original'] = req.headers['x-original'] as string | undefined
      seen['authorization'] = req.headers['authorization'] as string | undefined
      seen[TRACEPARENT_HEADER] = req.headers[TRACEPARENT_HEADER] as string | undefined
      res.end('ok')
    })
    const port = await listen(server)

    setTraceProvider(() => 'T-REQ-PLUS-INIT')
    enableTraceparentFetch()

    const request = new Request(`http://127.0.0.1:${port}/`, { headers: { 'x-original': '1' } })
    await fetch(request, { headers: { authorization: 'Bearer caller-secret' } })
    server.close()

    // The caller's own init.headers must still reach the server…
    expect(seen['authorization']).toBe('Bearer caller-secret')
    // …without clobbering the Request's own headers…
    expect(seen['x-original']).toBe('1')
    // …or the traceparent this wrapper injected.
    expect(seen[TRACEPARENT_HEADER]).toBeTruthy()
  })

  test('input: Request that already carries its own traceparent + init.headers — still merges instead of taking the early-return path', async () => {
    // Regression for the narrower case the previous fix left open: the merge
    // block only ran inside `if (!headers.has(TRACEPARENT_HEADER))`, so a
    // Request that ALREADY has a traceparent (e.g. built from an earlier
    // instrumented Request, or set manually by the caller) took the
    // early-return path whenever init.headers was also passed — calling
    // inner(input, init) with the ORIGINAL unmerged pair and letting
    // init.headers wholesale-replace the Request's own headers per the Fetch
    // spec, reproducing the exact class of bug this file exists to fix.
    const seen: Record<string, string | undefined> = {}
    const server = http.createServer((req, res) => {
      seen['x-original'] = req.headers['x-original'] as string | undefined
      seen['authorization'] = req.headers['authorization'] as string | undefined
      seen[TRACEPARENT_HEADER] = req.headers[TRACEPARENT_HEADER] as string | undefined
      res.end('ok')
    })
    const port = await listen(server)

    setTraceProvider(() => 'T-ALREADY-SET')
    enableTraceparentFetch()

    const preExisting = 'PRE-EXISTING-TRACEPARENT'
    const request = new Request(`http://127.0.0.1:${port}/`, {
      headers: { 'x-original': '1', [TRACEPARENT_HEADER]: preExisting },
    })
    await fetch(request, { headers: { authorization: 'Bearer caller-secret' } })
    server.close()

    // The caller's own init.headers must still reach the server…
    expect(seen['authorization']).toBe('Bearer caller-secret')
    // …without clobbering the Request's own headers…
    expect(seen['x-original']).toBe('1')
    // …and the Request's PRE-EXISTING traceparent must survive untouched —
    // this wrapper only injects one when the header is missing, never
    // overwrites an already-set value.
    expect(seen[TRACEPARENT_HEADER]).toBe(preExisting)
  })

  test('input: plain URL string + init.headers — still injects traceparent without dropping caller headers', async () => {
    const seen: Record<string, string | undefined> = {}
    const server = http.createServer((req, res) => {
      seen['authorization'] = req.headers['authorization'] as string | undefined
      seen[TRACEPARENT_HEADER] = req.headers[TRACEPARENT_HEADER] as string | undefined
      res.end('ok')
    })
    const port = await listen(server)

    setTraceProvider(() => 'T-PLAIN')
    enableTraceparentFetch()

    await fetch(`http://127.0.0.1:${port}/`, { headers: { authorization: 'Bearer caller-secret' } })
    server.close()

    expect(seen['authorization']).toBe('Bearer caller-secret')
    expect(seen[TRACEPARENT_HEADER]).toBeTruthy()
  })

  test('no active trace id — passes the request through untouched (no traceparent injected)', async () => {
    const seen: Record<string, string | undefined> = {}
    const server = http.createServer((req, res) => {
      seen[TRACEPARENT_HEADER] = req.headers[TRACEPARENT_HEADER] as string | undefined
      res.end('ok')
    })
    const port = await listen(server)

    // No setTraceProvider call — currentTraceId() returns undefined.
    enableTraceparentFetch()
    await fetch(`http://127.0.0.1:${port}/`)
    server.close()

    expect(seen[TRACEPARENT_HEADER]).toBeUndefined()
  })

  test('disableTraceparentFetch() restores the fetch this wrapper saw at install time', async () => {
    const original = globalThis.fetch
    enableTraceparentFetch()
    expect(globalThis.fetch).not.toBe(original)
    disableTraceparentFetch()
    expect(globalThis.fetch).toBe(original)
  })
})
