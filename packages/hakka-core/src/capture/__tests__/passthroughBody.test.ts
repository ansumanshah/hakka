import { describe, it, expect } from 'bun:test'

import { capturePassthroughBody } from '../passthroughBody'
import type { CappedBody } from '../readCappedBody'

const MAX = 100

function capture(response: Response): { replacement: Response | null; done: Promise<CappedBody> } {
  let resolve!: (b: CappedBody) => void
  const done = new Promise<CappedBody>((r) => (resolve = r))
  return { replacement: capturePassthroughBody(response, MAX, resolve), done }
}

describe('capturePassthroughBody', () => {
  it('hands the app the full body and captures the same text', async () => {
    const { replacement, done } = capture(new Response('{"a":1}', { status: 201, headers: { 'x-k': 'v' } }))
    expect(replacement).not.toBeNull()
    expect(replacement!.status).toBe(201)
    expect(replacement!.headers.get('x-k')).toBe('v')
    expect(await replacement!.text()).toBe('{"a":1}')
    expect(await done).toEqual({ preview: '{"a":1}', size: 7, truncated: false })
  })

  it('captures a body the app never reads', async () => {
    const { done } = capture(new Response('unread'))
    expect((await done).preview).toBe('unread')
  })

  it('keeps the real url, redirected flag and type on the replacement', async () => {
    const original = new Response('x')
    Object.defineProperty(original, 'url', { value: 'https://api.example.com/final' })
    Object.defineProperty(original, 'redirected', { value: true })
    Object.defineProperty(original, 'type', { value: 'cors' })
    const { replacement } = capture(original)
    expect(replacement!.url).toBe('https://api.example.com/final')
    expect(replacement!.redirected).toBe(true)
    expect(replacement!.type).toBe('cors')
  })

  it('drops the preview over the cap but still delivers every byte to the app', async () => {
    const big = 'x'.repeat(250)
    const { replacement, done } = capture(new Response(big))
    expect((await replacement!.text()).length).toBe(250)
    const result = await done
    expect(result.preview).toBeNull()
    expect(result.truncated).toBe(true)
    expect(result.size).toBeGreaterThanOrEqual(250)
  })

  it('reassembles multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('héllo')
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 2))
        c.enqueue(bytes.slice(2))
        c.close()
      },
    })
    const { done } = capture(new Response(stream))
    expect((await done).preview).toBe('héllo')
  })

  it('declines responses it cannot safely rebuild, leaving the original body untouched', async () => {
    for (const response of [new Response(null, { status: 204 }), new Response(null, { status: 304 })]) {
      expect(capturePassthroughBody(response, MAX, () => {})).toBeNull()
    }
    const used = new Response('x')
    await used.text()
    expect(capturePassthroughBody(used, MAX, () => {})).toBeNull()
  })
})
