import { describe, it, expect } from 'bun:test'

import { captureSseBody, type SseCaptureUpdate } from '../sseCapture'

/** Let pending microtasks (a stream reader's internal promise chain) settle without a real timer. */
async function tick(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve()
  }
}

/** A ReadableStream whose chunks are pushed manually, mid-test, rather than enqueued upfront — lets a test observe behaviour WHILE the stream is still open. */
function controlledStream(): {
  stream: ReadableStream<Uint8Array>
  push: (text: string) => void
  close: () => void
} {
  const enc = new TextEncoder()
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller
    },
  })
  return {
    stream,
    push: (text: string) => ctrl.enqueue(enc.encode(text)),
    close: () => ctrl.close(),
  }
}

describe('captureSseBody — incremental emits while the stream is open', () => {
  it('emits a mid-stream (done: false) update once the 8KB cadence threshold is crossed, before the stream closes', async () => {
    const { stream, push, close } = controlledStream()
    const updates: SseCaptureUpdate[] = []
    let sawFirstUpdate: () => void
    const firstUpdate = new Promise<void>((resolve) => {
      sawFirstUpdate = resolve
    })

    const donePromise = captureSseBody(new Response(stream), 1_000_000, (u) => {
      updates.push(u)
      if (!u.done) sawFirstUpdate()
    })

    // Crosses the 8KB (8192 char) emit threshold in a single chunk — proves the
    // cadence gate fires on size, not just elapsed time.
    push('x'.repeat(9000))
    await firstUpdate

    expect(updates.length).toBeGreaterThanOrEqual(1)
    expect(updates[0]?.done).toBe(false)
    expect(updates[0]?.text.length).toBeGreaterThanOrEqual(9000)

    // The stream is still open — captureSseBody must not have resolved yet.
    let settled = false
    void donePromise.then(() => {
      settled = true
    })
    await tick()
    expect(settled).toBe(false)

    push('-tail')
    close()
    await donePromise

    const final = updates[updates.length - 1]
    expect(final?.done).toBe(true)
    expect(final?.text.endsWith('-tail')).toBe(true)
  })
})

describe('captureSseBody — cadence gate', () => {
  it('suppresses emits until a threshold is crossed, then flushes on close', async () => {
    const { stream, push, close } = controlledStream()
    const updates: SseCaptureUpdate[] = []
    const donePromise = captureSseBody(new Response(stream), 1_000_000, (u) => updates.push(u))

    // Three small pushes — 30 chars total, far under the 8KB threshold, driven purely by
    // microtask ticks (no real timer) so wall-clock time stays well under the 250ms interval.
    for (let i = 0; i < 3; i++) {
      push('a'.repeat(10))
      // eslint-disable-next-line no-await-in-loop
      await tick()
    }
    expect(updates).toHaveLength(0)

    close()
    await donePromise

    // Exactly the terminal emit — none of the three pushes crossed a
    // threshold on its own, so nothing fired until the stream closed.
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ done: true, text: 'a'.repeat(30), size: 30, truncated: false })
  })
})

describe('captureSseBody — terminal emit', () => {
  it('emits a terminal (done: true) update exactly once, on normal stream close', async () => {
    const { stream, push, close } = controlledStream()
    const updates: SseCaptureUpdate[] = []
    const donePromise = captureSseBody(new Response(stream), 1_000_000, (u) => updates.push(u))

    push('hello')
    close()
    await donePromise

    expect(updates.filter((u) => u.done)).toHaveLength(1)
    expect(updates[updates.length - 1]).toMatchObject({ done: true, text: 'hello', size: 5, truncated: false })
  })

  it('still emits a terminal update when the underlying reader errors mid-stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
        controller.error(new Error('connection reset'))
      },
    })
    const updates: SseCaptureUpdate[] = []

    // Fails open: a reader error must not reject captureSseBody's promise.
    await expect(captureSseBody(new Response(stream), 1_000_000, (u) => updates.push(u))).resolves.toBeUndefined()

    expect(updates.filter((u) => u.done)).toHaveLength(1)
    expect(updates[updates.length - 1]?.done).toBe(true)
  })

  it('a throwing onUpdate consumer does not break the read loop or the guaranteed terminal emit', async () => {
    const { stream, push, close } = controlledStream()
    let calls = 0
    push('a'.repeat(9000)) // crosses the 8KB threshold so a mid-stream emit is attempted
    close()

    await expect(
      captureSseBody(new Response(stream), 1_000_000, () => {
        calls++
        throw new Error('consumer bug')
      }),
    ).resolves.toBeUndefined()

    expect(calls).toBeGreaterThanOrEqual(1)
  })
})

