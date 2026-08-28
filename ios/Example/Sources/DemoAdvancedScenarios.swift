import SwiftUI
import HakkaCommon
import HakkaNetwork

// MARK: - Advanced tab
//
// Throttle profiles, breakpoints, the UserDefaults storage panel, the two
// Logs surfaces (unstructured Console + structured `LogEntry`), and GraphQL
// operation detection -- confirmed against `ios/Sources/Common/ThrottleEngine.swift`,
// `BreakpointEngine.swift`, `HakkaConsole.swift`, `HakkaLog.swift`,
// `UI/Storage/StorageView.swift`, and `Network/Redaction.swift`'s
// `extractGraphQLOperationName` before wiring each button. WebSocket capture
// lives in `DemoWebSocket.swift`; the gzip body builder lives in
// `DemoGzip.swift` -- both are also on this tab.

extension DemoView {
    var advancedCommands: some View {
        VStack(spacing: 14) {
            commandSection("Throttle Profiles", subtitle: "Inject latency + bandwidth caps on real requests") {
                command("Fast 3G", "antenna.radiowaves.left.and.right", .green) { applyThrottle(.fast3g, label: "Fast 3G") }
                command("Slow 3G", "antenna.radiowaves.left.and.right", .orange) { applyThrottle(.slow3g, label: "Slow 3G") }
                command("Edge", "antenna.radiowaves.left.and.right", .yellow) { applyThrottle(.edge, label: "Edge") }
                command("Offline", "airplane", .red) { applyThrottle(.offline, label: "Offline") }
                command("Reset", "arrow.counterclockwise", .gray) { resetThrottle() }
            }

            commandSection("Breakpoints", subtitle: "Pause a request before it's sent, then Resume/Abort it") {
                command("Arm + Trigger", "pause.circle", .pink) { armBreakpointDemo() }
                command("Release All", "play.circle", .gray) { resumeAllBreakpoints() }
            }

            commandSection("Storage", subtitle: "Seed UserDefaults for the Storage tab") {
                command("Seed", "tray.and.arrow.down", .mint) { seedStorageDemo() }
                command("Clear", "tray.and.arrow.up", .gray) { clearStorageDemo() }
            }

            commandSection("Logs", subtitle: "Unstructured console vs. structured entries") {
                command("Console", "terminal", .cyan) { emitConsoleLogsDemo() }
                command("Structured", "doc.text", .indigo) { emitStructuredLogDemo() }
            }

            commandSection("Protocol Coverage", subtitle: "WebSocket frames, GraphQL detection, gzip decode") {
                command("WebSocket Echo", "cable.connector", .blue) { fireWebSocketDemo() }
                command("GraphQL Query", "curlybraces.square", .purple) { fireGraphQLDemo() }
                command("Gzip Body", "archivebox", .teal) { fireGzipDemo() }
            }
        }
        .animation(.snappy(duration: 0.24), value: selectedGroup)
    }

    // MARK: - Throttle

    /// Sets the named profile, then fires a request so the injected
    /// latency/bandwidth is visible in that request's own timing -- the
    /// profile stays active for every request after this one too, until
    /// Reset (or another profile) is picked, same as the real Rules >
    /// Throttle screen.
    func applyThrottle(_ profile: ThrottleProfile, label: String) {
        ThrottleEngine.shared.setProfile(profile)
        pushEvent("Throttle: \(label)", tint: .teal)
        lastEvent = "Throttle set to \(label)"
        fire("GET", "https://httpbin.org/bytes/50000", label: "Throttled (\(label))")
    }

    func resetThrottle() {
        ThrottleEngine.shared.setProfile(.none)
        pushEvent("Throttle reset", tint: .gray)
        lastEvent = "Throttle off"
    }

    // MARK: - Breakpoints

    /// Arms a `.both`-phase breakpoint, then fires the request that matches
    /// it. `HakkaURLProtocol` checks `matchesRequest`/`matchesResponse`
    /// independently at each phase, so a `.both` rule pauses this one
    /// request twice: once before it's sent, and again after the real
    /// response comes back, before delivery -- covering both breakpoint
    /// phases from a single button. `BreakpointEngine.pauseRequest`/
    /// `pauseResponse` block that request's background thread on a
    /// semaphore each time -- `inFlightCount` stays elevated until someone
    /// opens Rules > Breakpoints in the Inspector and taps Resume or Abort,
    /// twice, (or "Release All" below is used instead).
    func armBreakpointDemo() {
        BreakpointEngine.shared.addBreakpoint(BreakpointInput(
            pattern: "breakpoint-demo",
            on: .both,
            id: "demo_breakpoint"
        ))
        pushEvent("Breakpoint armed", tint: .pink)
        lastEvent = "Paused. Open Rules > Breakpoints."
        fire("GET", "https://httpbin.org/anything/breakpoint-demo", label: "Breakpoint")
    }

