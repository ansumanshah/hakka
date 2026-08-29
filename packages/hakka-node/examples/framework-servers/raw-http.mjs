/**
 * raw-http.mjs — no framework, just node:http.
 *
 * Uses hakka-node's `register()` (the README's top-of-file one-liner)
 * rather than `startCapture()`, with `force: true` — `register()` only
 * starts capture when `NODE_ENV === 'development'`, and a bare
 * `node raw-http.mjs` run has no NODE_ENV set at all. That's what `force`
 * is for.
 *
 * Exercises `captureHttp` specifically: the outbound call this server makes
 * while handling a request uses node:http's own `http.get`, not `fetch()`.
 */
import http from 'node:http'

import { currentServerTraceId, register } from 'hakka-node'

import { printRecord } from './shared/capture.mjs'
import { runDemo } from './shared/runDemo.mjs'

const capture = register({
  force: true, // register() is dev-only by default — force it for this standalone run
  bridge: process.env.HAKKA_BRIDGE === '1', // off by default; HAKKA_BRIDGE=1 also streams into a live Hakka inspector
  captureFetch: true,
  captureHttp: true, // the capture surface this file exists to prove
  sink: (req) => printRecord('raw-http', req),
})

async function startServer(upstreamUrl) {
  const server = http.createServer((req, res) => {
    // hakka-node's trace propagation already pulled the incoming
    // x-hakka-trace header into async-local-storage context by the time
    // this listener runs — read it just to show it landed; the outbound
    // call below inherits it automatically, which is the actual point.
    const traceId = currentServerTraceId()
    console.log(`  server received trace ${traceId ?? '(none)'} for ${req.method} ${req.url}`)

    http.get(`${upstreamUrl}/users/1`, (upstreamRes) => {
      let body = ''
      upstreamRes.on('data', (chunk) => (body += chunk))
      upstreamRes.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(body)
      })
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}`, stop: () => new Promise((resolve) => server.close(resolve)) }
}

await runDemo('raw-http (node:http)', capture, startServer)
