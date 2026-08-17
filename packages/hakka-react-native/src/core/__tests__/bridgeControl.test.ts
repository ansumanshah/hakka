/**
 * HakkaBridge control-frame dispatch — a `{ type: 'control', payload }` frame
 * from the bridge hub (e.g. hakka mcp create_mock) must land in the engine
 * singletons, and malformed payloads must be dropped without throwing.
 */
import { mockEngine, ThrottleEngine } from 'hakka-core'

import { HakkaBridge } from '../HakkaBridge'

// Reach the private message handler without opening a real socket.
type MessageCapable = { _handleMessage(event: { data?: unknown }): void }

const frame = (payload: unknown): { data: string } => ({ data: JSON.stringify({ type: 'control', payload }) })

describe('HakkaBridge — control frames', () => {
  const bridge = new HakkaBridge() as unknown as MessageCapable

  afterEach(() => {
    mockEngine.clearRules()
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
