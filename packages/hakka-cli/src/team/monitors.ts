import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

import type { RunReport } from '../runCommand.js'
import type { TeamStore } from './store.js'

export type CollectionRunner = (
  snapshot: Record<string, string>,
  secrets: Record<string, string>,
  deadlineMs: number,
  signal: AbortSignal,
) => Promise<RunReport>

/** Durable scheduler: schedules are persisted; collection content is supplied from snapshots, never local paths. */
export class MonitorScheduler {
  private timer?: ReturnType<typeof setInterval>
  private readonly active = new Map<string, { controller: AbortController; job: Promise<void> }>()
  private tickJob?: Promise<void>
  constructor(
    private readonly store: TeamStore,
    private readonly runner: CollectionRunner,
    private readonly now = () => Date.now(),
  ) {}
  start(): void {
    this.timer ??= setInterval(() => void this.tick().catch(() => {}), 500)
    void this.tick().catch(() => {})
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const { controller } of this.active.values())
      controller.abort(new DOMException('scheduler stopped', 'AbortError'))
    await Promise.allSettled([...this.active.values()].map(({ job }) => job))
  }
  async tick(): Promise<void> {
    if (this.tickJob) return this.tickJob
    const job = Promise.allSettled(
      this.store
        .listMonitors()
        .filter((monitor) => monitor.enabled && !monitor.running && monitor.nextRunAt <= this.now())
        .map((monitor) => this.run(monitor.id)),
    ).then(() => undefined)
    this.tickJob = job
    try {
      await job
    } finally {
      if (this.tickJob === job) this.tickJob = undefined
    }
  }
  run(id: string): Promise<void> {
    const existing = this.active.get(id)
    if (existing) return existing.job
    const controller = new AbortController()
    const job = this.execute(id, controller.signal).finally(() => {
      if (this.active.get(id)?.job === job) this.active.delete(id)
    })
    this.active.set(id, { controller, job })
    return job
  }
  private async execute(id: string, shutdownSignal: AbortSignal): Promise<void> {
    const monitor = this.store.getMonitor(id)
    if (!monitor || monitor.running || !monitor.enabled) return
    const snapshot = monitor.pinnedFiles ?? this.store.getCollection(monitor.collectionId)?.files
    if (!snapshot) return
    const secrets = this.store.secrets(monitor.secretRefs)
    await this.store.setRunning(id, true)
    const startedAt = new Date(this.now()).toISOString()
    try {
      const deadlineMs = Math.min(monitor.intervalMs, 10 * 60_000)
      const signal = AbortSignal.any([shutdownSignal, AbortSignal.timeout(deadlineMs)])
      const report = await this.runner(snapshot, secrets, deadlineMs, signal)
      const outcome = report.failed ? 'failed' : 'passed'
      await this.store.appendRun({
        id: randomUUID(),
        monitorId: id,
        startedAt,
        completedAt: new Date(this.now()).toISOString(),
        outcome,
        summary: { passed: report.passed, failed: report.failed, durationMs: report.durationMs },
      })
      if (monitor.webhook)
        await notify(
          monitor.webhook,
          {
            monitorId: id,
            outcome,
            summary: { passed: report.passed, failed: report.failed, durationMs: report.durationMs },
          },
          signal,
        )
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? redact(error.message, secrets).replace(/(token|secret|password|authorization)[^\s]*/gi, '$1=[redacted]')
          : 'collection run failed'
      await this.store.appendRun({
        id: randomUUID(),
        monitorId: id,
        startedAt,
        completedAt: new Date(this.now()).toISOString(),
        outcome: 'error',
        summary: { passed: 0, failed: 1, durationMs: 0 },
        error: message,
      })
    } finally {
      await this.store.setRunning(id, false)
      const current = this.store.getMonitor(id)
      if (current) {
        current.nextRunAt = this.now() + current.intervalMs
        await this.store.putMonitor(current)
      }
    }
  }
}

function redact(message: string, secrets: Record<string, string>): string {
  let redacted = message
  for (const value of Object.values(secrets)) if (value) redacted = redacted.split(value).join('[redacted]')
  return redacted
}

async function notify(url: string, payload: unknown, parentSignal: AbortSignal): Promise<void> {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('webhook must be HTTP(S)')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Retries are deliberately sequential and stop after the first successful delivery.
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([parentSignal, AbortSignal.timeout(5_000)]),
      })
      if (response.ok) return
    } catch {}
    // Backoff must complete before the next delivery attempt.
    // eslint-disable-next-line no-await-in-loop
    await delay(50 * 2 ** attempt, undefined, { signal: parentSignal })
  }
  throw new Error('webhook delivery failed')
}
