import Foundation
import HakkaCommon
import HakkaNetwork

/// Entry point for `hakka sim attach` — loaded into a Simulator process via
/// `DYLD_INSERT_LIBRARIES` (set through `xcrun simctl`'s `SIMCTL_CHILD_`
/// environment prefix, which `simctl` strips before the child ever sees it).
///
/// This is the SDK's normal capture path (`HakkaInterceptor` +
/// `HakkaBridgeClient`, unmodified) started from outside the host app instead
/// of from inside it. See ADR 0014
/// (`docs/src/content/docs/contributing/adr/0014-simulator-injection-capture.md`)
/// for the full writeup, scope, and failure modes — including two load-bearing
/// findings from testing this against a real app: `URLSession.shared` never
/// goes through the `.default`/`.ephemeral` swizzle this relies on (an
/// existing SDK characteristic, not introduced here), and a process boundary
/// (WebKit's separate Networking XPC service) that makes Safari's own page
/// traffic invisible to this technique specifically.
///
/// ## Why a C constructor and not Swift's `+load`
///
/// A dylib has no `main` of its own to run code from. `__attribute__((constructor))`
/// (wired up by the sibling `HakkaSimInjectC` target, see `constructor.c`) is
/// dyld's guaranteed hook for running code the moment an image is mapped —
/// including one inserted via `DYLD_INSERT_LIBRARIES` before the host's own
/// `main()` runs. Swift explicitly forbids overriding ObjC's `+load`
/// (`"defines Objective-C class method 'load', which is not permitted by
/// Swift"`), so the constructor lives in C and calls back into this
/// `@_cdecl` entry point, which is the actual bootstrap logic.
public enum HakkaSimInjectBootstrap {

    /// Kept alive for the process lifetime — deliberately not
    /// `HakkaInterceptor.shared`. `.shared` is built once with
    /// `HakkaConfig.default` (no bridge URL), and `updateConfig` cannot
    /// retroactively create the `HakkaBridgeClient` that only `init` builds
    /// (see `HakkaInterceptor.init`). A dedicated instance, configured with
    /// the bridge URL up front, is the supported way to opt in.
    nonisolated(unsafe) private static var interceptor: HakkaInterceptor?

    static func start() {
        guard let bridgeURL = resolveBridgeURL() else {
            log("no HAKKA_BRIDGE_URL / default bridge URL parsed; capture disabled")
            return
        }

        let config = HakkaConfig(bridgeURL: bridgeURL)
        let interceptor = HakkaInterceptor(config: config)
        self.interceptor = interceptor
        interceptor.start()

        let target = ProcessInfo.processInfo.processName
        log("attached to \(target), streaming to \(bridgeURL.absoluteString)")
    }

    /// `HAKKA_BRIDGE_URL` overrides; otherwise the bridge hub's documented
    /// default loopback address. Simulator processes share the host's
    /// loopback interface, so 127.0.0.1 always reaches a hub running on the
    /// Mac — no LAN discovery needed for this path.
    ///
    /// Internal (not `private`) so `HakkaSimInjectTests` can exercise the
    /// resolution logic directly without going through the constructor.
    static func resolveBridgeURL() -> URL? {
        if let raw = ProcessInfo.processInfo.environment["HAKKA_BRIDGE_URL"], !raw.isEmpty {
            return URL(string: raw)
        }
        return URL(string: "ws://127.0.0.1:8989")
    }

    private static func log(_ message: String) {
        NSLog("[hakka-sim-inject] %@", message)
    }
}

/// C-callable entry point invoked by `HakkaSimInjectC`'s
/// `__attribute__((constructor))` function.
///
/// Runs synchronously, deliberately — an earlier version of this file
/// dispatched `start()` onto a background queue and captured nothing from a
/// real app (Maps.app: dozens of in-process `URLSession` requests, zero
/// captured). Dispatching meant `URLProtocol.registerClass` and the
/// `URLSessionConfiguration.default`/`.ephemeral` swizzle landed *after* the
/// host had already raced ahead and built its first session — too late for
/// that session's `protocolClasses` to ever include `HakkaURLProtocol`. A
/// dyld constructor runs before the host's own `main()`, so doing the
/// registration here, synchronously, is what actually wins that race.
/// `HakkaInterceptor.start()` itself only touches an `NSLock` and the ObjC
/// runtime (already initialized — Foundation is a load-time dependency of
/// this dylib, so it's up before our constructor runs) plus queues the
/// bridge socket connect onto its own background queue, so this stays fast.
@_cdecl("hakka_sim_inject_start")
public func hakka_sim_inject_start() {
    HakkaSimInjectBootstrap.start()
}
