import Foundation
import Testing
@testable import HakkaNetwork
import HakkaCommon

// MARK: - FakeBridgeHostBrowser

/// A `BridgeHostBrowsing` fake that reports a fixed host set the instant `start` is
/// called — no real Bonjour/mDNS, no timing dependency on the network. Lets
/// `HakkaBridgeDiscoveryTests` exercise the 0/1/many selection semantics deterministically.
private final class FakeBridgeHostBrowser: BridgeHostBrowsing, @unchecked Sendable {
    private let hostsToReport: [DiscoveredBridgeHost]
    private let lock = NSLock()
    private var _startCallCount = 0
    private var _stopCallCount = 0

    var startCallCount: Int {
        lock.lock(); defer { lock.unlock() }
        return _startCallCount
    }

    var stopCallCount: Int {
        lock.lock(); defer { lock.unlock() }
        return _stopCallCount
    }

    init(hosts: [DiscoveredBridgeHost] = []) {
        self.hostsToReport = hosts
    }

    func start(onHostsChanged: @escaping @Sendable ([DiscoveredBridgeHost]) -> Void) {
        lock.lock()
        _startCallCount += 1
        lock.unlock()
        onHostsChanged(hostsToReport)
    }

    func stop() {
        lock.lock()
        _stopCallCount += 1
        lock.unlock()
    }
}

// MARK: - StopTriggeringBridgeHostBrowser

/// A `BridgeHostBrowsing` fake whose `stop()` synchronously invokes a caller-supplied
/// closure exactly once. `HakkaBridgeDiscovery.finish()` calls `browser.stop()` *before*
/// firing its `onSelection` completion — reentrantly calling `HakkaInterceptor.stop()`
/// from inside this fake's `stop()` reliably lands it in that exact window, reproducing
/// the BLOCKER race (stop() racing an already-in-flight completion) deterministically,
/// with no timing-dependent sleep needed to hit it.
///
/// The "exactly once" guard matters: `HakkaInterceptor.stop()` itself calls
/// `discovery?.stop()`, which calls `browser.stop()` again — without the guard that
/// second, reentrant call would invoke the closure a second time, calling
/// `HakkaInterceptor.stop()` again *while the first call is still on the stack holding
/// its non-reentrant `NSLock`*, deadlocking the test. One real `stop()` call is all the
/// race needs to reproduce; the reentrant echo is a fake-only artifact, not part of the
/// interleaving under test.
private final class StopTriggeringBridgeHostBrowser: BridgeHostBrowsing, @unchecked Sendable {
    private let hostsToReport: [DiscoveredBridgeHost]
    private let lock = NSLock()
    private var onStop: (() -> Void)?
    private var hasTriggeredStop = false

    init(hosts: [DiscoveredBridgeHost]) {
        self.hostsToReport = hosts
    }

    func setOnStop(_ onStop: @escaping () -> Void) {
        lock.lock(); defer { lock.unlock() }
        self.onStop = onStop
    }

    func start(onHostsChanged: @escaping @Sendable ([DiscoveredBridgeHost]) -> Void) {
        onHostsChanged(hostsToReport)
    }

    func stop() {
        lock.lock()
        guard !hasTriggeredStop else { lock.unlock(); return }
        hasTriggeredStop = true
        let callback = onStop
        lock.unlock()
        callback?()
    }
}

// MARK: - HakkaInterceptor bridge-discovery stop race (BLOCKER regression)

@Suite struct HakkaInterceptorBridgeDiscoveryRaceTests {
    /// Sanity check that the test scaffolding (`bridgeHostBrowserFactoryForTest`,
    /// `debugOnDiscoveryCompletionHandledForTest`) actually observes a created client
    /// when nothing races the completion — so the regression test below is meaningful
    /// rather than vacuously passing.
    @Test func discoveryCompletionWithoutStopCreatesClient() async throws {
        let host = DiscoveredBridgeHost(hostname: "127.0.0.1", port: 8989)
        let browser = FakeBridgeHostBrowser(hosts: [host])
        let interceptor = HakkaInterceptor()
        interceptor.bridgeHostBrowserFactoryForTest = { browser }

        interceptor.start()
        defer { interceptor.stop() }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            interceptor.debugOnDiscoveryCompletionHandledForTest = { continuation.resume() }
            interceptor.discoverBridge(timeout: 0.01)
        }

        #expect(interceptor.debugHasBridgeClientForTest == true)
    }

    /// BLOCKER regression: a discovery completion that's already in flight when `stop()`
    /// runs must not create/start a `HakkaBridgeClient`. Before the generation-counter
    /// fix, `HakkaBridgeDiscovery.stop()`'s `DispatchWorkItem.cancel()` could not preempt
    /// a completion that had already started running, so `stop()` racing it would still
    /// let `applyBridgeDiscoverySelection` create a client after the interceptor was told
    /// to stop.
    @Test func discoveryCompletionRacingStopCreatesNoClient() async throws {
        let host = DiscoveredBridgeHost(hostname: "127.0.0.1", port: 8989)
        let browser = StopTriggeringBridgeHostBrowser(hosts: [host])
        let interceptor = HakkaInterceptor()
        interceptor.bridgeHostBrowserFactoryForTest = { browser }

        interceptor.start()
        defer { interceptor.stop() }

        browser.setOnStop { [weak interceptor] in
            interceptor?.stop()
        }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            interceptor.debugOnDiscoveryCompletionHandledForTest = { continuation.resume() }
            interceptor.discoverBridge(timeout: 0.01)
        }

        #expect(interceptor.debugHasBridgeClientForTest == false)
    }
}