describe('captureSseBody — cap discipline (mirrors readCappedBody.ts cancel-at-cap)', () => {
  it('cancels the stream instead of draining it once maxBodySize is crossed (pull-count pattern)', async () => {
    const MAX = 100
    const enc = new TextEncoder()
    const CHUNK = 'a'.repeat(50) // 2 pulls (100 chars) reaches the cap; a 3rd would cross it
    const TOTAL_AVAILABLE_CHUNKS = 1000
    let pullCount = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount++
        if (pullCount > TOTAL_AVAILABLE_CHUNKS) {
          controller.close()
          return
        }
        controller.enqueue(enc.encode(CHUNK))
      },
      cancel() {
        cancelled = true
      },
    })

    const updates: SseCaptureUpdate[] = []
    await captureSseBody(new Response(stream), MAX, (u) => updates.push(u))

    expect(cancelled).toBe(true)
    // Only a handful of pulls are needed to cross the cap — a count anywhere near TOTAL_AVAILABLE_CHUNKS would mean the stream was drained rather than cancelled.
    expect(pullCount).toBeLessThan(10)

    const final = updates[updates.length - 1]
    expect(final?.done).toBe(true)
    expect(final?.truncated).toBe(true)
    // Stops growing exactly at the cap — NOT nulled out the way a one-shot readCappedBody capture would be; the partial transcript is the point.
    expect(final?.text.length).toBe(MAX)
    expect(final?.size).toBeGreaterThanOrEqual(MAX)
  })

  it('keeps a body exactly at the cap without marking it truncated', async () => {
    const MAX = 10
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('e'.repeat(MAX)))
        controller.close()
      },
    })
    const updates: SseCaptureUpdate[] = []
    await captureSseBody(new Response(stream), MAX, (u) => updates.push(u))

    const final = updates[updates.length - 1]
    expect(final?.truncated).toBe(false)
    expect(final?.text).toBe('e'.repeat(MAX))
    expect(final?.size).toBe(MAX)
  })
})

describe('captureSseBody — tee independence', () => {
  it("reading (and potentially cancelling) the capture clone never affects a sibling clone's own read", async () => {
    const enc = new TextEncoder()
    const full = 'one-two-three-complete-sse-body'
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(full))
        controller.close()
      },
    })
    const response = new Response(stream)
    const appBranch = response.clone()

    await captureSseBody(response, 1_000_000, () => {})

    expect(await appBranch.text()).toBe(full)
  })

  it("cancelling the capture branch at the cap does not cancel the app's own branch", async () => {
    const MAX = 10
    const enc = new TextEncoder()
    const full = 'x'.repeat(50)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(full))
        controller.close()
      },
    })
    const response = new Response(stream)
    const appBranch = response.clone()

    await captureSseBody(response, MAX, () => {})

    expect(await appBranch.text()).toBe(full)
  })
})

describe('captureSseBody — runtimes with no readable body stream', () => {
  it('returns without emitting anything, rather than risking a leaked pending read', async () => {
    const res = new Response('irrelevant')
    Object.defineProperty(res, 'body', { get: () => null })

    const updates: SseCaptureUpdate[] = []
    await captureSseBody(res, 1_000_000, (u) => updates.push(u))

    expect(updates).toHaveLength(0)
  })
})
