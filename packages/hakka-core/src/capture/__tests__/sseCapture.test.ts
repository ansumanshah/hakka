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
  error: () => void
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
    error: () => ctrl.error(new Error('connection reset')),
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
  it('drains a never-ending stream only up to the tail ceiling, then cancels (pull-count pattern)', async () => {
    const MAX = 100
    const enc = new TextEncoder()
    const CHUNK = 'a'.repeat(64 * 1024) // 4MB past the cap is reached after ~64 pulls
    let pullCount = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount++
        controller.enqueue(enc.encode(CHUNK))
        // Never closes — a rogue infinite stream.
      },
      cancel() {
        cancelled = true
      },
    })

    const updates: SseCaptureUpdate[] = []
    await captureSseBody(new Response(stream), MAX, (u) => updates.push(u))

    expect(cancelled).toBe(true)
    // ~64 pulls cover the 4MB drain ceiling; anything near the unbounded stream's
    // total would mean capture forgot how to stop.
    expect(pullCount).toBeLessThan(100)

    const final = updates[updates.length - 1]
    expect(final?.done).toBe(true)
    expect(final?.truncated).toBe(true)
    // Prefix + tail window is the hard memory bound, whatever the stream's real size.
    expect(final?.text.length).toBeLessThanOrEqual(MAX + 8 * 1024 + 2)
    expect(final?.size).toBe(CHUNK.length * pullCount)
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

describe('captureSseBody — tail preservation past the cap (LLM usage arrives LAST)', () => {
  // A long token stream whose accounting rides in the FINAL events (the wire shape
  // every major LLM API uses) — the case a stop-dead-at-the-cap capture loses.
  const openAiEvent = (payload: string) => `data: ${payload}\n\n`
  const delta = (i: number, text: string) =>
    openAiEvent(
      `{"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"${text}"},"finish_reason":null}]}`,
    ) + `: ping ${i}\n\n` // a comment line — part of the wire format, zero data

  it('keeps the head prefix AND the final usage-bearing events when the cap is crossed mid-stream', async () => {
    const MAX = 300
    const enc = new TextEncoder()
    const usageEvent = openAiEvent('{"usage":{"prompt_tokens":25,"completion_tokens":180,"total_tokens":205}}')
    const doneEvent = 'data: [DONE]\n\n'
    // A middle event larger than the 8KB tail window, with a marker only at its start —
    // everything from the marker on is filler, so the marker's absence proves the middle
    // was dropped rather than merely trimmed.
    const middle = openAiEvent(
      '{"choices":[{"delta":{"content":"MIDDLE_DROPPED_MARKER' + 'm'.repeat(20 * 1024) + '"}}]}',
    )
    const full =
      delta(0, 'Hello') +
      delta(1, ' world') +
      middle +
      openAiEvent('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}') +
      usageEvent +
      doneEvent
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(full))
        controller.close()
      },
    })

    const updates: SseCaptureUpdate[] = []
    await captureSseBody(new Response(stream), MAX, (u) => updates.push(u))

    const final = updates[updates.length - 1]
    expect(final?.done).toBe(true)
    // Honest truncation — the middle WAS dropped, and the flag says so.
    expect(final?.truncated).toBe(true)
    expect(final?.text).toContain('"Hello"') // head prefix kept
    expect(final?.text).toContain('"total_tokens":205') // usage survives
    expect(final?.text).toContain('data: [DONE]') // terminal event survives
    expect(final?.text).toContain('"finish_reason":"stop"')
    expect(final?.text).not.toContain('MIDDLE_DROPPED_MARKER')
    // Exact decoded size even though the retained text is a head+tail projection.
    expect(final?.size).toBe(full.length)
    // Every emit, not just the terminal one, respects the prefix+tail memory bound.
    for (const u of updates) {
      expect(u.text.length).toBeLessThanOrEqual(MAX + 8 * 1024 + 2)
    }
  })

  it('joins prefix and tail on whole-event boundaries — no data line is a half-event', async () => {
    const MAX = 200
    const enc = new TextEncoder()
    const event = (n: number) => `data: {"n":${n},"pad":"${'x'.repeat(120)}"}\n\n`
    const COUNT = 120 // ~17KB of events — the 8KB tail window holds only the last few
    let full = ''
    for (let i = 0; i < COUNT; i++) full += event(i)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(full))
        controller.close()
      },
    })

    const updates: SseCaptureUpdate[] = []
    await captureSseBody(new Response(stream), MAX, (u) => updates.push(u))
    const final = updates[updates.length - 1]
    expect(final?.truncated).toBe(true)

    // Whatever survived the head+tail join must be WHOLE events: every data line in
    // the captured text parses as the JSON it was on the wire.
    const dataLines = final!.text.split('\n').filter((l) => l.startsWith('data: '))
    expect(dataLines.length).toBeGreaterThan(3)
    for (const line of dataLines) {
      expect(() => JSON.parse(line.slice('data: '.length))).not.toThrow()
    }
    // The tail window's events are the stream's LAST ones, not the first ones past the cap.
    expect(final?.text).toContain(`"n":${COUNT - 1}`)
    expect(final?.text).not.toContain(`"n":3`)
  })

  it('still ends with a single terminal emit when the stream errors mid-tail', async () => {
    const { stream, push, error } = controlledStream()
    const updates: SseCaptureUpdate[] = []
    const donePromise = captureSseBody(new Response(stream), 100, (u) => updates.push(u))

    push(`data: {"a":"${'x'.repeat(300)}"}\n\n`) // crosses the tiny cap
    await tick()
    push('data: {"usage":{"total_tokens":7}}\n\n')
    await tick()
    error()
    await donePromise

    expect(updates.filter((u) => u.done)).toHaveLength(1)
    const final = updates[updates.length - 1]
    expect(final?.truncated).toBe(true)
    expect(final?.text).toContain('"total_tokens":7')
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

  it("reading the capture branch past the cap (tail draining) never affects a sibling clone's own read", async () => {
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
