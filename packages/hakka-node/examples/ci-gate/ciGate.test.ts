/**
 * Worked example: network capture as a CI gate, wired into a real test run.
 *
 * `bun test packages/hakka-node/examples/ci-gate/ciGate.test.ts`
 *
 * Run 1 hits the app's baseline shape and passes. Run 2 simulates an
 * unreviewed change (`POST /orders` starts sending a `discountCode` field it
 * never sent before) and demonstrates the FAIL report — exactly the
 * regression this feature exists to catch, verbatim from the repo prompt:
 * "fail the build when the app starts sending a field it never sent before."
 *
 * A real CI job would do this as two separate steps instead of one test
 * file — see README.md for the `hakka ci-baseline record|check` CLI form,
 * which is what a build script actually calls. This test exercises the same
 * underlying functions directly so it can assert on the exact findings.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'

import {
  diffBaseline,
  normalizeRequestsForBaseline,
  parseBaseline,
  serializeBaseline,
  startCiCapture,
} from '../../src/ci/index'
import { stopCapture } from '../../src/serverCapture'
import { createServer, listen } from './server.mjs'

afterEach(() => stopCapture())

/** Exercise the two endpoints the example app under test exposes. */
async function exerciseApp(port: number): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/users/42`)
  await fetch(`http://127.0.0.1:${port}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: 'widget', quantity: 3 }),
  })
}

describe('CI gate worked example', () => {
  test('record then check: a clean second run passes', async () => {
    const server1: Server = createServer()
    const port1 = await listen(server1)
    const capture1 = startCiCapture({ captureHttp: false })
    await exerciseApp(port1)
    const run1 = capture1.stop()
    server1.close()

    const baseline = serializeBaseline(normalizeRequestsForBaseline(run1))

    // A second, independent run against the SAME (unchanged) app.
    const server2: Server = createServer()
    const port2 = await listen(server2)
    const capture2 = startCiCapture({ captureHttp: false })
    await exerciseApp(port2)
    const run2 = capture2.stop()
    server2.close()

    const findings = diffBaseline(parseBaseline(baseline).endpoints, normalizeRequestsForBaseline(run2))
    expect(findings).toEqual([])
  })

  test('record then check: a new request-body field fails the build', async () => {
    const server1: Server = createServer()
    const port1 = await listen(server1)
    const capture1 = startCiCapture({ captureHttp: false })
    await exerciseApp(port1)
    const run1 = capture1.stop()
    server1.close()
    const baseline = serializeBaseline(normalizeRequestsForBaseline(run1))

    // A second run where the client now sends a field it never sent before —
    // the exact scenario requirement #4 in the repo prompt targets.
    const server2: Server = createServer()
    const port2 = await listen(server2)
    const capture2 = startCiCapture({ captureHttp: false })
    await fetch(`http://127.0.0.1:${port2}/users/42`)
    await fetch(`http://127.0.0.1:${port2}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'widget', quantity: 3, promoCode: 'unreviewed' }),
    })
    const run2 = capture2.stop()
    server2.close()

    const findings = diffBaseline(parseBaseline(baseline).endpoints, normalizeRequestsForBaseline(run2))
    const failFindings = findings.filter((f) => f.severity === 'fail')
    expect(failFindings).toHaveLength(1)
    expect(failFindings[0]).toMatchObject({ kind: 'body-shape-changed' })
    expect(failFindings[0]!.message).toContain('POST 127.0.0.1/orders')
  })
})
