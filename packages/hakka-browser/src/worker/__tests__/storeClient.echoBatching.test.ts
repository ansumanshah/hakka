/**
 * storeClient — live request echoes reach subscribers in per-frame batches (leading edge
 * immediate, trailing edge held), so a burst shares one list recompute.
 */
import type { NetworkRequest } from 'hakka-core'
import { describe, expect, it, vi } from 'vitest'

import type { MainToWorker } from '../protocol'
import { createWorkerClient } from '../storeClient'

class FakeWorker {
  posted: MainToWorker[] = []
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null
  postMessage(msg: MainToWorker): void {
    this.posted.push(msg)
  }
  terminate(): void {}
}

const req = (id: string) => ({ id, url: 'https://api.example.com/users', method: 'GET' }) as NetworkRequest

const echo = (worker: FakeWorker, id: string) =>
  worker.onmessage!(new MessageEvent('message', { data: { type: 'request', req: req(id) } }))

describe('createWorkerClient — live echo batching', () => {
  it('delivers a lone echo immediately and holds a burst to flush as one batch', () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const client = createWorkerClient(worker as unknown as Worker, {})
      const seen: string[] = []
      client.subscribe((r) => seen.push(r.id))
      vi.advanceTimersByTime(100)
      echo(worker, 'a')
      expect(seen).toEqual(['a'])
      for (const id of ['b', 'c', 'd']) echo(worker, id)
      expect(seen).toEqual(['a'])
      vi.advanceTimersByTime(20)
      expect(seen).toEqual(['a', 'b', 'c', 'd'])
      client.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops echoes still waiting when the store is cleared or destroyed', () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const client = createWorkerClient(worker as unknown as Worker, {})
      const seen: string[] = []
      client.subscribe((r) => seen.push(r.id))
      vi.advanceTimersByTime(100)
      echo(worker, 'first')
      echo(worker, 'stale')
      worker.onmessage!(new MessageEvent('message', { data: { type: 'cleared' } }))
      echo(worker, 'fresh')
      client.destroy()
      vi.advanceTimersByTime(50)
      expect(seen).toEqual(['first'])
    } finally {
      vi.useRealTimers()
    }
  })
})
