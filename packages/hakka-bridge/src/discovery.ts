import { hostname as osHostname, networkInterfaces as osNetworkInterfaces } from 'node:os'

import Bonjour from 'bonjour-service'

/**
 * Zero-config LAN discovery for the bridge hub — advertises `_hakka._tcp.local`
 * over mDNS/Bonjour so iOS/Android clients can find it with no manually-typed
 * `bridgeURL`. Presence-broadcasting only (TXT/SRV records carry nothing but
 * service name and port); the trust model is unchanged from a manually-typed
 * URL — see [Zero-config LAN discovery](/bridge/overview/#zero-config-lan-discovery).
 */

/** Bonjour service name (before `._tcp.local`) — advertises as `_hakka._tcp.local`. */
export const BRIDGE_MDNS_SERVICE_NAME = 'hakka'

/** Minimal surface of `bonjour-service`'s `Service` this module depends on — lets tests
 *  inject a fake without touching a real UDP socket. */
export interface BridgeMdnsService {
  stop(callback?: () => void): void
}

/** Minimal surface of `bonjour-service`'s `Bonjour` this module depends on. */
export interface BridgeMdnsPublisher {
  publish(options: { name: string; type: string; protocol: 'tcp'; port: number; host?: string }): BridgeMdnsService
  destroy(callback?: () => void): void
}

export interface BridgeAdvertiseOptions {
  /** WS port the hub is listening on — advertised as the service's SRV port. */
  port: number
  /** Instance name shown to browsers. Default: the machine's hostname. */
  name?: string
  /**
   * Specific LAN address the hub is bound to, e.g. `'192.168.1.42'` — passed
   * through as the mDNS service's `host` (SRV target) instead of
   * `bonjour-service`'s default (machine hostname). Omit for an
   * all-interfaces bind. Caveat: `bonjour-service` always publishes an
   * A/AAAA record for every non-loopback interface regardless of `host` — it
   * cannot restrict which interfaces get an address record; this only fixes
   * the advertised identity, not that.
   */
  host?: string
  /** Skip advertising entirely — the opt-out flag. Default: false (advertise). */
  disabled?: boolean
  /** Override for tests; defaults to a real `bonjour-service` Bonjour instance. */
  createPublisher?: () => BridgeMdnsPublisher
  /** Override for tests; defaults to `os.networkInterfaces()`. */
  networkInterfaces?: typeof osNetworkInterfaces
}

/** Handle returned by `startBridgeAdvertise` — mirrors `BridgeServer`'s `close()` shape. */
export interface BridgeAdvertisement {
  /** True when this handle is actually advertising (false when disabled/no-op). */
  readonly active: boolean
  /** Stops advertising and sends the mDNS goodbye packet. Idempotent. */
  close(): Promise<void>
}

const NOOP_ADVERTISEMENT: BridgeAdvertisement = {
  active: false,
  close: () => Promise.resolve(),
}

/**
 * True when at least one non-loopback IPv4 interface is up. A host with only `lo0`/`lo`
 * (no LAN/Wi-Fi) has no peers who could discover the advertisement, so `startBridgeAdvertise`
 * treats this the same as `disabled` rather than opening a socket for nobody.
 */
export function hasNonLoopbackInterface(
  interfaces: ReturnType<typeof osNetworkInterfaces> = osNetworkInterfaces(),
): boolean {
  return Object.values(interfaces).some((addrs) =>
    (addrs ?? []).some((addr) => addr.family === 'IPv4' && !addr.internal),
  )
}

/**
 * Adapts `bonjour-service`'s loosely-typed `Bonjour`/`Service` (`stop`/`destroy` are typed
 * as bare `CallableFunction`) to the strict `BridgeMdnsPublisher` surface this module
 * depends on, so the rest of the file — and its tests — only ever see a typed shape.
 */
function defaultCreatePublisher(): BridgeMdnsPublisher {
  const bonjour = new Bonjour()
  return {
    publish: (options) => {
      const service = bonjour.publish(options)
      return { stop: (callback) => service.stop(callback) }
    },
    destroy: () => bonjour.destroy(),
  }
}

/**
 * Advertises the bridge hub as `_hakka._tcp.local` with the given WS `port`. No-ops
 * (returning an inert, already-closed-equivalent handle) when:
 * - `disabled` is set (the opt-out flag), or
 * - the host has no non-loopback network interface — see `hasNonLoopbackInterface`.
 *
 * `close()` sends the mDNS goodbye packet (`service.stop`) before tearing down the
 * underlying mdns socket (`publisher.destroy`), so a stopped hub disappears from LAN
 * browsers promptly instead of lingering until the advertisement's TTL expires.
 */
export function startBridgeAdvertise(options: BridgeAdvertiseOptions): BridgeAdvertisement {
  const getInterfaces = options.networkInterfaces ?? osNetworkInterfaces
  if (options.disabled || !hasNonLoopbackInterface(getInterfaces())) {
    return NOOP_ADVERTISEMENT
  }

  const createPublisher = options.createPublisher ?? defaultCreatePublisher
  const publisher = createPublisher()
  const service = publisher.publish({
    name: options.name ?? osHostname(),
    type: BRIDGE_MDNS_SERVICE_NAME,
    protocol: 'tcp',
    port: options.port,
    ...(options.host !== undefined ? { host: options.host } : {}),
  })

  let closed = false
  return {
    active: true,
    close: () =>
      new Promise<void>((resolve) => {
        if (closed) {
          resolve()
          return
        }
        closed = true
        service.stop(() => {
          publisher.destroy()
          resolve()
        })
      }),
  }
}
