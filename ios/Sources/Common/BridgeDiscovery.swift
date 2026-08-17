import Foundation

// MARK: - DiscoveredBridgeHost

/// A Hakka bridge hub discovered on the LAN via `_hakka._tcp` Bonjour/mDNS.
///
/// Mirrors `DiscoveredBridgeHost` on Android (`BridgeDiscovery.kt`).
public struct DiscoveredBridgeHost: Equatable, Sendable {
    public let hostname: String
    public let port: Int

    public init(hostname: String, port: Int) {
        self.hostname = hostname
        self.port = port
    }

    /// `ws://` URL suitable for `HakkaBridgeClient(url:)` / `HakkaConfig.bridgeURL`.
    public var webSocketURL: URL? {
        URL(string: "ws://\(hostname):\(port)")
    }
}

// MARK: - BridgeDiscoverySelection

/// Outcome of applying the zero-config selection semantics to a discovered-host set.
///
/// Mirrors `BridgeDiscoverySelection` on Android (`BridgeDiscovery.kt`).
public enum BridgeDiscoverySelection: Equatable, Sendable {
    /// No hosts found before the discovery timeout — current (no-bridge) behavior.
    case none
    /// Exactly one host found — safe to connect automatically, no ambiguity.
    case autoConnect(DiscoveredBridgeHost)
    /// More than one host found — surface the list (e.g. in Settings), connect to none.
    case ambiguous([DiscoveredBridgeHost])
}

// MARK: - BridgeDiscoverySelector

/// Pure 0/1/many selection logic, independent of the Bonjour/`NWBrowser` transport so it is
/// trivially unit-testable with a faked browser (`BridgeHostBrowsing`).
public enum BridgeDiscoverySelector {
    public static func select(from hosts: [DiscoveredBridgeHost]) -> BridgeDiscoverySelection {
        switch hosts.count {
        case 0: return .none
        case 1: return .autoConnect(hosts[0])
        default: return .ambiguous(hosts)
        }
    }
}

// MARK: - BridgeHostBrowsing

/// Abstraction over the platform browsing mechanism (`NWBrowser` for `_hakka._tcp` on
/// iOS/macOS — see `NWBridgeHostBrowser`) so `HakkaBridgeDiscovery`'s timeout + selection
/// logic can be unit-tested with a faked browser, without touching real Bonjour/mDNS.
public protocol BridgeHostBrowsing: AnyObject {
    /// Begin browsing. `onHostsChanged` may be invoked multiple times as results
    /// arrive/expire; each call carries the full current known-host set.
    func start(onHostsChanged: @escaping @Sendable ([DiscoveredBridgeHost]) -> Void)
    /// Stop browsing. Safe to call even if `start` was never called, or more than once.
    func stop()
}

// MARK: - HakkaBridgeDiscovery

/// Orchestrates zero-config bridge discovery: browses for `_hakka._tcp` hosts for
/// `timeout` seconds, applies `BridgeDiscoverySelector` to whatever was found by then, and
/// reports the outcome exactly once via `onSelection`.
///
/// Times out gracefully: if nothing is found before `timeout` elapses, the outcome is
/// `.none` — identical to today's behavior when `bridgeURL` is simply unset. No error
/// surfaces, no retry loop runs — this is best-effort convenience, not a required
/// dependency of normal operation.
public final class HakkaBridgeDiscovery: @unchecked Sendable {
    private let browser: BridgeHostBrowsing
    private let timeout: TimeInterval
    private let queue = DispatchQueue(label: "com.noodleapps.hakka.bridge-discovery")
    private let lock = NSLock()
    private var latestHosts: [DiscoveredBridgeHost] = []
    private var settled = false
    private var timeoutWorkItem: DispatchWorkItem?

    /// - Parameters:
    ///   - browser: The browsing transport. Pass a fake in tests; pass `NWBridgeHostBrowser()`
    ///     (or omit, in the convenience initializer) in production.
    ///   - timeout: Seconds to wait for browse results before selecting. Default 5.
    public init(browser: BridgeHostBrowsing, timeout: TimeInterval = 5) {
        self.browser = browser
        self.timeout = timeout
    }

    /// Starts browsing. `onSelection` fires exactly once, `timeout` seconds after `start`
    /// is called, on an internal serial queue.
    public func start(onSelection: @escaping (BridgeDiscoverySelection) -> Void) {
        lock.lock()
        settled = false
        latestHosts = []
        lock.unlock()

        browser.start { [weak self] hosts in
            guard let self else { return }
            self.lock.lock()
            self.latestHosts = hosts
            self.lock.unlock()
        }

        let workItem = DispatchWorkItem { [weak self] in
            self?.finish(onSelection: onSelection)
        }
        timeoutWorkItem = workItem
        queue.asyncAfter(deadline: .now() + timeout, execute: workItem)
    }

    /// Stops browsing without firing `onSelection` — used when the interceptor stops
    /// before the discovery timeout elapses.
    public func stop() {
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        browser.stop()
    }

    private func finish(onSelection: @escaping (BridgeDiscoverySelection) -> Void) {
        lock.lock()
        guard !settled else { lock.unlock(); return }
        settled = true
        let hosts = latestHosts
        lock.unlock()

        browser.stop()
        onSelection(BridgeDiscoverySelector.select(from: hosts))
    }
}