    func resumeAllBreakpoints() {
        BreakpointEngine.shared.resumeAll()
        pushEvent("Breakpoints released", tint: .gray)
    }

    // MARK: - Storage

    func seedStorageDemo() {
        let defaults = UserDefaults.standard
        defaults.set("ansuman", forKey: "hakkaDemo.username")
        defaults.set(Int.random(in: 1...50), forKey: "hakkaDemo.sessionCount")
        defaults.set(["dark-mode", "graphql-tab"], forKey: "hakkaDemo.betaFeatures")
        defaults.set(Date().timeIntervalSince1970, forKey: "hakkaDemo.lastSyncedAt")
        pushEvent("Storage seeded", tint: .mint)
        lastEvent = "UserDefaults seeded. Open the Storage tab."
    }

    func clearStorageDemo() {
        let defaults = UserDefaults.standard
        for key in demoStorageKeys { defaults.removeObject(forKey: key) }
        pushEvent("Storage cleared", tint: .gray)
    }

    // MARK: - Logs

    /// `HakkaConsole` backs the Logs tab's unstructured "Console" segment.
    func emitConsoleLogsDemo() {
        HakkaConsole.shared.debug("Demo: verbose trace line")
        HakkaConsole.shared.info("Demo: user opened the inspector")
        HakkaConsole.shared.warn("Demo: retrying a flaky endpoint")
        HakkaConsole.shared.error("Demo: request failed after 3 retries")
        pushEvent("Console logs emitted", tint: .cyan)
        lastEvent = "4 console lines. Open the Logs tab."
    }

    /// `HakkaInterceptor.log(...)` backs the Logs tab's structured
    /// "Structured" segment (a `LogEntry`, distinct from `HakkaConsole`'s
    /// plain text -- see `HakkaLog.swift`).
    func emitStructuredLogDemo() {
        HakkaInterceptor.shared.log(
            .info,
            "Demo structured event",
            category: "demo",
            metadata: ["screen": "DemoView", "capturedSoFar": "\(requestCount)"]
        )
        pushEvent("Structured log emitted", tint: .indigo)
        lastEvent = "Structured entry. Logs > Structured."
    }

    // MARK: - GraphQL

    /// No special wiring needed beyond firing the right request:
    /// `HakkaInterceptor.extractGraphQLOperationName` (`Redaction.swift`)
    /// runs automatically on every captured request whose URL contains
    /// "graphql" or whose content type is JSON, and the GraphQL detail tab
    /// only appears when it found an operation name.
    func fireGraphQLDemo() {
        guard let url = URL(string: "https://httpbin.org/anything/graphql") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "operationName": "DemoQuery",
            "query": "query DemoQuery($id: ID!) { user(id: $id) { name email } }",
            "variables": ["id": "42"],
        ])
        inFlightCount += 1
        lastEvent = "GraphQL started"
        URLSession.shared.dataTask(with: req) { _, _, error in
            DispatchQueue.main.async {
                inFlightCount = max(0, inFlightCount - 1)
                requestCount += 1
                if error != nil {
                    pushEvent("GraphQL failed", tint: .red)
                } else {
                    pushEvent("GraphQL DemoQuery captured", tint: .purple)
                    lastEvent = "GraphQL DemoQuery. Open the GraphQL tab."
                }
            }
        }.resume()
    }

    // MARK: - Gzip

    /// Real network gzip doesn't reach the demo intact: `URLSession`
    /// negotiates `Accept-Encoding: gzip` itself and transparently
    /// decompresses before Hakka ever sees the body, so a live
    /// `httpbin.org/gzip` call would never exercise the SDK's own
    /// `GzipBodyDecoder`. Serving it from a mock rule instead sidesteps
    /// transport-level negotiation entirely -- the literal gzip bytes and
    /// `Content-Encoding: gzip` header both reach the decoder unmodified.
    func fireGzipDemo() {
        MockEngine.shared.addRule(MockRuleInput(
            pattern: "gzip-demo",
            response: MockResponse(
                status: 200,
                headers: ["Content-Type": "application/json", "Content-Encoding": "gzip"],
                body: DemoGzip.base64Body(for: "{\"hakka\":\"gzip decode demo\",\"compressed\":true}")
            )
        ), id: "demo_gzip")
        fire("GET", "https://api.example.com/gzip-demo", label: "Gzip Body")
    }
}

/// Keys `seedStorageDemo()` writes -- `clearStorageDemo()` only removes
/// these, never the host app's other `UserDefaults.standard` entries.
private let demoStorageKeys = [
    "hakkaDemo.username",
    "hakkaDemo.sessionCount",
    "hakkaDemo.betaFeatures",
    "hakkaDemo.lastSyncedAt",
]
