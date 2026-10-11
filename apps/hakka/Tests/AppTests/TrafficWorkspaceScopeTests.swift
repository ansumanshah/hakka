import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

@Suite("Traffic workspace scopes")
@MainActor
struct TrafficWorkspaceScopeTests {
    private func model() -> TrafficModel {
        let model = TrafficModel()
        model.setBuffer([
            NetworkRequest(id: "a", url: "https://api.fixture.local/a", method: .get, status: 200, startTime: 0, source: .http),
            NetworkRequest(id: "b", url: "https://api.fixture.local/b", method: .post, status: 500, startTime: 1, source: .jsFetch),
            NetworkRequest(id: "c", url: "https://other-api.fixture.local/c", method: .get, status: 200, startTime: 2, source: .http),
        ], stats: TrafficStats(count: 3, errorCount: 1, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0))
        return model
    }

    @Test func exactDomainAndSourceComposeWithSearchWithoutDroppingCapture() {
        let model = model()
        model.selectedDomain = "api.fixture.local"
        model.selectedSource = .http
        model.searchText = "method:GET"
        #expect(model.visibleRequests.map(\.id) == ["a"])
        #expect(model.requests.count == 3)
        #expect(model.domainCounts.first { $0.domain == "api.fixture.local" }?.count == 2)
    }

    @Test func errorsAndResetComposeWithNavigation() {
        let model = model()
        model.selectedDomain = "api.fixture.local"
        model.errorsOnly = true
        #expect(model.visibleRequests.map(\.id) == ["b"])
        model.resetWorkspaceFilters()
        #expect(model.visibleRequests.map(\.id) == ["c", "b", "a"])
    }
}
