/**
 * RequestStore — in-memory capped buffer of captured NetworkRequests. Wraps
 * the core RingBuffer to add automatic header redaction at ingest and the
 * filter/stats helpers used by MCP tools.
 */

import { RingBuffer, redactHeaderValues, redactHeaders } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

export interface StoreFilter {
  method?: string
  /** Minimum HTTP status (inclusive) */
  status?: number
  urlContains?: string
  /** 'client' | 'server' | 'edge' */
  runtime?: string
  errorOnly?: boolean
  limit?: number
}

export interface StoreStats {
  total: number
  pending: number
  success: number
  error: number
  errorRate: number
  avgDurationMs: number
  p95DurationMs: number
  slowest: NetworkRequest | null
  byHost: Record<string, number>
}

function redact(req: NetworkRequest): NetworkRequest {
  // Preserve `undefined` (no headers captured) — redactHeaders() would turn it into {}.
  return {
    ...req,
    requestHeaders: req.requestHeaders !== undefined ? redactHeaders(req.requestHeaders) : req.requestHeaders,
    responseHeaders: req.responseHeaders !== undefined ? redactHeaders(req.responseHeaders) : req.responseHeaders,
    // Additive sibling of responseHeaders (see NetworkRequest.responseHeaderValues) — must be
    // redacted the same way, or a sensitive name's real multi-value list (e.g. Set-Cookie)
    // would leak through here even though responseHeaders' single folded value is blanked.
    responseHeaderValues:
      req.responseHeaderValues !== undefined ? redactHeaderValues(req.responseHeaderValues) : req.responseHeaderValues,
  }
}

function extractHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export class RequestStore {
  private readonly buffer: RingBuffer
  private addListeners: Set<(req: NetworkRequest) => void> = new Set()

  constructor(capacity = 500) {
    this.buffer = new RingBuffer(capacity)
  }

  add(req: NetworkRequest): void {
    const redacted = redact(req)
    if (this.buffer.get(redacted.id)) {
      this.buffer.update(redacted)
    } else {
      this.buffer.add(redacted)
    }
    for (const listener of this.addListeners) {
      listener(redacted)
    }
  }

  /** Subscribe to every `add()` (new captures and in-place updates), fired after redact-and-store. Returns an unsubscribe function. */
  onAdd(listener: (req: NetworkRequest) => void): () => void {
    this.addListeners.add(listener)
    return () => {
      this.addListeners.delete(listener)
    }
  }

  get(id: string): NetworkRequest | undefined {
    return this.buffer.get(id)
  }

  getAll(filter?: StoreFilter): NetworkRequest[] {
    let requests = this.buffer.getAll()

    if (filter) {
      const { method, status, urlContains, runtime, errorOnly, limit } = filter

      if (method) {
        const m = method.toUpperCase()
        requests = requests.filter((r) => r.method.toUpperCase() === m)
      }
      if (status !== undefined) {
        requests = requests.filter((r) => (r.status ?? 0) >= status)
      }
      if (urlContains) {
        const needle = urlContains.toLowerCase()
        requests = requests.filter((r) => r.url.toLowerCase().includes(needle))
      }
      if (runtime) {
        requests = requests.filter((r) => r.runtime === runtime)
      }
      if (errorOnly) {
        requests = requests.filter((r) => Boolean(r.error) || (r.status != null && r.status >= 400))
      }
      if (limit !== undefined && limit > 0) {
        requests = requests.slice(0, limit)
      }
    }

    return requests
  }

  stats(): StoreStats {
    const all = this.buffer.getAll()
    const total = all.length
    let pending = 0
    let success = 0
    let error = 0
    let durationSum = 0
    let durationCount = 0
    const durations: number[] = []
    let slowest: NetworkRequest | null = null
    const byHost: Record<string, number> = {}

    for (const r of all) {
      if (r.duration == null && !r.error) {
        pending++
      } else if (r.error || (r.status != null && r.status >= 400)) {
        error++
      } else {
        success++
      }

      if (r.duration != null && r.duration > 0) {
        durationSum += r.duration
        durationCount++
        durations.push(r.duration)
        if (!slowest || r.duration > (slowest.duration ?? 0)) {
          slowest = r
        }
      }

      const host = extractHost(r.url)
      byHost[host] = (byHost[host] ?? 0) + 1
    }

    const avgDurationMs = durationCount > 0 ? durationSum / durationCount : 0

    let p95DurationMs = 0
    if (durations.length > 0) {
      durations.sort((a, b) => a - b)
      const p95Idx = Math.floor(durations.length * 0.95)
      p95DurationMs = durations[Math.min(p95Idx, durations.length - 1)] ?? 0
    }

    return {
      total,
      pending,
      success,
      error,
      errorRate: total > 0 ? error / total : 0,
      avgDurationMs,
      p95DurationMs,
      slowest,
      byHost,
    }
  }

  clear(): void {
    this.buffer.clear()
  }

  get size(): number {
    return this.buffer.size
  }
}
