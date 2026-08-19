import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { checkCaptureSourceConformance, type CaptureSourceProbe } from '../../contract/conformance'
import { mockEngine } from '../../engine/MockEngine'
import type { NetworkRequest } from '../../model/types'
import { createFetchCaptureSource } from '../fetch'

/**
 * Deliberately a SEPARATE file from `fetchBasics.test.ts`/`fetchSafety.test.ts`/etc, not a
 * `describe` block appended to one of them — every one of those files patches
 * `globalThis.fetch` directly via `enableFetchInterceptor`'s own module-level "already patched"
 * guard, which would collide with a `CaptureSource`'s own `start()`/`stop()` cycle the same way
 * `websocketCaptureSource.test.ts`'s doc comment explains for the WebSocket source.
 */

const REAL_FETCH = globalThis.fetch

beforeEach(() => {
  mockEngine.clearRules()
})

afterEach(() => {
  mockEngine.clearRules()
  globalThis.fetch = REAL_FETCH
})

/**
 * Installs an underlying `fetch` that always REJECTS. Used for the conformance harness's
 * `triggerOnce()`: a genuine network-level rejection is fetch.ts's only path that emits
 * EXACTLY once per call (the outer `catch` at the bottom of `enableFetchInterceptor`, mirrored
 * by `fetchBasics.test.ts`'s "error capture" test) — a successful response would instead emit
 * TWICE for the same `id` (see the double-emission doc on `createFetchCaptureSource`), which
 * would make the harness's "second start() does not double-wire" check (exactly 1 emission per
 * `triggerOnce()`) fail for a reason that has nothing to do with wiring.
 */
function installFailingFetchGlobal(): void {
  globalThis.fetch = (async () => {
    throw new Error('conformance-network-failure')
  }) as typeof globalThis.fetch
}

function createFetchProbe(): CaptureSourceProbe {
  return {
    createSource() {
      installFailingFetchGlobal()
      return createFetchCaptureSource()
    },
    async triggerOnce() {
      try {
        await globalThis.fetch('https://api.example.com/conformance-ping')
      } catch {
        // expected — the installed fake always rejects; the interceptor's own
        // catch is what emits the one record this probe relies on.
      }
    },
  }
}

describe('createFetchCaptureSource — CaptureSource conformance', () => {
  test('all 7 lifecycle checks pass against the real wrapper', async () => {
    const report = await checkCaptureSourceConformance(createFetchProbe())
    expect(
      report.checks.map((c) => `${c.passed ? 'PASS' : 'FAIL'}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`),
    ).toEqual(report.checks.map((c) => `PASS: ${c.name}`))
    expect(report.passed).toBe(true)
  })

  test('identity and correlation match ADR 0006 row 1', () => {
    const source = createFetchCaptureSource()
    expect(source.id).toBe('hakka.fetch')
    expect(source.runtime).toBe('client')
    expect(source.transport).toBe('fetch')
    expect(source.correlation).toBe('originates')
  })
})

describe('createFetchCaptureSource — double-emission quirk (ADR 0006 row 1 note)', () => {
  test('a successful fetch reaches ctx.ingest TWICE for the same id: headers-only, then body-carrying', async () => {
    globalThis.fetch = (async () =>
      new Response('{"ok":true}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })) as typeof globalThis.fetch

    const records: NetworkRequest[] = []
    const source = createFetchCaptureSource()
    source.start({ ingest: (r) => records.push(r) })
    try {
      await globalThis.fetch('https://api.example.com/data', { method: 'POST' })

      // Wait for the detached background body-read to deliver the second ctx.ingest call.
      const deadline = Date.now() + 500
      while (records.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }

      expect(records).toHaveLength(2)
      expect(records[1]!.id).toBe(records[0]!.id)
      expect(records[0]!.responseBody).toBeNull()
      expect(records[1]!.responseBody).toBe('{"ok":true}')
    } finally {
      await source.stop()
    }
  })

  test('stop() between the two phases suppresses the second ctx.ingest call', async () => {
    let releaseBody: (() => void) | null = null
    const bodyGate = new Promise<void>((resolve) => {
      releaseBody = resolve
    })

    // A response whose body only becomes readable once the test releases the gate — puts a
    // real window between the headers-phase emission and the body-phase one, so stop() can
    // land inside it (mirrors the conformance harness's own "work in flight" check, but
    // against the wrapper's SECOND emission specifically rather than its first).
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await bodyGate
        controller.enqueue(new TextEncoder().encode('{"ok":true}'))
        controller.close()
      },
    })
    globalThis.fetch = (async () =>
      new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch

    const records: NetworkRequest[] = []
    const source = createFetchCaptureSource()
    source.start({ ingest: (r) => records.push(r) })

    await globalThis.fetch('https://api.example.com/slow-body')
    expect(records).toHaveLength(1) // headers-phase only — body hasn't resolved yet

    await source.stop()
    releaseBody?.()
    await new Promise((resolve) => setTimeout(resolve, 20)) // let the detached body-read settle

    expect(records).toHaveLength(1) // the body-phase emission must NOT have reached ctx.ingest
  })
})
