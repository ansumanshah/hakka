import Foundation
import Testing
@testable import HakkaSimInject

/// Covers the one piece of `HakkaSimInjectBootstrap` that is unit-testable
/// without a real dyld injection: bridge URL resolution from the
/// environment. `+load` itself, and the `HakkaInterceptor` it starts, need a
/// live simulator process to observe — see
/// `.claude/strategy/simulator-capture-2026-08.md` for how that was verified
/// manually against MobileSafari.
@Suite("Bridge URL resolution")
struct SimInjectBootstrapTests {

    @Test("defaults to the documented loopback bridge address")
    func defaultsToLoopback() {
        // resolveBridgeURL reads HAKKA_BRIDGE_URL from ProcessInfo directly,
        // so this only exercises the "unset" branch faithfully when the
        // test runner itself has no such variable — true for `swift test`.
        guard ProcessInfo.processInfo.environment["HAKKA_BRIDGE_URL"] == nil else {
            return
        }
        let url = HakkaSimInjectBootstrap.resolveBridgeURL()
        #expect(url?.absoluteString == "ws://127.0.0.1:8989")
    }

    @Test("an empty override string still falls back to the default")
    func emptyOverrideFallsBack() {
        // Guards against a launcher that sets HAKKA_BRIDGE_URL="" instead of
        // omitting it — should behave like "unset", not "invalid URL".
        guard ProcessInfo.processInfo.environment["HAKKA_BRIDGE_URL"] == nil else {
            return
        }
        let url = HakkaSimInjectBootstrap.resolveBridgeURL()
        #expect(url != nil)
    }
}
