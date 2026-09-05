/**
 * app.mjs: the demo "production app", a plain node:http server standing in
 * for any real backend, wired with `hakka-node/prod` exactly the way ADR
 * 0002 / the README's "Production capture for a debug cohort" section
 * documents:
 *
 *   1. Cohort gate: `runInTraceContext({ traceId, debug }, fn)` around every
 *      request, `debug` decided by THIS app's own check. Here that check is
 *      a literal `x-debug-cohort: 1` header, standing in for whatever real
 *      allowlist logic (session lookup, feature flag, user-id check) a real
 *      deployment would use. `hakka-node/prod` does not ship that check;
 *      ADR 0002 is explicit that deciding cohort membership is the app's
 *      job, not the library's.
 *   2. `startProdCapture({ captureUrls, sink })`: the required URL
 *      allowlist, restricted to this app's own `/notes` upstream call (NOT
 *      `/admin/*`, on purpose, see demo.mjs's AND-gate check). `sink` is
 *      only here for this demo's own proof; a real deployment would read via
 *      `getRecords()`/the pull route below instead.
 *   3. `createPullHandler` mounted at `GET /__hakka/pull`, behind the app's
 *      own routing (no new open port) and its own bearer token.
 *
 * The one real route this app exposes, `POST /notes`, forwards a
 * client-submitted note to the "notes" upstream (shared/upstream.mjs); that
 * OUTBOUND call is what gets captured, gated by BOTH the cohort flag and the
 * URL allowlist. `GET /admin/*` makes an outbound call the allowlist does
 * NOT cover, used to prove the AND-gate half of ADR 0002's design.
 */
import { randomUUID } from 'node:crypto'
import http from 'node:http'

import { runInTraceContext } from 'hakka-node'
import { createPullHandler, startProdCapture } from 'hakka-node/prod'

import { sendFetchResponse, toFetchRequest } from './shared/fetchRequest.mjs'

export function startProdApp(upstreamUrl, { pullToken = randomUUID(), sink } = {}) {
  const capture = startProdCapture({
    captureUrls: [`${upstreamUrl}/notes`], // NOT /admin/*, see demo.mjs's AND-gate check
    sink,
  })

  const pullHandler = createPullHandler({ capture, token: pullToken })

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/__hakka/pull')) {
      void pullHandler(toFetchRequest(req)).then((fetchRes) => sendFetchResponse(fetchRes, res))
      return
    }

    // The ADR 0002 cohort gate. Every request runs through this wrapper
    // regardless of cohort membership: `debug: false` for a non-cohort
    // request is what makes `cohortGate()` (startProdCapture's default
    // `shouldCapture`) return false for it, not the absence of the wrapper.
    // `traceId` doubles as the correlationId `?user=` filters against below.
    const debug = req.headers['x-debug-cohort'] === '1'
    const userTag = typeof req.headers['x-user'] === 'string' ? req.headers['x-user'] : 'anon'
    const traceId = `${userTag}-${randomUUID().slice(0, 8)}`

    runInTraceContext({ traceId, debug }, () => {
      handleRequest(req, res, upstreamUrl).catch((err) => {
        res.writeHead(500)
        res.end(String(err))
      })
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        pullToken,
        capture,
        stop: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

async function handleRequest(req, res, upstreamUrl) {
  if (req.method === 'POST' && req.url === '/notes') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    // The outbound call this whole example exists to prove: fetch() to the
    // allowlisted upstream, made from inside the cohort's trace context.
    const upstreamRes = await fetch(`${upstreamUrl}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    })
    res.writeHead(upstreamRes.status, { 'content-type': 'application/json' })
    res.end(await upstreamRes.text())
    return
  }

  if (req.method === 'GET' && req.url?.startsWith('/admin')) {
    // Outbound call to a URL NOT on captureUrls: cohort or not, this must
    // never land in the ring buffer. See demo.mjs's AND-gate check.
    const upstreamRes = await fetch(`${upstreamUrl}${req.url}`)
    res.writeHead(upstreamRes.status, { 'content-type': 'application/json' })
    res.end(await upstreamRes.text())
    return
  }

  res.writeHead(404)
  res.end('not found')
}
