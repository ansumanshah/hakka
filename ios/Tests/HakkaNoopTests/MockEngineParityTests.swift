import Foundation
import Testing
@testable import HakkaNetworkNoop
import HakkaCommon

// MARK: - MockEngine data-type parity
//
// Kept in its own file (rather than folded into HakkaNoopTests.swift) so
// `import HakkaCommon` here doesn't make `HakkaNoopTests.swift`'s unqualified
// `CurlExporter`/`TextExporter`/`ReportBuilder`/`RetentionPolicy` references
// ambiguous — those noop types aren't aliased to HakkaCommon's, unlike
// `MockRule`/`MockRuleInput`/`MockResponse`/`NetworkRequest`.

@Suite struct MockEngineParityTests {

    /// `HakkaNetworkNoop`'s `MockRuleInput`/`MockRule`/`MockResponse` must
    /// accept the full real-module surface (`redirectTo`/`block`/`modify`/
    /// `failure`/`skipCount`/`stopAfter`, `headerValues`) — app code written
    /// against Debug's `HakkaNetwork` swaps to this noop target in Release
    /// builds and must still compile unchanged. This is a compile-time
    /// regression test: it would fail to build, not just fail an assertion,
    /// if the noop types fell back out of parity with `HakkaCommon`'s.
    @Test func mockRuleInputAcceptsFullRealModuleSurface() {
        let engine = HakkaNetworkNoop.MockEngine()
        let id = engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(
                status: 200,
                headers: ["Set-Cookie": "a=1"],
                headerValues: ["Set-Cookie": ["a=1", "b=2"]],
                body: "{}"
            ),
            redirectTo: "https://staging.example.com/api",
            block: false,
            modify: MockRuleModify(setRequestHeaders: ["X-Test": "1"]),
            failure: MockFailure(code: .timeout),
            skipCount: 2,
            stopAfter: 5
        ))
        #expect(id == "noop_0")
        #expect(engine.getRules().isEmpty)
    }
}
