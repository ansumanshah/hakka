import Foundation
import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// `TrafficModel.errorsOnly` — the toolbar's quick filter — and how it
/// composes with `searchText` and `noiseScope` in `visibleRequests`. Seeds
/// via `setBuffer` rather than a live `BridgeServer`, same reasoning as
/// `TrafficModelDeviceFilterTests`.
@Suite("TrafficModel errors only")
@MainActor
struct TrafficModelErrorsOnlyTests {
    private func request(id: String, host: String = "api.example.com", status: Int?, error: String? = nil) -> NetworkRequest {
        NetworkRequest(id: id, url: "https://\(host)/\(id)", method: .get, status: status, startTime: 0, error: error)
    }

    private func isolatedScope() -> NoiseScopeStore {
        NoiseScopeStore(defaults: UserDefaults(suiteName: "hakka.tests.\(UUID().uuidString)")!)
    }

    private func seeded() -> TrafficModel {
        let model = TrafficModel(noiseScope: isolatedScope())
        model.setBuffer(
            [
                request(id: "ok", status: 200),
                request(id: "warn", status: 404),
                request(id: "err", status: 500),
                request(id: "transport", status: nil, error: "timed out"),
            ],
            stats: TrafficStats(count: 4, errorCount: 2, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0),
        )
        return model
    }

    @Test func offShowsEveryRow() {
        let model = seeded()
        #expect(model.visibleRequests.count == 4)
    }

    @Test func onKeepsOnly4xx5xxAndTransportFailures() {
        let model = seeded()
        model.errorsOnly = true
        #expect(Set(model.visibleRequests.map(\.id)) == ["warn", "err", "transport"])
    }

    @Test func composesWithSearchAsANarrowingFilterNotAReplacement() {
        let model = seeded()
        model.errorsOnly = true
        model.searchText = "err"
        #expect(model.visibleRequests.map(\.id) == ["err"])
    }

    @Test func composesWithNoiseScopeInsteadOfOverridingIt() {
        let model = seeded()
        model.errorsOnly = true
        model.noiseScope.mute(host: "api.example.com")
        // Every row lives on the muted host, so the scope hides all of them
        // regardless of severity — errorsOnly narrows what's left, it
        // cannot bring a muted row back.
        #expect(model.visibleRequests.isEmpty)
    }

    @Test func togglingOffRestoresWhateverSearchAndScopeAlreadyShowed() {
        let model = seeded()
        model.searchText = "warn"
        model.errorsOnly = true
        #expect(model.visibleRequests.map(\.id) == ["warn"])

        model.errorsOnly = false
        #expect(model.visibleRequests.map(\.id) == ["warn"])
    }

    @Test func noiseScopePillCountIsUnaffectedByErrorsOnly() {
        let model = seeded()
        model.noiseScope.mute(host: "api.example.com")
        let hiddenBefore = model.hiddenByNoiseScopeCount

        model.errorsOnly = true
        #expect(model.hiddenByNoiseScopeCount == hiddenBefore)
    }
}
