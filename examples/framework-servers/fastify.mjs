/**
 * fastify.mjs — hakka-node wired into a Fastify app via startCapture()/
 * stopCapture(), tied to fastify.listen()/fastify.close().
 *
 * Exercises `captureFetch` again, but through Fastify's own route/plugin
 * shape rather than Express's — the point is that hakka-node doesn't care
 * which framework is on top of it, it patches fetch()/http globally.
 */
import Fastify from 'fastify'
import { startCapture } from 'hakka-node'

import { printRecord } from './shared/capture.mjs'
import { runDemo } from './shared/runDemo.mjs'

const capture = startCapture({
  bridge: process.env.HAKKA_BRIDGE === '1', // off by default; HAKKA_BRIDGE=1 also streams into a live Hakka inspector
  captureFetch: true,
  captureHttp: true,
  sink: (req) => printRecord('fastify', req),
})

async function startServer(upstreamUrl) {
  const fastify = Fastify()

  fastify.get('/users/:id', async (request) => {
    const upstreamRes = await fetch(`${upstreamUrl}/users/${request.params.id}`)
    return upstreamRes.json()
  })

  await fastify.listen({ port: 0, host: '127.0.0.1' })
  const { port } = fastify.server.address()
  return { url: `http://127.0.0.1:${port}`, stop: () => fastify.close() }
}

await runDemo('fastify', capture, startServer)
