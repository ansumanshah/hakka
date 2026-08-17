import '../../src/bootstrap'
import { mockEngine } from 'hakka-core'
import { TurboModuleRegistry } from 'react-native'

describe('mockEngine', () => {
  beforeEach(() => {
    ;(TurboModuleRegistry.get as jest.Mock).mockReset()
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(null)
    mockEngine.clearRules()
  })

  afterEach(() => {
    mockEngine.clearRules()
    ;(TurboModuleRegistry.get as jest.Mock).mockReset()
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(null)
  })

  it('matches regex rules and preserves them through serialize/deserialize', () => {
    mockEngine.addRule({
      pattern: /\/api\/v\d+\/orders/i,
      response: { status: 202, headers: { 'x-mock': 'yes' }, body: 'accepted' },
      enabled: true,
    })

    const serialized = mockEngine.serialize()
    mockEngine.clearRules()
    mockEngine.deserialize(serialized)

    const match = mockEngine.match('https://example.com/api/v2/orders', 'GET')

    expect(match?.response.status).toBe(202)
    expect(match?.response.headers?.['x-mock']).toBe('yes')
    expect(match?.hitCount).toBe(1)
  })

  it('can toggle and remove rules by id', () => {
    const id = mockEngine.addRule({
      pattern: '/api/toggle',
      response: { status: 200, body: 'ok' },
      enabled: true,
    })

    mockEngine.disableRule(id)
    expect(mockEngine.match('https://example.com/api/toggle', 'GET')).toBeNull()

    mockEngine.enableRule(id)
    expect(mockEngine.match('https://example.com/api/toggle', 'GET')?.id).toBe(id)

    mockEngine.removeRule(id)
    expect(mockEngine.getRules()).toHaveLength(0)
  })

  it('mirrors rule changes into the native mock bridge when available', () => {
    const nativeModule = {
      addMockRule: jest.fn(),
      removeMockRule: jest.fn(),
      setMockRuleEnabled: jest.fn(),
    }
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(nativeModule)

    const id = mockEngine.addRule({
      pattern: /\/api\/users/i,
      method: 'GET',
      response: {
        status: 204,
        headers: { 'x-mock': 'yes' },
        body: { ok: true },
        delay: 25,
      },
      enabled: true,
    })

    expect(nativeModule.addMockRule).toHaveBeenCalledWith({
      id,
      pattern: '\\/api\\/users',
      isRegex: true,
      regexFlags: 'i',
      method: 'GET',
      status: 204,
      headers: { 'x-mock': 'yes' },
      body: '{"ok":true}',
      delayMs: 25,
      enabled: true,
    })

    mockEngine.disableRule(id)
    expect(nativeModule.setMockRuleEnabled).toHaveBeenCalledWith(id, false)

    mockEngine.enableRule(id)
    expect(nativeModule.setMockRuleEnabled).toHaveBeenCalledWith(id, true)

    mockEngine.removeRule(id)
    expect(nativeModule.removeMockRule).toHaveBeenCalledWith(id)
  })

  it('syncs existing rules when the native bridge appears after rule creation', () => {
    const id = mockEngine.addRule({
      pattern: '/api/later',
      response: { status: 200, body: 'ok' },
      enabled: true,
    })

    const nativeModule = {
      addMockRule: jest.fn(),
      removeMockRule: jest.fn(),
      setMockRuleEnabled: jest.fn(),
    }
    ;(TurboModuleRegistry.get as jest.Mock).mockReturnValue(nativeModule)

    mockEngine.syncNativeRules()

    expect(nativeModule.addMockRule).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        pattern: '/api/later',
        isRegex: false,
        status: 200,
        body: 'ok',
        enabled: true,
      }),
    )
  })
})
