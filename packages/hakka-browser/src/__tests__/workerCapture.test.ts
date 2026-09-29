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

it('does not post a worker fetch that completes after capture teardown', async () => {
  const realWindow = window
  const realSelf = self
  const realFetch = fetch
  const posts: unknown[] = []
  let finish!: (response: Response) => void
  const response = new Promise<Response>((resolve) => {
    finish = resolve
  })
  ;(globalThis as Record<string, unknown>).window = undefined
  ;(globalThis as Record<string, unknown>).self = { postMessage: (m: unknown) => posts.push(m) }
  globalThis.fetch = (() => response) as typeof fetch
  const off = captureInWorker()
  try {
    const pending = fetch('https://api.test/late')
    off()
    finish(new Response('ok'))
    await pending
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(posts).toEqual([])
  } finally {
    off()
    ;(globalThis as Record<string, unknown>).window = realWindow
    ;(globalThis as Record<string, unknown>).self = realSelf
    globalThis.fetch = realFetch
  }
})
