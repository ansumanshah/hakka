import { describe, expect, test } from 'bun:test'

import {
  BRIDGE_MDNS_SERVICE_NAME,
  hasNonLoopbackInterface,
  startBridgeAdvertise,
  type BridgeMdnsPublisher,
  type BridgeMdnsService,
} from '../discovery'

/**
 * Never touches a real socket — `bonjour-service`'s `Bonjour`/`Service` are
 * faked via `createPublisher`, and `os.networkInterfaces()` via
 * `networkInterfaces`. Real mDNS (multicast, OS resolution) is flaky in CI
 * (often no LAN interface, or multicast blocked), so this verifies only the
 * deterministic parts: service config shape and start/stop/goodbye wiring.
 */

const LAN_INTERFACES = {
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as const],
  en0: [{ address: '192.168.1.42', family: 'IPv4', internal: false } as const],
}

const LOOPBACK_ONLY_INTERFACES = {
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as const],
}

function fakePublisher(): {
  publisher: BridgeMdnsPublisher
  publishCalls: unknown[]
  stopped: boolean[]
  destroyed: boolean[]
} {
  const publishCalls: unknown[] = []
  const stopped: boolean[] = []
  const destroyed: boolean[] = []
  const service: BridgeMdnsService = {
    stop: (callback) => {
      stopped.push(true)
      callback?.()
    },
  }
  const publisher: BridgeMdnsPublisher = {
    publish: (options) => {
      publishCalls.push(options)
      return service
    },
    destroy: () => {
      destroyed.push(true)
    },
  }
  return { publisher, publishCalls, stopped, destroyed }
}

describe('hasNonLoopbackInterface', () => {
  test('true when a non-internal IPv4 interface exists', () => {
    expect(hasNonLoopbackInterface(LAN_INTERFACES)).toBe(true)
  })

  test('false when only loopback interfaces exist', () => {
    expect(hasNonLoopbackInterface(LOOPBACK_ONLY_INTERFACES)).toBe(false)
  })

  test('false for an empty interface map', () => {
    expect(hasNonLoopbackInterface({})).toBe(false)
  })
})

describe('startBridgeAdvertise — service config', () => {
  test('publishes with the _hakka._tcp service name, tcp protocol, and given port', () => {
    const { publisher, publishCalls } = fakePublisher()
    const advertisement = startBridgeAdvertise({
      port: 8989,
      name: 'Ansh-MacBook',
      createPublisher: () => publisher,
      networkInterfaces: () => LAN_INTERFACES,
    })

    expect(advertisement.active).toBe(true)
    expect(publishCalls).toEqual([
      { name: 'Ansh-MacBook', type: BRIDGE_MDNS_SERVICE_NAME, protocol: 'tcp', port: 8989 },
    ])
  })

  test('defaults the advertised name to the machine hostname when unset', () => {
    const { publisher, publishCalls } = fakePublisher()
    startBridgeAdvertise({ port: 8989, createPublisher: () => publisher, networkInterfaces: () => LAN_INTERFACES })

    const [call] = publishCalls as Array<{ name: string }>
    expect(typeof call.name).toBe('string')
    expect(call.name.length).toBeGreaterThan(0)
  })

  test('passes a specific bind host through to the publisher as `host`', () => {
    const { publisher, publishCalls } = fakePublisher()
    startBridgeAdvertise({
      port: 8989,
      host: '192.168.1.42',
      createPublisher: () => publisher,
      networkInterfaces: () => LAN_INTERFACES,
    })

    expect(publishCalls).toEqual([
      { name: expect.any(String), type: BRIDGE_MDNS_SERVICE_NAME, protocol: 'tcp', port: 8989, host: '192.168.1.42' },
    ])
  })

  test('omits `host` from the publish config when unset, leaving bonjour-service its default', () => {
    const { publisher, publishCalls } = fakePublisher()
    startBridgeAdvertise({ port: 8989, createPublisher: () => publisher, networkInterfaces: () => LAN_INTERFACES })

    const [call] = publishCalls as Array<Record<string, unknown>>
    expect('host' in call).toBe(false)
  })
})

describe('startBridgeAdvertise — opt-out and no-LAN gating', () => {
  test('does not construct a publisher when disabled', () => {
    let constructed = false
    const advertisement = startBridgeAdvertise({
      port: 8989,
      disabled: true,
      createPublisher: () => {
        constructed = true
        return fakePublisher().publisher
      },
      networkInterfaces: () => LAN_INTERFACES,
    })

    expect(constructed).toBe(false)
    expect(advertisement.active).toBe(false)
  })

  test('does not construct a publisher when there is no non-loopback interface', () => {
    let constructed = false
    const advertisement = startBridgeAdvertise({
      port: 8989,
      createPublisher: () => {
        constructed = true
        return fakePublisher().publisher
      },
      networkInterfaces: () => LOOPBACK_ONLY_INTERFACES,
    })

    expect(constructed).toBe(false)
    expect(advertisement.active).toBe(false)
  })

  test('close() on a disabled/no-op advertisement resolves without error', async () => {
    const advertisement = startBridgeAdvertise({
      port: 8989,
      disabled: true,
      networkInterfaces: () => LAN_INTERFACES,
    })
    await expect(advertisement.close()).resolves.toBeUndefined()
  })
})

describe('startBridgeAdvertise — lifecycle (goodbye on close)', () => {
  test('close() sends the mDNS goodbye (service.stop) then tears down the publisher (destroy)', async () => {
    const { publisher, stopped, destroyed } = fakePublisher()
    const advertisement = startBridgeAdvertise({
      port: 8989,
      createPublisher: () => publisher,
      networkInterfaces: () => LAN_INTERFACES,
    })

    expect(stopped).toEqual([])
    expect(destroyed).toEqual([])

    await advertisement.close()

    expect(stopped).toEqual([true])
    expect(destroyed).toEqual([true])
  })

  test('close() is idempotent — a second call does not re-invoke stop/destroy', async () => {
    const { publisher, stopped, destroyed } = fakePublisher()
    const advertisement = startBridgeAdvertise({
      port: 8989,
      createPublisher: () => publisher,
      networkInterfaces: () => LAN_INTERFACES,
    })

    await advertisement.close()
    await advertisement.close()

    expect(stopped).toEqual([true])
    expect(destroyed).toEqual([true])
  })
})
