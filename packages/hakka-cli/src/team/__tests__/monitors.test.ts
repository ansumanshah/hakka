import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCollection } from '../../runCommand.js'
import type { RunReport } from '../../runCommand.js'
import { runTeamSnapshot } from '../execution.js'
import { MonitorScheduler } from '../monitors.js'
import { TeamStore } from '../store.js'

describe('durable scheduled monitors', () => {
  test('runs a persisted schedule once and posts a redacted aggregate webhook', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hakka-monitor-'))
    const received: unknown[] = []
    const webhook = Bun.serve({
      port: 0,
      fetch: async (request) => {
        received.push(await request.json())
        return new Response(null, { status: 204 })
      },
    })
    const store = new TeamStore(join(dir, 'state.json'))
    await store.open()
    await store.bootstrap('bootstrap')
    const target = Bun.serve({
      port: 0,
      fetch: () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
    })
    await store.putCollection(
      'demo',
      {
        'collection.hakka': '{"version":4,"id":"demo","name":"demo","defaultHeaders":[],"auth":{"none":{}}}',
        'request.hakka': JSON.stringify({
          seq: 0,
          spec: { id: 'r', name: 'request', method: 'GET', url: `http://127.0.0.1:${target.port}`, assertions: [] },
        }),
      },
      undefined,
      'bootstrap',
    )
    const monitor = await store.putMonitor({
      collectionId: 'demo',
      intervalMs: 1_000,
      enabled: true,
      webhook: `http://127.0.0.1:${webhook.port}`,
      secretRefs: ['TOKEN'],
    })
    const calls: Array<Record<string, string>> = []
    const runner = async (files: Record<string, string>, secrets: Record<string, string>) => {
      calls.push(secrets)
      const snapshot = await mkdtemp(join(tmpdir(), 'hakka-snapshot-'))
      try {
        await Promise.all(Object.entries(files).map(([file, contents]) => writeFile(join(snapshot, file), contents)))
        return await runCollection(snapshot, { environment: secrets })
      } finally {
        await rm(snapshot, { recursive: true, force: true })
      }
    }
    const scheduler = new MonitorScheduler(store, runner)
    await scheduler.run(monitor.id)
    await Bun.sleep(25)
    const recovered = new TeamStore(join(dir, 'state.json'))
    await recovered.open()
    expect(calls).toEqual([{}])
    expect(recovered.runs(monitor.id)[0]?.outcome).toBe('passed')
    expect(recovered.runs(monitor.id)).toHaveLength(1)
    expect(received).toEqual([
      { monitorId: monitor.id, outcome: 'passed', summary: expect.objectContaining({ passed: 1, failed: 0 }) },
    ])
    target.stop()
    webhook.stop()
    await rm(dir, { recursive: true, force: true })
  })

  test('recovers a persisted in-progress monitor as immediately due after restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hakka-monitor-restart-'))
    const path = join(dir, 'state.json')
    const store = new TeamStore(path)
    await store.open()
    const monitor = await store.putMonitor({
      collectionId: 'demo',
      intervalMs: 60_000,
      enabled: true,
      secretRefs: [],
      running: true,
      nextRunAt: Date.now() + 60_000,
    })
    const restartedAt = Date.now()
    const recovered = new TeamStore(path)
    await recovered.open()
    expect(recovered.getMonitor(monitor.id)?.running).toBe(false)
    expect(recovered.getMonitor(monitor.id)?.nextRunAt).toBeLessThanOrEqual(Date.now())
    expect(recovered.getMonitor(monitor.id)?.nextRunAt).toBeGreaterThanOrEqual(restartedAt)
    await rm(dir, { recursive: true, force: true })
  })

  test('coalesces overlapping ticks into one monitor run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hakka-monitor-overlap-'))
    const store = await dueStore(dir)
    let calls = 0
    let release!: () => void
    const waiting = new Promise<void>((resolve) => (release = resolve))
    const scheduler = new MonitorScheduler(store, async () => {
      calls++
      await waiting
      return report()
    })
    const first = scheduler.tick()
    await Bun.sleep(10)
    const second = scheduler.tick()
    release()
    await Promise.all([first, second])
    expect(calls).toBe(1)
    await rm(dir, { recursive: true, force: true })
  })

  test('stop aborts and awaits an active run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hakka-monitor-stop-'))
    const store = await dueStore(dir)
    let aborted = false
    const scheduler = new MonitorScheduler(store, async (_files, _secrets, _deadline, signal) => {
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(signal.reason)
          },
          { once: true },
        ),
      )
      return report()
    })
    const running = scheduler.tick()
    await Bun.sleep(10)
    await scheduler.stop()
    await running
    expect(aborted).toBe(true)
    expect(store.listMonitors()[0]?.running).toBe(false)
    await rm(dir, { recursive: true, force: true })
  })

  test('applies a finite deadline to the entire monitor runner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hakka-monitor-deadline-'))
    const store = await dueStore(dir, 1_000)
    let deadline = 0
    const scheduler = new MonitorScheduler(store, async (_files, _secrets, deadlineMs, signal) => {
      deadline = deadlineMs
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      )
      return report()
    })
    await scheduler.tick()
    expect(deadline).toBe(1_000)
    expect(store.runs(store.listMonitors()[0]!.id)[0]?.outcome).toBe('error')
    await rm(dir, { recursive: true, force: true })
  })

  test('redacts configured secret values from stored runner errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hakka-monitor-redaction-'))
    const store = new TeamStore(join(dir, 'state.json'))
    await store.open()
    await store.putCollection('demo', { 'collection.hakka': '{}' }, undefined, 'bootstrap')
    await store.putSecret('API_TOKEN', 'monitor-secret-value')
    const monitor = await store.putMonitor({
      collectionId: 'demo',
      intervalMs: 60_000,
      enabled: true,
      secretRefs: ['API_TOKEN'],
      nextRunAt: 0,
    })
    const scheduler = new MonitorScheduler(store, async () => {
      throw new Error('request failed with monitor-secret-value')
    })
    await scheduler.tick()
    expect(store.runs(monitor.id)[0]?.error).toBe('request failed with [redacted]')
    await rm(dir, { recursive: true, force: true })
  })

  test('remote snapshot execution rejects request hooks before network execution', async () => {
    const files = {
      'collection.hakka': JSON.stringify({ version: 4, id: 'demo', name: 'demo', auth: { none: {} } }),
      'request.hakka': JSON.stringify({
        seq: 0,
        spec: {
          id: 'r',
          name: 'request',
          method: 'GET',
          url: 'http://127.0.0.1:1',
          scripts: { preRequestLines: ['vars.set("x", "1")'] },
        },
      }),
    }
    await expect(runTeamSnapshot(files, {}, 1_000, new AbortController().signal)).rejects.toThrow(
      'scripts, which are disabled',
    )
  })
})

async function dueStore(dir: string, intervalMs = 60_000): Promise<TeamStore> {
  const store = new TeamStore(join(dir, 'state.json'))
  await store.open()
  await store.putCollection('demo', { 'collection.hakka': '{}' }, undefined, 'bootstrap')
  await store.putMonitor({
    collectionId: 'demo',
    intervalMs,
    enabled: true,
    secretRefs: [],
    nextRunAt: 0,
  })
  return store
}

function report(): RunReport {
  return {
    collection: 'demo',
    startedAt: new Date().toISOString(),
    durationMs: 1,
    iterations: 1,
    passed: 1,
    failed: 0,
    items: [],
  }
}
