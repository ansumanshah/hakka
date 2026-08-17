import type { NetworkRequest } from 'hakka-core'
import { afterEach, describe, expect, it } from 'vitest'

import { captureInWorker, HAKKA_WORKER_MESSAGE } from '../workerCapture'

describe('captureInWorker', () => {
  const realWindow = (globalThis as Record<string, unknown>).window
  const realSelf = (globalThis as Record<string, unknown>).self
  const realFetch = globalThis.fetch
  let dispose: (() => void) | null = null

  afterEach(() => {
    dispose?.()
    dispose = null
    ;(globalThis as Record<string, unknown>).window = realWindow
    ;(globalThis as Record<string, unknown>).self = realSelf
    globalThis.fetch = realFetch
  })

  it('captures a worker fetch and posts it to the main thread', async () => {
    const posts: Array<Record<string, unknown>> = []
    // Simulate a Worker global scope: a postMessage and no `window`.
    ;(globalThis as Record<string, unknown>).window = undefined
    ;(globalThis as Record<string, unknown>).self = { postMessage: (m: Record<string, unknown>) => posts.push(m) }
    globalThis.fetch = (async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch

    dispose = captureInWorker()
    await fetch('https://api.test/worker-call')
    await new Promise((r) => setTimeout(r, 10))

    const rec = posts
      .map((p) => p[HAKKA_WORKER_MESSAGE] as NetworkRequest | undefined)
      .find((r) => r?.url === 'https://api.test/worker-call')
    expect(rec).toBeDefined()
    expect(rec?.source).toBe('fetch')
  })
})
