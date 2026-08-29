import Foundation
import HakkaCommon
import Testing

@testable import HakkaServer

/// In-memory fake — no `TrafficStore` actor, no ring buffer, no capture
/// pipeline. `MCPTrafficSource` exists precisely so these tools can be
/// driven against fixtures like this one.
private actor FakeTrafficSource: MCPTrafficSource {
    private let requests: [NetworkRequest]

    /// `requests` is stored oldest-first, matching `TrafficStore.all()`'s
    /// documented order — callers here list oldest to newest, same as
    /// they'd arrive off the wire.
    init(_ requests: [NetworkRequest]) { self.requests = requests }

    func allRequests() async -> [NetworkRequest] { requests }
    func request(id: String) async -> NetworkRequest? { requests.first { $0.id == id } }
}

private func fixture(_ id: String, startTime: Int64) -> NetworkRequest {
    NetworkRequest(id: id, url: "https://example.com/\(id)", method: .get, startTime: startTime)
}

@Suite("MCPListRequestsTool")
struct MCPListRequestsToolTests {
    @Test("lists newest-first, default paging")
    func listsNewestFirst() async {
        let source = FakeTrafficSource([fixture("a", startTime: 1), fixture("b", startTime: 2), fixture("c", startTime: 3)])
        let result = await MCPListRequestsTool(source: source).call(.object([:]))
        let payload = decodeJSON(result)
        #expect(payload["total"]?.intValue == 3)
        #expect(payload["count"]?.intValue == 3)
        let ids = payload["requests"]?.arrayValue?.compactMap { $0["id"]?.stringValue }
        #expect(ids == ["c", "b", "a"])
    }

    @Test("limit and offset page through the newest-first list")
    func limitAndOffsetPage() async {
        let source = FakeTrafficSource((1...5).map { fixture("r\($0)", startTime: Int64($0)) })
        let result = await MCPListRequestsTool(source: source).call(.object(["limit": .number(2), "offset": .number(1)]))
        let payload = decodeJSON(result)
        #expect(payload["total"]?.intValue == 5)
        #expect(payload["offset"]?.intValue == 1)
        let ids = payload["requests"]?.arrayValue?.compactMap { $0["id"]?.stringValue }
        // Newest-first order is r5, r4, r3, r2, r1 — offset 1, limit 2 -> r4, r3.
        #expect(ids == ["r4", "r3"])
    }

    @Test("limit is clamped to the documented 1...500 range")
    func limitIsClamped() async {
        let source = FakeTrafficSource([fixture("a", startTime: 1)])
        let result = await MCPListRequestsTool(source: source).call(.object(["limit": .number(0)]))
        let payload = decodeJSON(result)
        // limit 0 clamps up to 1, so the single fixture is still returned.
        #expect(payload["count"]?.intValue == 1)
    }
}

@Suite("MCPGetRequestTool")
struct MCPGetRequestToolTests {
    @Test("returns the matching request")
    func returnsMatchingRequest() async {
        let source = FakeTrafficSource([fixture("target", startTime: 1)])
        let result = await MCPGetRequestTool(source: source).call(.object(["id": .string("target")]))
        #expect(result.isError == false)
        #expect(decodeJSON(result)["id"]?.stringValue == "target")
    }

    @Test("an unknown id is a not_found tool error, not a protocol error")
    func unknownIDIsNotFoundError() async {
        let source = FakeTrafficSource([])
        let result = await MCPGetRequestTool(source: source).call(.object(["id": .string("missing")]))
        #expect(result.isError == true)
        #expect(decodeJSON(result)["error"]?.stringValue == "not_found")
    }

    @Test("a missing id argument is an invalid_params tool error")
    func missingIDArgumentIsInvalidParamsError() async {
        let result = await MCPGetRequestTool(source: FakeTrafficSource([])).call(.object([:]))
        #expect(result.isError == true)
        #expect(decodeJSON(result)["error"]?.stringValue == "invalid_params")
    }
}
