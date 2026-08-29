import { findByTrace, section } from './capture.mjs'
import { callWithTrace, wait } from './client.mjs'
import { startUpstream } from './upstream.mjs'

/**
 * Shared harness for every framework demo: start the upstream API, start the
 * framework's server (`startServer(upstreamUrl)` returns its base `url` and
 * a `stop()`), fire one traced client request at it, and check that the
 * server's own outbound call captured the SAME correlationId — proving
 * hakka-node's trace propagation actually joins the hop, not just
 * documenting that it does.
 */
export async function runDemo(label, capture, startServer) {
  const upstream = await startUpstream()
  const { url, stop } = await startServer(upstream.url)

  section(`${label}  (server on ${url}, upstream on ${upstream.url})`)
  const traceId = await callWithTrace(`${url}/users/1`)
  // The sink fires synchronously inside the server's outbound call, strictly
  // before the client's own fetch() above resolves — this wait just lets
  // stdout settle in a readable order, it isn't load-bearing for capture.
  await wait(150)

  const joined = findByTrace(traceId)
  console.log(
    joined
      ? `  trace check: PASS. The server's outbound call carried the same correlationId (${traceId})`
      : `  trace check: FAIL. No outbound record carried correlationId ${traceId}`,
  )

  await stop()
  await new Promise((resolve) => upstream.server.close(resolve))
  capture?.stop()
  if (!joined) process.exitCode = 1
}
