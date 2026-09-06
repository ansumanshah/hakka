import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

import { register, runInTraceContext } from '../../packages/hakka-node/dist/index.mjs'

// This repository demo uses the built SDK without a separate consumer install.
const bridgeUrl = process.env.HAKKA_BRIDGE_URL ?? 'ws://127.0.0.1:8989'
const observer = new WebSocket(bridgeUrl)
const received = new Map()
observer.addEventListener('message', ({ data }) => {
  const frame = JSON.parse(String(data))
  if (frame.type === 'request') received.set(frame.payload.id, frame.payload)
})

let capture
let server
try {
  await new Promise((resolve, reject) => {
    const fail = () => {
      clearTimeout(timer)
      reject(new Error(`Cannot reach ${bridgeUrl}. Open Hakka for macOS first.`))
    }
    const timer = setTimeout(fail, 5000)
    observer.addEventListener('error', fail, { once: true })
    observer.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

  server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    if (request.url === '/slow') await delay(200)
    response.writeHead(request.url === '/error' ? 503 : 200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ path: request.url, method: request.method, body: Buffer.concat(chunks).toString() }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const captured = new Map()
  capture = register({ force: true, embedBridge: false, bridgeUrl, sink: (record) => captured.set(record.id, record) })

  await runInTraceContext({ traceId: 'desktop-demo' }, async () => {
    await Promise.all(
      ['/json', '/echo', '/error', '/slow'].map(async (path) => {
        const response = await fetch(`${baseUrl}${path}`, {
          method: path === '/echo' ? 'POST' : 'GET',
          headers: { authorization: 'Bearer desktop-demo-secret', 'content-type': 'application/json' },
          ...(path === '/echo' ? { body: JSON.stringify({ message: 'Hello from Hakka' }) } : {}),
        })
        await response.text()
      }),
    )
  })

  const deadline = Date.now() + 5000
  while (
    Date.now() < deadline &&
    [...captured.values()].filter(
      (record) => record.responseBody != null && received.get(record.id)?.responseBody != null,
    ).length < 4
  ) {
    // Poll completed bridge deliveries before checking their bodies.
    // eslint-disable-next-line no-await-in-loop
    await delay(25)
  }
  const records = [...captured.values()].filter((record) => record.url.startsWith(baseUrl))
  assert.equal(records.length, 4, 'Expected four captured requests')
  for (const record of records) {
    const relayed = received.get(record.id)
    assert.ok(relayed, `Bridge did not relay ${record.url}`)
    assert.equal(relayed.status, record.status)
    assert.equal(relayed.responseBody, record.responseBody)
    assert.ok(relayed.responseBody, 'Response body was not delivered')
    assert.equal(relayed.correlationId, 'desktop-demo')
    assert.ok(!JSON.stringify(relayed).includes('desktop-demo-secret'), 'Credential leaked into bridge traffic')
  }
  assert.ok(
    records.some((record) => record.status === 503),
    'Missing error response',
  )
  console.log(`PASS: four requests captured, redacted, traced, and relayed through ${bridgeUrl}`)
  console.log(`In Hakka, open Live Traffic and search for ${baseUrl}. Inspect the POST body and 503 response.`)
  if (!process.argv.includes('--check')) {
    console.log(`API client URL: ${baseUrl}/json. Save a captured request to a collection and press Send.`)
    console.log('The local server stays running for replay. Press Ctrl-C to stop.')
    await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')])
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : `Cannot reach ${bridgeUrl}. Open Hakka for macOS first.`)
  process.exitCode = 1
} finally {
  capture?.stop()
  observer.close()
  if (server) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
