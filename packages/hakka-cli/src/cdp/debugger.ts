import type { CdpTransport } from './types.js'

export interface ScriptSource {
  scriptId: string
  url: string
  source: string
}

export interface PausedLocation {
  callFrames: Array<{ functionName: string; url: string; lineNumber: number; columnNumber: number }>
}

const MAX_SCRIPTS = 2_000
const MAX_URL_LENGTH = 2_048
const MAX_FUNCTION_NAME_LENGTH = 256
const MAX_BREAKPOINT_LOCATIONS = 100

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new Uint8Array(maxBytes)
  const { written } = new TextEncoder().encodeInto(value, bytes)
  return new TextDecoder().decode(bytes.subarray(0, written))
}

/**
 * Explicitly attached Chromium Debugger-domain adapter. It deliberately has no
 * browser bridge fallback: a phone WebView needs its own remote-debugging
 * engine before source-level debugging is available.
 */
export class CdpDebugger {
  private readonly scripts = new Map<string, { url: string }>()
  private paused: PausedLocation | undefined
  private started = false

  constructor(private readonly transport: CdpTransport) {}

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.transport.on('Debugger.scriptParsed', (raw) => {
      const value = raw as { scriptId?: unknown; url?: unknown }
      if (typeof value.scriptId === 'string') {
        if (!this.scripts.has(value.scriptId) && this.scripts.size === MAX_SCRIPTS) {
          this.scripts.delete(this.scripts.keys().next().value!)
        }
        this.scripts.set(value.scriptId, {
          url: typeof value.url === 'string' ? value.url.slice(0, MAX_URL_LENGTH) : '',
        })
      }
    })
    this.transport.on('Debugger.paused', (raw) => {
      const value = raw as { callFrames?: unknown[] }
      const callFrames = (value.callFrames ?? []).slice(0, 30).flatMap((frame) => {
        const entry = frame as {
          functionName?: unknown
          location?: { scriptId?: unknown; lineNumber?: unknown; columnNumber?: unknown }
        }
        const location = entry.location
        if (!location || typeof location.scriptId !== 'string' || typeof location.lineNumber !== 'number') return []
        return [
          {
            functionName:
              typeof entry.functionName === 'string' ? entry.functionName.slice(0, MAX_FUNCTION_NAME_LENGTH) : '',
            url: this.scripts.get(location.scriptId)?.url ?? '',
            lineNumber: location.lineNumber,
            columnNumber: typeof location.columnNumber === 'number' ? location.columnNumber : 0,
          },
        ]
      })
      this.paused = { callFrames }
    })
    this.transport.on('Debugger.resumed', () => {
      this.paused = undefined
    })
    try {
      await this.transport.send('Debugger.enable')
    } catch (error) {
      this.started = false
      throw error
    }
  }

  listScripts(limit = 100): Array<{ scriptId: string; url: string }> {
    return [...this.scripts.entries()]
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map(([scriptId, script]) => ({ scriptId, url: script.url }))
  }

  async getScriptSource(scriptId: string, maxBytes = 100_000): Promise<ScriptSource> {
    const script = this.scripts.get(scriptId)
    if (!script) throw new Error(`Unknown script ${scriptId}`)
    const result = await this.transport.send<{ scriptSource?: unknown }>('Debugger.getScriptSource', { scriptId })
    const source =
      typeof result.scriptSource === 'string'
        ? truncateUtf8(result.scriptSource, Math.max(1, Math.min(maxBytes, 100_000)))
        : ''
    return { scriptId, url: script.url, source }
  }

  async setBreakpoint(
    scriptId: string,
    lineNumber: number,
    columnNumber = 0,
  ): Promise<{ breakpointId: string; locations: unknown[] }> {
    if (!this.scripts.has(scriptId)) throw new Error(`Unknown script ${scriptId}`)
    const result = await this.transport.send<{ breakpointId?: unknown; locations?: unknown[] }>(
      'Debugger.setBreakpoint',
      { location: { scriptId, lineNumber, columnNumber } },
    )
    if (typeof result.breakpointId !== 'string') throw new Error('Debugger did not return a breakpoint id')
    return {
      breakpointId: result.breakpointId,
      locations: Array.isArray(result.locations) ? result.locations.slice(0, MAX_BREAKPOINT_LOCATIONS) : [],
    }
  }

  removeBreakpoint(breakpointId: string): Promise<unknown> {
    return this.transport.send('Debugger.removeBreakpoint', { breakpointId })
  }
  getPaused(): PausedLocation | undefined {
    return this.paused
  }
  resume(): Promise<unknown> {
    return this.transport.send('Debugger.resume')
  }
  stepOver(): Promise<unknown> {
    return this.transport.send('Debugger.stepOver')
  }
  stepInto(): Promise<unknown> {
    return this.transport.send('Debugger.stepInto')
  }
  stepOut(): Promise<unknown> {
    return this.transport.send('Debugger.stepOut')
  }
}
