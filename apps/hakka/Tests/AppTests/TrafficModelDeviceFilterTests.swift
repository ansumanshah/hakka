import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// `device:` has no reach into `TrafficQueryCompiler` (device identity isn't
/// on `NetworkRequest` — see `DeviceLabelIndex`), so `TrafficModel` applies
/// it itself in `visibleRequests`. This is the one place that logic is
/// actually exercised; `TrafficQueryParserTests` only covers that the term
/// parses. Seeds state directly via `setBuffer`/`deviceIndex` rather than a
/// live `BridgeServer` — `RulesModelTests` documents why that needs a real
/// socket and isn't worth it for a pure filtering check.
@Suite("TrafficModel device filter")
@MainActor
struct TrafficModelDeviceFilterTests {
    private func request(id: String) -> NetworkRequest {
        NetworkRequest(id: id, url: "https://api.example.com/\(id)", method: .get, status: 200, startTime: 0)
    }

    private func seeded() -> TrafficModel {
        let model = TrafficModel()
        model.setBuffer(
            [request(id: "a"), request(id: "b")],
            stats: TrafficStats(count: 2, errorCount: 0, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0),
        )
        model.deviceIndex.record(requestID: "a", label: "Device 1")
        model.deviceIndex.record(requestID: "b", label: "Device 2")
        return model
    }

    @Test func deviceTermKeepsOnlyTheMatchingDevice() {
        let model = seeded()
        model.searchText = "device:1"
        #expect(model.visibleRequests.map(\.id) == ["a"])
    }

    @Test func negatedDeviceTermExcludesThatDevice() {
        let model = seeded()
        model.searchText = "-device:1"
        #expect(model.visibleRequests.map(\.id) == ["b"])
    }

    @Test func requestNeverAttributedToADeviceFailsAPositiveDeviceFilter() {
        let model = seeded()
        model.setBuffer(
            model.requests + [request(id: "c")],
            stats: model.stats,
        )
        // "c" is deliberately never recorded in `deviceIndex` — mirrors a
        // request restored from an imported session.
        model.searchText = "device:1"
        #expect(!model.visibleRequests.map(\.id).contains("c"))
    }
}
