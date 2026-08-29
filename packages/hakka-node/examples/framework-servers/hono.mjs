/**
 * hono.mjs — hakka-node wired into a Hono app (via @hono/node-server, since
 * Hono itself is runtime-agnostic and needs a Node adapter to listen on a
 * port) through startCapture()/stopCapture(), tied to the adapter server's
 * own listen/close lifecycle.
 *
 * Exercises `captureFetch` again, through Hono's Web-standard Request/Response
 * handler shape rather than Express's or Fastify's — same point as the other
 * two: hakka-node patches fetch()/http globally, it doesn't care what's on top.
 */
import { serve } from '@hono/node-server'
import { startCapture } from 'hakka-node'
import { Hono } from 'hono'

import { printRecord } from './shared/capture.mjs'
import { runDemo } from './shared/runDemo.mjs'

const capture = startCapture({
  bridge: process.env.HAKKA_BRIDGE === '1', // off by default; HAKKA_BRIDGE=1 also streams into a live Hakka inspector
  captureFetch: true, // the capture surface this file exists to prove
  captureHttp: true,
  sink: (req) => printRecord('hono', req),
})

async function startServer(upstreamUrl) {
  const app = new Hono()

  app.get('/users/:id', async (c) => {
    // Runs inside the async-local-storage context hakka-node's trace
    // propagation set up from the incoming x-hakka-trace header — this
    // fetch() is captured with that SAME correlationId.
    const upstreamRes = await fetch(`${upstreamUrl}/users/${c.req.param('id')}`)
    return c.json(await upstreamRes.json())
  })

  const server = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => resolve({ s, info }))
  })
  const { port } = server.info
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.s.close(resolve)),
  }
}

await runDemo('hono', capture, startServer)
