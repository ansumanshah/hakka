import { parseIncomingTraceId, runInTraceContext, startCapture } from 'hakka-node'

import { printRecord } from './shared/capture.mjs'
import { runDemo } from './shared/runDemo.mjs'

const capture = startCapture({
  bridge: process.env.HAKKA_BRIDGE === '1',
  sink: (request) => printRecord('bun', request),
})

function startServer(upstreamUrl) {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const traceId = parseIncomingTraceId(Object.fromEntries(request.headers))
      const respond = () => fetch(`${upstreamUrl}/users/1`)
      return traceId ? runInTraceContext({ traceId }, respond) : respond()
    },
  })
  return { url: server.url.origin, stop: () => server.stop(true) }
}

await runDemo('Bun.serve', capture, startServer)
