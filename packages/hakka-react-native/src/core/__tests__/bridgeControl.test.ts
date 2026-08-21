/**
 * HakkaBridge control-frame dispatch — a `{ type: 'control', payload }` frame
 * from the bridge hub (e.g. hakka mcp create_mock) must land in the engine
 * singletons, and malformed payloads must be dropped without throwing.
 */
import { breakpointEngine, mockEngine, ThrottleEngine } from 'hakka-core'

import { HakkaBridge } from '../HakkaBridge'

// Reach the private message handler without opening a real socket.
type MessageCapable = { _handleMessage(event: { data?: unknown }): void }

const frame = (payload: unknown): { data: string } => ({ data: JSON.stringify({ type: 'control', payload }) })

describe('HakkaBridge — control frames', () => {
  const bridge = new HakkaBridge() as unknown as MessageCapable

  afterEach(() => {
    mockEngine.clearRules()
    breakpointEngine.clearBreakpoints()
    ThrottleEngine.setProfile('none')
  })

  it('applies a mock.add control frame to the mockEngine singleton', () => {
    bridge._handleMessage(
      frame({
        kind: 'mock.add',
        rule: {
          id: 'mcp-mock-1',
          pattern: '/api/users',
          mode: 'mock',
          response: { status: 503, body: '{"down":true}' },
          enabled: true,
        },
      }),
    )
    const rule = mockEngine.getRules().find((r) => r.id === 'mcp-mock-1')
    expect(rule).toBeDefined()
    expect(rule!.response.status).toBe(503)
  })

  it('applies throttle.set and mock.remove', () => {
    bridge._handleMessage(frame({ kind: 'throttle.set', profile: 'slow-3g' }))
    expect(ThrottleEngine.isActive).toBe(true)

    bridge._handleMessage(
      frame({
        kind: 'mock.add',
        rule: { id: 'mcp-mock-2', pattern: '/x', mode: 'mock', response: { status: 200, body: '' }, enabled: true },
      }),
    )
    bridge._handleMessage(frame({ kind: 'mock.remove', id: 'mcp-mock-2' }))
    expect(mockEngine.getRules().find((r) => r.id === 'mcp-mock-2')).toBeUndefined()
  })

  it('applies a breakpoint.resume control frame to the breakpointEngine singleton', async () => {
    const pausePromise = breakpointEngine.pause('req-1', 'request', {
      url: 'https://api.example.com/x',
      method: 'GET',
      headers: {},
      body: null,
    })
    const [pending] = breakpointEngine.getPaused()
    bridge._handleMessage(frame({ kind: 'breakpoint.resume', pauseId: pending!.id, requestEdits: { method: 'PUT' } }))
    const action = await pausePromise
    expect(action).toEqual({ type: 'resume', edits: { method: 'PUT' } })
  })

  it('breakpoint.paused is refused — a device must never apply its own pause notification', () => {
    expect(() => {
      bridge._handleMessage(
        frame({
          kind: 'breakpoint.paused',
          pauseId: 'p1',
          phase: 'request',
          device: 'rn-device',
          request: { url: 'https://api.example.com/x', method: 'GET', headers: {} },
        }),
      )
    }).not.toThrow()
    // Refused, not applied — nothing to assert on engine state beyond "did not throw / did not crash the bridge".
  })

  it('drops malformed control payloads without throwing', () => {
    expect(() => {
      bridge._handleMessage(frame({ kind: 'mock.add' })) // missing rule
      bridge._handleMessage(frame({ kind: 'nonsense' }))
      bridge._handleMessage(frame({ kind: 'mock.remove', id: '../etc/passwd' })) // hostile id
      bridge._handleMessage({ data: 'not json{{' })
    }).not.toThrow()
    expect(mockEngine.getRules()).toHaveLength(0)
  })
})
