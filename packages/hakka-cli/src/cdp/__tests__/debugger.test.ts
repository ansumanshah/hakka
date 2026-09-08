import { describe, expect, test } from 'bun:test'

import { CdpDebugger } from '../debugger'

describe('CdpDebugger', () => {
  test('sets a breakpoint on a parsed Chromium script and tracks a pause', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const calls: string[] = []
    const transport = {
      on(event: string, listener: (value: unknown) => void) {
        listeners.set(event, listener)
      },
      async send(method: string) {
        calls.push(method)
        if (method === 'Debugger.setBreakpoint') return { breakpointId: 'bp-1', locations: [] }
        return {}
      },
    }
    const debuggerAdapter = new CdpDebugger(transport)
    await debuggerAdapter.start()
    listeners.get('Debugger.scriptParsed')?.({ scriptId: 'script-1', url: 'http://localhost/app.js' })
    const breakpoint = await debuggerAdapter.setBreakpoint('script-1', 4)
    listeners.get('Debugger.paused')?.({
      callFrames: [{ functionName: 'run', location: { scriptId: 'script-1', lineNumber: 4, columnNumber: 0 } }],
    })
    expect(calls).toEqual(['Debugger.enable', 'Debugger.setBreakpoint'])
    expect(breakpoint.breakpointId).toBe('bp-1')
    expect(debuggerAdapter.getPaused()?.callFrames[0]?.url).toBe('http://localhost/app.js')
  })

  test('starts once and bounds UTF-8 source bytes and breakpoint locations', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const calls: string[] = []
    const transport = {
      on(event: string, listener: (value: unknown) => void) {
        listeners.set(event, listener)
      },
      async send(method: string) {
        calls.push(method)
        if (method === 'Debugger.getScriptSource') return { scriptSource: '🙂abc' }
        if (method === 'Debugger.setBreakpoint') {
          return { breakpointId: 'bp-1', locations: Array.from({ length: 150 }, (_, index) => ({ index })) }
        }
        return {}
      },
    }
    const debuggerAdapter = new CdpDebugger(transport)
    await debuggerAdapter.start()
    await debuggerAdapter.start()
    listeners.get('Debugger.scriptParsed')?.({ scriptId: 'script-1', url: `http://localhost/${'x'.repeat(3000)}` })

    const source = await debuggerAdapter.getScriptSource('script-1', 5)
    const breakpoint = await debuggerAdapter.setBreakpoint('script-1', 0)

    expect(calls.filter((method) => method === 'Debugger.enable')).toHaveLength(1)
    expect(new TextEncoder().encode(source.source)).toHaveLength(5)
    expect(source.source).toBe('🙂a')
    expect(source.url.length).toBe(2_048)
    expect(breakpoint.locations).toHaveLength(100)
  })
})
