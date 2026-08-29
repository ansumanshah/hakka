/**
 * express.mjs — hakka-node wired into an Express app via startCapture()/
 * stopCapture() (explicit start/stop control, tied to the app's own
 * listen()/close() lifecycle — the pattern hakka-node's README recommends
 * for frameworks, as opposed to register()'s dev-only gate).
 *
 * Exercises `captureFetch`: the outbound call this handler makes uses
 * fetch().
 */
import express from 'express'
import { startCapture } from 'hakka-node'

import { printRecord } from './shared/capture.mjs'
import { runDemo } from './shared/runDemo.mjs'

const capture = startCapture({
  bridge: process.env.HAKKA_BRIDGE === '1', // off by default; HAKKA_BRIDGE=1 also streams into a live Hakka inspector
  captureFetch: true, // the capture surface this file exists to prove
  captureHttp: true,
  sink: (req) => printRecord('express', req),
})

async function startServer(upstreamUrl) {
  const app = express()

  app.get('/users/:id', async (req, res) => {
    // Runs inside the async-local-storage context hakka-node's trace
    // propagation set up from the incoming x-hakka-trace header — this
    // fetch() is captured with that SAME correlationId.
    const upstreamRes = await fetch(`${upstreamUrl}/users/${req.params.id}`)
    res.json(await upstreamRes.json())
  })

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}`, stop: () => new Promise((resolve) => server.close(resolve)) }
}

await runDemo('express', capture, startServer)