// MARK: - BridgeDiscoverySelector

@Suite struct BridgeDiscoverySelectorTests {
    @Test func zeroHostsSelectsNone() {
        #expect(BridgeDiscoverySelector.select(from: []) == .none)
    }

    @Test func oneHostSelectsAutoConnect() {
        let host = DiscoveredBridgeHost(hostname: "Anshs-MacBook.local", port: 8989)
        #expect(BridgeDiscoverySelector.select(from: [host]) == .autoConnect(host))
    }

    @Test func manyHostsSelectsAmbiguous() {
        let a = DiscoveredBridgeHost(hostname: "host-a.local", port: 8989)
        let b = DiscoveredBridgeHost(hostname: "host-b.local", port: 8989)
        #expect(BridgeDiscoverySelector.select(from: [a, b]) == .ambiguous([a, b]))
    }
}

// MARK: - HakkaBridgeDiscovery

@Suite struct HakkaBridgeDiscoveryTests {
    @Test func zeroHostsResolvesToNone() async {
        let browser = FakeBridgeHostBrowser(hosts: [])
        let discovery = HakkaBridgeDiscovery(browser: browser, timeout: 0.02)

        let selection = await withCheckedContinuation { continuation in
            discovery.start { continuation.resume(returning: $0) }
        }

        #expect(selection == .none)
        #expect(browser.startCallCount == 1)
        #expect(browser.stopCallCount == 1)
    }

    @Test func exactlyOneHostAutoConnects() async {
        let host = DiscoveredBridgeHost(hostname: "Anshs-MacBook.local", port: 8989)
        let browser = FakeBridgeHostBrowser(hosts: [host])
        let discovery = HakkaBridgeDiscovery(browser: browser, timeout: 0.02)

        let selection = await withCheckedContinuation { continuation in
            discovery.start { continuation.resume(returning: $0) }
        }

        #expect(selection == .autoConnect(host))
    }

    @Test func multipleHostsAreAmbiguousAndConnectToNone() async {
        let a = DiscoveredBridgeHost(hostname: "host-a.local", port: 8989)
        let b = DiscoveredBridgeHost(hostname: "host-b.local", port: 8989)
        let browser = FakeBridgeHostBrowser(hosts: [a, b])
        let discovery = HakkaBridgeDiscovery(browser: browser, timeout: 0.02)

        let selection = await withCheckedContinuation { continuation in
            discovery.start { continuation.resume(returning: $0) }
        }

        guard case .ambiguous(let hosts) = selection else {
            Issue.record("expected .ambiguous, got \(selection)")
            return
        }
        #expect(Set(hosts.map(\.hostname)) == Set([a, b].map(\.hostname)))
    }

    @Test func stopBeforeTimeoutNeverFiresSelection() async throws {
        let browser = FakeBridgeHostBrowser(hosts: [])
        let discovery = HakkaBridgeDiscovery(browser: browser, timeout: 0.05)

        final class Box: @unchecked Sendable {
            var fired = false
        }
        let box = Box()
        discovery.start { _ in box.fired = true }
        discovery.stop()

        // Wait well past the timeout — onSelection must never fire once stopped.
        try await Task.sleep(nanoseconds: 150_000_000)
        #expect(box.fired == false)
    }

    @Test func webSocketURLFormatsAsWsScheme() {
        let host = DiscoveredBridgeHost(hostname: "192.168.1.42", port: 8989)
        #expect(host.webSocketURL?.absoluteString == "ws://192.168.1.42:8989")
    }
}

// MARK: - HakkaConfig.bridgeAutoDiscoveryEnabled

@Suite struct HakkaConfigBridgeDiscoveryTests {
    @Test func defaultsToFalse() {
        #expect(HakkaConfig.default.bridgeAutoDiscoveryEnabled == false)
    }

    @Test func roundTripsViaInit() {
        let config = HakkaConfig(bridgeAutoDiscoveryEnabled: true)
        #expect(config.bridgeAutoDiscoveryEnabled == true)
    }

    @Test func roundTripsViaReplacing() {
        let config = HakkaConfig.default.replacing(bridgeAutoDiscoveryEnabled: true)
        #expect(config.bridgeAutoDiscoveryEnabled == true)
    }

    @Test func unrelatedReplacingPreservesExistingValue() {
        let base = HakkaConfig(bridgeAutoDiscoveryEnabled: true)
        let updated = base.replacing(maxRequests: 100)
        #expect(updated.bridgeAutoDiscoveryEnabled == true)
    }
}
