import Testing
import HakkaCommon
@testable import HakkaCore

@Suite("TraceStore")
struct TraceStoreTests {
    @Test func aSpanArrivingBeforeItsRequestStillCreatesARenderableTrace() async throws {
        let store = TraceStore()
        let root = try TraceFixtures.span("server-root-span.json")

        await store.addSpan(root)
        let beforeRequest = await store.trace(id: "trace-1")
        #expect(beforeRequest?.spans.count == 1)
        #expect(beforeRequest?.requests.isEmpty == true, "the request genuinely hasn't arrived yet")

        let request = try TraceFixtures.request("root-request.json")
        await store.addRequest(request)
        let afterRequest = await store.trace(id: "trace-1")
        #expect(afterRequest?.requests.count == 1)
        #expect(afterRequest?.spans.count == 1, "the span ingested first must not be lost once the request joins it")
    }

    @Test func aRequestWithNoCorrelationIdIsNotTraced() async {
        let store = TraceStore()
        let untraced = NetworkRequest(url: "https://x.test", method: .get, startTime: 1)

        await store.addRequest(untraced)

        #expect(await store.count == 0)
    }

    @Test func multiTargetIsTrueOnlyWithMoreThanOneParticipantRuntime() async throws {
        let store = TraceStore()
        let request = try TraceFixtures.request("root-request.json") // runtime: client
        await store.addRequest(request)

        let clientOnly = try #require(await store.trace(id: "trace-1"))
        #expect(clientOnly.isMultiTarget == false, "one client hop alone is not a cross-target trace")

        let serverSpan = try TraceFixtures.span("server-root-span.json") // runtime: server
        await store.addSpan(serverSpan)

        let mixed = try #require(await store.trace(id: "trace-1"))
        #expect(mixed.isMultiTarget == true)
    }

    @Test func traceForRequestIDFindsTheOwningTrace() async throws {
        let store = TraceStore()
        let request = try TraceFixtures.request("root-request.json")
        await store.addRequest(request)

        let found = await store.trace(forRequestID: request.id)
        #expect(found?.id == "trace-1")
        #expect(await store.trace(forRequestID: "no-such-request") == nil)
    }

    /// Memory bound, mirroring `TrafficStore`'s ring buffer: the store never
    /// grows past `capacity`, evicting the least-recently-touched trace —
    /// this is this store's whole answer to "when is a trace abandoned"
    /// (see `TraceStore`'s doc comment).
    @Test func overflowingCapacityEvictsTheLeastRecentlyTouchedTrace() async {
        let store = TraceStore(capacity: 2)
        for i in 0..<3 {
            let request = NetworkRequest(id: "r\(i)", url: "https://x.test", method: .get, startTime: Int64(i), correlationId: "trace-\(i)")
            await store.addRequest(request)
        }

        #expect(await store.count == 2)
        #expect(await store.trace(id: "trace-0") == nil, "the first trace was the least recently touched and must be gone")
        #expect(await store.trace(id: "trace-1") != nil)
        #expect(await store.trace(id: "trace-2") != nil)
    }

    @Test func touchingAnExistingTraceRepositionsItRatherThanEvictingItEarly() async {
        let store = TraceStore(capacity: 2)
        let r0 = NetworkRequest(id: "r0", url: "https://x.test", method: .get, startTime: 0, correlationId: "trace-0")
        let r1 = NetworkRequest(id: "r1", url: "https://x.test", method: .get, startTime: 1, correlationId: "trace-1")
        await store.addRequest(r0)
        await store.addRequest(r1)
        // Re-touch trace-0 — it should no longer be the oldest.
        let r0b = NetworkRequest(id: "r0b", url: "https://x.test", method: .get, startTime: 2, correlationId: "trace-0")
        await store.addRequest(r0b)

        let r2 = NetworkRequest(id: "r2", url: "https://x.test", method: .get, startTime: 3, correlationId: "trace-2")
        await store.addRequest(r2)

        #expect(await store.trace(id: "trace-0") != nil, "re-touched before trace-1, so trace-1 should evict first")
        #expect(await store.trace(id: "trace-1") == nil)
    }

    @Test func clearRemovesEverything() async throws {
        let store = TraceStore()
        await store.addRequest(try TraceFixtures.request("root-request.json"))
        await store.clear()
        #expect(await store.count == 0)
    }
}
