import SwiftUI
import HakkaCommon

// MARK: - Mocks tab
//
// "Mock Engine"/"Suites" demo the plain `response` shape (unchanged from
// before). "Mock Types" is new: it exercises every other `MockRuleInput`
// shape SPEC.md footnote 5 documents for iOS -- `block`, `redirectTo`,
// declarative `modify`, transport-error `failure`, and the `skipCount`/
// `stopAfter` match budget -- confirmed against `Common/MockRuleTypes.swift`
// and `Common/MockFailure.swift` before wiring each button.

extension DemoView {
    var mockCommands: some View {
        VStack(spacing: 14) {
            commandSection("Mock Engine", subtitle: "Verify local rules and captured mock responses") {
                command("Add mock", "plus.circle", .mint) { addMock() }
                command("Test mock", "play.circle", .green) { fire("GET", "https://api.example.com/mocked") }
                command("Clear mocks", "xmark.circle", .gray) {
                    MockEngine.shared.clearRules()
                    pushEvent("Mocks cleared", tint: .gray)
                }
            }

            commandSection("Mock Types", subtitle: "Block, redirect, modify, failure, skip/stop budget") {
                command("Block", "hand.raised", .red) { addBlockMock() }
                command("Redirect", "arrow.triangle.turn.up.right.circle", .blue) { addRedirectMock() }
                command("Modify", "square.and.pencil", .purple) { addModifyMock() }
                command("Failure", "bolt.trianglebadge.exclamationmark", .orange) { addFailureMock() }
                command("Skip + Stop", "repeat", .teal) { runSkipStopMock() }
            }

            commandSection("Suites", subtitle: "Batch coverage for release checks") {
                command("All Methods", "square.grid.2x2", .blue) { allMethods() }
                command("All States", "gauge.with.dots.needle.67percent", .orange) { allStates() }
                command("Mixed 20", "bolt.badge.clock", .yellow) { rapidFire(20) }
                command("Clear Logs", "trash.slash", .red) { clearCapture() }
            }
        }
        .animation(.snappy(duration: 0.24), value: selectedGroup)
    }

    func addMock() {
        MockEngine.shared.addRule(MockRuleInput(
            pattern: "api.example.com/mocked",
            response: MockResponse(
                status: 200,
                headers: ["Content-Type": "application/json"],
                body: "{\"message\": \"Mocked by Hakka\", \"mocked\": true}",
                delay: 0.3
            )
        ), id: "demo_response")
        pushEvent("Mock added", tint: .mint)
        lastEvent = "Mock added"
    }

    /// `block: true` short-circuits with a network-error-shaped failure
    /// before the request is sent -- still recorded as a completed capture.
    func addBlockMock() {
        MockEngine.shared.addRule(MockRuleInput(
            pattern: "blocked-demo",
            response: MockResponse(),
            block: true
        ), id: "demo_block")
        pushEvent("Block rule added", tint: .red)
        fire("GET", "https://httpbin.org/anything/blocked-demo", label: "Block")
    }

    /// `redirectTo` routes through the passthrough-then-transform path: the
    /// real request goes out, just to a different URL.
    func addRedirectMock() {
        MockEngine.shared.addRule(MockRuleInput(
            pattern: "redirect-demo",
            response: MockResponse(),
            redirectTo: "https://httpbin.org/anything/redirected-by-hakka"
        ), id: "demo_redirect")
        pushEvent("Redirect rule added", tint: .blue)
        fire("GET", "https://httpbin.org/anything/redirect-demo", label: "Redirect")
    }

    /// `modify` also uses the passthrough-then-transform path: the real
    /// request is issued (with a header stamped on first), then the real
    /// response's status/headers/body are rewritten before delivery.
    /// httpbin's `/anything` echoes back a body containing the literal key
    /// `"origin"`, which `replaceBody` finds and swaps.
    func addModifyMock() {
        MockEngine.shared.addRule(MockRuleInput(
            pattern: "modify-demo",
            response: MockResponse(),
            modify: MockRuleModify(
                setRequestHeaders: ["X-Hakka-Demo": "1"],
                status: 201,
                setResponseHeaders: ["X-Hakka-Mock": "modified"],
                replaceBody: [.init(find: "origin", replace: "HAKKA")]
            )
        ), id: "demo_modify")
        pushEvent("Modify rule added", tint: .purple)
        fire("GET", "https://httpbin.org/anything/modify-demo", label: "Modify")
    }

    /// `failure` simulates a specific transport-level error -- the request
    /// never gets a real response.
    func addFailureMock() {
        MockEngine.shared.addRule(MockRuleInput(
            pattern: "failure-demo",
            response: MockResponse(),
            failure: MockFailure(code: .timeout)
        ), id: "demo_failure")
        pushEvent("Failure rule added", tint: .orange)
        fire("GET", "https://httpbin.org/anything/failure-demo", label: "Failure")
    }

    /// `skipCount: 1, stopAfter: 2` -- the 1st match passes through for
    /// real, the 2nd and 3rd are mocked, the 4th and beyond pass through
    /// again. Fires the same URL four times in a row so all three regimes
    /// land in one capture run.
    func runSkipStopMock() {
        MockEngine.shared.addRule(MockRuleInput(
            pattern: "skipstop-demo",
            response: MockResponse(status: 200, body: "{\"mocked\": true}"),
            skipCount: 1,
            stopAfter: 2
        ), id: "demo_skipstop")
        pushEvent("Skip/stop rule added", tint: .teal)
        for i in 1...4 {
            fire("GET", "https://httpbin.org/anything/skipstop-demo", label: "Skip/Stop #\(i)")
        }
    }
}
