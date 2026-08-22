import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// `hasEverReceivedTraffic` gates Artboard 6's `FirstRunEmptyView` versus the
/// generic "Waiting for traffic" empty state in `LiveTrafficListView` — see
/// that flag's doc comment on `TrafficModel`. Seeds via `setBuffer` rather
/// than a live `BridgeServer`, same rationale as
/// `TrafficModelDeviceFilterTests`: this is pure state-tracking logic, not
/// wire behavior.
@Suite("TrafficModel hasEverReceivedTraffic")
@MainActor
struct TrafficModelHasEverReceivedTrafficTests {
    private func request(id: String) -> NetworkRequest {
        NetworkRequest(id: id, url: "https://api.example.com/\(id)", method: .get, status: 200, startTime: 0)
    }

    @Test func freshModelHasNeverReceivedTraffic() {
        let model = TrafficModel()
        #expect(!model.hasEverReceivedTraffic)
    }

    @Test func settingANonEmptyBufferMarksItReceived() {
        let model = TrafficModel()
        model.setBuffer([request(id: "a")], stats: TrafficStats(count: 1, errorCount: 0, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0))
        #expect(model.hasEverReceivedTraffic)
    }

    @Test func settingAnEmptyBufferLeavesItUnreceived() {
        let model = TrafficModel()
        model.setBuffer([], stats: TrafficStats(count: 0, errorCount: 0, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0))
        #expect(!model.hasEverReceivedTraffic)
    }

    /// The load-bearing case: `clear()` must empty `requests` without
    /// resetting the flag, or a cleared session would wrongly fall back to
    /// the first-run onboarding pitch instead of the generic empty state.
    @Test func clearingAfterTrafficArrivedKeepsTheFlagSet() async {
        let model = TrafficModel()
        model.setBuffer([request(id: "a")], stats: TrafficStats(count: 1, errorCount: 0, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0))
        #expect(model.hasEverReceivedTraffic)

        await model.clear()

        #expect(model.requests.isEmpty)
        #expect(model.hasEverReceivedTraffic)
    }
}
