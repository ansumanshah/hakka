import { describe, it, expect } from 'bun:test'

import { readCappedBody } from '../readCappedBody'

const MAX = 100

/** A Response whose body streams `chunks` (as separate reads) via a real ReadableStream. */
function streamingResponse(chunks: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/plain' } })
}

/** A Response with no readable `body` stream — mirrors runtimes like some RN fetch impls. */
function streamlessResponse(body: string): Response {
  const res = new Response(body)
  Object.defineProperty(res, 'body', { get: () => null })
  return res
}

describe('readCappedBody', () => {
  it('returns the full body when under the cap', async () => {
    const { preview, size, truncated } = await readCappedBody(new Response('hello'), MAX)
    expect(preview).toBe('hello')
    expect(size).toBe(5)
    expect(truncated).toBe(false)
  })

  it('drops the body and reports a best-known (>= cap) size when over the cap', async () => {
    const big = 'x'.repeat(200)
    const { preview, size, truncated } = await readCappedBody(new Response(big), MAX)
    expect(preview).toBeNull()
    // Best-known, not necessarily exact — the stream is cancelled at the cap instead of decoding the rest just to measure it.
    expect(size).toBeGreaterThanOrEqual(MAX)
    expect(truncated).toBe(true)
  })

  it('reports the exact size when over the cap and Content-Length is present', async () => {
    const big = 'x'.repeat(200)
    const res = new Response(big, { headers: { 'content-length': '200' } })
    const { preview, size, truncated } = await readCappedBody(res, MAX)
    expect(preview).toBeNull()
    expect(size).toBe(200) // exact — taken from Content-Length, not the partial decode
    expect(truncated).toBe(true)
  })

  it('ignores Content-Length on an encoded body — it counts wire bytes, not decoded text', async () => {
    // A gzip response's Content-Length is the COMPRESSED size; trusting it would report a size smaller than what was decoded. Must fall back to the decoded-so-far lower bound.
    const big = 'x'.repeat(200)
    const res = new Response(big, {
      headers: { 'content-length': '40', 'content-encoding': 'gzip' },
    })
    const { preview, size, truncated } = await readCappedBody(res, MAX)
    expect(preview).toBeNull()
    expect(truncated).toBe(true)
    expect(size).toBeGreaterThanOrEqual(MAX) // decoded lower bound, not the header's 40
  })

  it('never reports below the decoded count even when identity Content-Length is smaller', async () => {
    // Defensive: a lying/stale header must not shrink the size below what was provably decoded.
    // CL=150 is over the cap (stream path, not text() fast path) but under the real 200.
    const big = 'x'.repeat(200)
    const res = new Response(big, { headers: { 'content-length': '150' } })
    const { size, truncated } = await readCappedBody(res, MAX)
    expect(truncated).toBe(true)
    expect(size).toBeGreaterThanOrEqual(150)
  })

  it('keeps a body exactly at the cap, drops one char over', async () => {
    const at = await readCappedBody(new Response('e'.repeat(MAX)), MAX)
    expect(at.preview).toBe('e'.repeat(MAX))
    expect(at.size).toBe(MAX)
    expect(at.truncated).toBe(false)

    const over = await readCappedBody(new Response('f'.repeat(MAX + 1)), MAX)
    expect(over.preview).toBeNull()
    expect(over.size).toBeGreaterThanOrEqual(MAX)
    expect(over.truncated).toBe(true)
  })

  it('sums size across multiple stream chunks', async () => {
    // 60 + 41 = 101, delivered in two reads → over cap. Size happens to be exact here, but the contract only guarantees >= cap.
    const { preview, size, truncated } = await readCappedBody(streamingResponse(['a'.repeat(60), 'b'.repeat(41)]), MAX)
    expect(preview).toBeNull()
    expect(size).toBe(101)
    expect(truncated).toBe(true)
  })

  it('retains a multi-chunk body that lands exactly on the cap', async () => {
    const { preview, size, truncated } = await readCappedBody(streamingResponse(['a'.repeat(60), 'b'.repeat(40)]), MAX)
    expect(size).toBe(100)
    expect(preview).toBe('a'.repeat(60) + 'b'.repeat(40))
    expect(truncated).toBe(false)
  })

  it('decodes multi-byte characters split across chunk boundaries', async () => {
    // '€' is 3 UTF-8 bytes; split across two reads to exercise the streaming decoder.
    const enc = new TextEncoder()
    const euro = enc.encode('€') // [0xE2, 0x82, 0xAC]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(euro.slice(0, 2))
        controller.enqueue(euro.slice(2))
        controller.close()
      },
    })
    const { preview, size, truncated } = await readCappedBody(new Response(stream), MAX)
    expect(preview).toBe('€')
    expect(size).toBe(1)
    expect(truncated).toBe(false)
  })

  it('falls back to text() when the runtime exposes no body stream', async () => {
    const { preview, size, truncated } = await readCappedBody(streamlessResponse('no-stream-here'), MAX)
    expect(preview).toBe('no-stream-here')
    expect(size).toBe(14)
    expect(truncated).toBe(false)
  })

  it('takes the native text() path when identity Content-Length fits the cap', async () => {
    // Booby-trap `.body` — the fast path must never touch the public stream API (`.text()` bypasses this getter internally).
    const res = new Response('hello', { headers: { 'content-length': '5' } })
    Object.defineProperty(res, 'body', {
      get() {
        throw new Error('fast path must not read response.body')
      },
    })
    const { preview, size, truncated } = await readCappedBody(res, MAX)
    expect(preview).toBe('hello')
    expect(size).toBe(5)
    expect(truncated).toBe(false)
  })

  it('does NOT fast-path an encoded body even when Content-Length fits the cap', async () => {
    // gzip Content-Length counts compressed wire bytes — it cannot bound the decoded size, so this must go through the capped stream reader.
    const enc = new TextEncoder()
    let pulled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true
        controller.enqueue(enc.encode('hi'))
        controller.close()
      },
    })
    const res = new Response(stream, {
      headers: { 'content-length': '2', 'content-encoding': 'gzip' },
    })
    const { preview, truncated } = await readCappedBody(res, MAX)
    expect(pulled).toBe(true) // stream path, not text()
    expect(preview).toBe('hi')
    expect(truncated).toBe(false)
  })

  it('fast path still drops the preview if the actual text exceeds the cap despite the header', async () => {
    // A stubbed response can declare a Content-Length smaller than reality — the preview contract ("full text or null") must hold on the decoded truth, not the header.
    const res = new Response('y'.repeat(MAX + 50), { headers: { 'content-length': '5' } })
    const { preview, size, truncated } = await readCappedBody(res, MAX)
    expect(preview).toBeNull()
    expect(size).toBe(MAX + 50)
    expect(truncated).toBe(false) // read to completion — size is exact, nothing was cut short
  })

  it('cancels the stream instead of draining it once the cap is crossed', async () => {
    // A pull-based (lazy) source — chunks are only produced as the reader asks for them, so this proves whether readCappedBody actually stops asking once it should.
    const enc = new TextEncoder()
    const CHUNK = 'a'.repeat(50) // 3 chunks (150 chars) is enough to cross MAX=100
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

    const { preview, truncated } = await readCappedBody(new Response(stream), MAX)

    expect(preview).toBeNull()
    expect(truncated).toBe(true)
    expect(cancelled).toBe(true)
    // Only 3 pulls are needed to cross the cap — a count anywhere near TOTAL_AVAILABLE_CHUNKS would mean the stream was drained rather than cancelled.
    expect(pullCount).toBeLessThan(10)
  })
})
