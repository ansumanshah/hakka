import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// `TrafficModel.visibleRequests` is where a muted host actually stops
/// rendering; `NoiseScopeStoreTests` covers the rule model in isolation.
/// Seeds via `setBuffer` rather than a live `BridgeServer` — same reasoning
/// as `TrafficModelDeviceFilterTests`.
@Suite("TrafficModel noise scope")
@MainActor
struct TrafficModelNoiseScopeTests {
    private func request(id: String, host: String, status: Int?) -> NetworkRequest {
        NetworkRequest(id: id, url: "https://\(host)/\(id)", method: .get, status: status, startTime: 0)
    }

    private func seeded() -> TrafficModel {
        let model = TrafficModel()
        model.setBuffer(
            [
                request(id: "a", host: "api.example.com", status: 200),
                request(id: "b", host: "chatty.example.com", status: 200),
                request(id: "c", host: "chatty.example.com", status: 500),
            ],
            stats: TrafficStats(count: 3, errorCount: 1, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0),
        )
        return model
    }

    @Test func mutedHostIsRemovedFromVisibleRequests() {
        let model = seeded()
        model.noiseScope.mute(host: "chatty.example.com")
        #expect(model.visibleRequests.map(\.id) == ["a"])
    }

    @Test func hiddenRowsAreStillTallied() {
        let model = seeded()
        model.noiseScope.mute(host: "chatty.example.com")
        #expect(model.hiddenByNoiseScopeCount == 2)
    }

    @Test func aHiddenErroringRowStillCountsAsAnError() {
        let model = seeded()
        model.noiseScope.mute(host: "chatty.example.com")
        // "b" is a healthy 200, "c" is a 500 — only "c" should count.
        #expect(model.hiddenNoiseScopeErrorCount == 1)
    }

    @Test func clearingTheScopeRestoresEveryRow() {
        let model = seeded()
        model.noiseScope.mute(host: "chatty.example.com")
        #expect(model.visibleRequests.count == 1)

        model.noiseScope.clear()
        #expect(model.visibleRequests.count == 3)
        #expect(model.hiddenByNoiseScopeCount == 0)
        #expect(model.hiddenNoiseScopeErrorCount == 0)
    }

    @Test func noActiveScopeMeansNothingIsHiddenOrTallied() {
        let model = seeded()
        #expect(model.visibleRequests.count == 3)
        #expect(model.hiddenByNoiseScopeCount == 0)
        #expect(model.hiddenNoiseScopeErrorCount == 0)
    }
}
