/**
 * ThrottleEngine — simulates network conditions by wrapping the
 * Hakka-intercepted fetch with a delay + optional drop.
 */

export type ThrottleProfile = 'none' | 'fast-3g' | 'slow-3g' | 'offline' | 'edge' | 'custom'

export interface ThrottleConfig {
  profile: ThrottleProfile
  /** Additional latency added to every request (ms). 0 = no extra delay. */
  latencyMs?: number
  /** Simulated downstream bandwidth (kbps). 0 = unlimited. */
  downloadKbps?: number
}

/**
 * Preset profiles (latency ms, bandwidth kbps). Latency delays the request;
 * `downloadKbps` drips response bytes via `throttleResponse` on the fetch
 * path (XHR approximates the same timing with a completion-delay formula —
 * see capture/xhr.ts).
 */
const PRESETS: Record<Exclude<ThrottleProfile, 'custom' | 'none'>, { latencyMs: number; downloadKbps: number }> = {
  offline: { latencyMs: 0, downloadKbps: 0 },
  'slow-3g': { latencyMs: 400, downloadKbps: 400 },
  'fast-3g': { latencyMs: 150, downloadKbps: 1500 },
  edge: { latencyMs: 250, downloadKbps: 240 },
}

type ThrottleListener = (config: ThrottleConfig) => void

class ThrottleEngineImpl {
  private config: ThrottleConfig = { profile: 'none', latencyMs: 0, downloadKbps: 0 }
  private listeners: Set<ThrottleListener> = new Set()

  get current(): ThrottleConfig {
    return { ...this.config }
  }

  get isActive(): boolean {
    return this.config.profile !== 'none'
  }

  get isOffline(): boolean {
    return this.config.profile === 'offline'
  }

  setProfile(profile: ThrottleProfile): void {
    if (profile === 'none') {
      this.config = { profile: 'none', latencyMs: 0, downloadKbps: 0 }
    } else if (profile === 'custom') {
      this.config = { ...this.config, profile: 'custom' }
    } else {
      this.config = { profile, ...PRESETS[profile] }
    }
    this.notify()
  }

  setCustom(latencyMs: number, downloadKbps?: number): void {
    this.config = { profile: 'custom', latencyMs, downloadKbps: downloadKbps ?? 0 }
    this.notify()
  }

  /** Called by the fetch interceptor before sending — returns total delay to apply (ms). */
  async applyDelay(): Promise<void> {
    if (this.config.profile === 'none') return
    if (this.config.profile === 'offline') {
      throw new TypeError('Network request failed — offline mode (Hakka ThrottleEngine)')
    }
    const delay = this.config.latencyMs ?? 0
    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }
  }

  /**
   * Wrap a Response body in a ReadableStream that drips bytes at `downloadKbps`.
   * Returns the original Response when `downloadKbps <= 0` or there is no body.
   * Status, statusText, and headers are preserved.
   */
  throttleResponse(response: Response, downloadKbps: number): Response {
    if (downloadKbps <= 0 || !response.body) return response

    // bytes per millisecond at the given bandwidth
    const bytesPerMs = (downloadKbps * 1024) / 8 / 1000
    const CHUNK_SIZE = 1024 // ~1KB chunks

    const reader = response.body.getReader()

    const throttledBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }

        let offset = 0
        while (offset < value.byteLength) {
          const slice = value.subarray(offset, offset + CHUNK_SIZE)
          controller.enqueue(slice)
          offset += CHUNK_SIZE
          // Delay proportional to the bytes just enqueued
          const delayMs = slice.byteLength / bytesPerMs
          if (delayMs > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
          }
        }
      },
      cancel() {
        reader.cancel()
      },
    })

    return new Response(throttledBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  onChange(listener: ThrottleListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    const cfg = this.current
    for (const l of this.listeners) l(cfg)
  }
}

export const ThrottleEngine = new ThrottleEngineImpl()
