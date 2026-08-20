import Testing
import Foundation
@testable import HakkaNetwork
import Dispatch
import HakkaCommon

@Suite struct LogStoreTests {
    private func makeRequest(
        id: String = UUID().uuidString,
        startTime: Int64 = 1000,
        status: Int? = nil,
        duration: Int64? = nil,
        responseBodySize: Int64 = 0,
        error: String? = nil
    ) -> NetworkRequest {
        NetworkRequest(
            id: id,
            url: "https://test.com",
            method: .get,
            status: status,
            startTime: startTime,
            duration: duration,
            responseBodySize: responseBodySize,
            error: error
        )
    }

    @Test func addAndCount() {
        let store = LogStore(capacity: 10)
        #expect(store.count == 0)
        store.add(makeRequest())
        #expect(store.count == 1)
    }

    @Test func lookupById() {
        let store = LogStore(capacity: 10)
        let req = makeRequest(id: "test-id")
        store.add(req)
        #expect(store.request(byId: "test-id")?.id == "test-id")
        #expect(store.request(byId: "nonexistent") == nil)
    }

    @Test func ringBufferEviction() {
        let store = LogStore(capacity: 3)
        let r1 = makeRequest(id: "1")
        let r2 = makeRequest(id: "2")
        let r3 = makeRequest(id: "3")
        let r4 = makeRequest(id: "4")

        store.add(r1); store.add(r2); store.add(r3)
        #expect(store.count == 3)

        store.add(r4) // evicts r1
        #expect(store.count == 3)
        #expect(store.request(byId: "1") == nil)
        #expect(store.request(byId: "4") != nil)

        let ids = store.requests.map(\.id)
        #expect(ids == ["2", "3", "4"])
    }

    @Test func clear() {
        let store = LogStore(capacity: 10)
        store.add(makeRequest())
        store.add(makeRequest())
        store.clear()
        #expect(store.count == 0)
        #expect(store.requests.isEmpty)
    }

    @Test func removeOlderThan() {
        let store = LogStore(capacity: 10)
        store.add(makeRequest(id: "old", startTime: 100))
        store.add(makeRequest(id: "new", startTime: 2000))
        store.removeOlderThan(1000)
        #expect(store.request(byId: "old") == nil)
        #expect(store.request(byId: "new") != nil)
        #expect(store.count == 1)
    }

    @Test func threadSafety() {
        let store = LogStore(capacity: 100)
        let group = DispatchGroup()

        for i in 0..<100 {
            let req = makeRequest(id: "\(i)")
            group.enter()
            DispatchQueue.global().async {
                store.add(req)
                _ = store.count
                _ = store.requests
                group.leave()
            }
        }

        // Bounded: an unbounded DispatchGroup wait turns a lost completion into
        // a CI-length hang rather than a test failure.
        if group.wait(timeout: .now() + 10) == .timedOut { Issue.record("concurrent work did not finish") }
        #expect(store.count == 100)
    }

    // MARK: - recent() edge cases

    @Test func recentZeroReturnsEmpty() {
        let store = LogStore(capacity: 10)
        store.add(makeRequest(id: "a"))
        store.add(makeRequest(id: "b"))
        let result = store.recent(0)
        #expect(result.isEmpty)
    }

    @Test func recentOneReturnsNewest() {
        let store = LogStore(capacity: 10)
        store.add(makeRequest(id: "a", startTime: 100))
        store.add(makeRequest(id: "b", startTime: 200))
        store.add(makeRequest(id: "c", startTime: 300))
        let result = store.recent(1)
        #expect(result.count == 1)
        #expect(result[0].id == "c")
    }

    @Test func recentMoreThanStoredReturnsAll() {
        let store = LogStore(capacity: 10)
        store.add(makeRequest(id: "a", startTime: 100))
        store.add(makeRequest(id: "b", startTime: 200))
        let result = store.recent(100)
        #expect(result.count == 2)
        #expect(result[0].id == "b") // newest first
        #expect(result[1].id == "a")
    }

    @Test func recentOnEmptyStore() {
        let store = LogStore(capacity: 10)
        let result = store.recent(5)
        #expect(result.isEmpty)
    }

    // MARK: - removeOlderThan edge cases

    @Test func removeOlderThanOnEmptyStore() {
        let store = LogStore(capacity: 10)
        store.removeOlderThan(1000)
        #expect(store.count == 0)
        #expect(store.requests.isEmpty)
    }

    @Test func removeOlderThanWhenAllNewer() {
        let store = LogStore(capacity: 10)
        store.add(makeRequest(id: "a", startTime: 2000))
        store.add(makeRequest(id: "b", startTime: 3000))
        store.add(makeRequest(id: "c", startTime: 4000))
        store.removeOlderThan(1000)
        #expect(store.count == 3)
        #expect(store.request(byId: "a") != nil)
        #expect(store.request(byId: "b") != nil)
        #expect(store.request(byId: "c") != nil)
    }

    @Test func containsRequestOlderThanTracksEvictionsAndRemovals() {
        let store = LogStore(capacity: 3)
        store.add(makeRequest(id: "a", startTime: 100))
        store.add(makeRequest(id: "b", startTime: 500))
        store.add(makeRequest(id: "c", startTime: 900))

        #expect(store.containsRequestOlderThan(300))

        store.add(makeRequest(id: "d", startTime: 1_200))
        #expect(!store.containsRequestOlderThan(300))
        #expect(store.containsRequestOlderThan(700))

        store.removeOlderThan(700)
        #expect(!store.containsRequestOlderThan(700))
        #expect(store.containsRequestOlderThan(1_000))
    }

    @Test func metricsSummaryTracksEvictionsAndRemovals() {
        let store = LogStore(capacity: 3)
        store.add(makeRequest(id: "ok", startTime: 100, status: 200, duration: 100, responseBodySize: 10))
        store.add(makeRequest(id: "slow", startTime: 200, status: 201, duration: 450, responseBodySize: 20))
        store.add(makeRequest(id: "bad", startTime: 300, status: 503, duration: 250, responseBodySize: 30))
        store.add(makeRequest(id: "failed", startTime: 400, status: nil, duration: 50, responseBodySize: 40, error: "offline"))

        var summary = store.metricsSummary()
        #expect(summary.totalRequests == 3)
        #expect(summary.completedRequests == 3)
        #expect(summary.successCount == 1)
        #expect(summary.errorCount == 2)
        #expect(summary.averageResponseTime == 250)
        #expect(summary.successRate == 1.0 / 3.0)
        #expect(summary.errorRate == 2.0 / 3.0)
        #expect(summary.p95LatencyMs == 450)
        #expect(summary.totalDataTransferred == 90)

        store.removeOlderThan(350)
        summary = store.metricsSummary()
        #expect(summary.totalRequests == 1)
        #expect(summary.completedRequests == 1)
        #expect(summary.successCount == 0)
        #expect(summary.errorCount == 1)
        #expect(summary.averageResponseTime == 50)
        #expect(summary.p95LatencyMs == 50)
        #expect(summary.totalDataTransferred == 40)
    }

    @Test func metricsSummaryCachesP95UntilDurationsChange() {
        let store = LogStore(capacity: 4)
        store.add(makeRequest(id: "fast", status: 200, duration: 10))
        store.add(makeRequest(id: "medium", status: 200, duration: 20))

        #expect(store.metricsSummary().p95LatencyMs == 20)
        #expect(store.metricsSummary().p95LatencyMs == 20)

        store.add(makeRequest(id: "slow", status: 200, duration: 200))
        #expect(store.metricsSummary().p95LatencyMs == 200)

        store.removeOlderThan(10_000)
        #expect(store.metricsSummary().p95LatencyMs == nil)
    }

    @Test func removeOlderThanOnFullWrappedRingBuffer() {
        let store = LogStore(capacity: 3)
        // Fill beyond capacity to wrap the ring buffer
        store.add(makeRequest(id: "1", startTime: 100))
        store.add(makeRequest(id: "2", startTime: 200))
        store.add(makeRequest(id: "3", startTime: 300))
        store.add(makeRequest(id: "4", startTime: 400)) // evicts "1"
        store.add(makeRequest(id: "5", startTime: 500)) // evicts "2"

        // Buffer now: [4, 5, 3] with head wrapped around
        #expect(store.count == 3)

        // Remove everything older than 400 => only 4, 5 survive
        store.removeOlderThan(400)
        #expect(store.count == 2)
        #expect(store.request(byId: "3") == nil)
        #expect(store.request(byId: "4") != nil)
        #expect(store.request(byId: "5") != nil)
    }

    @Test func removeOlderThanRemovesAll() {
        let store = LogStore(capacity: 10)
        store.add(makeRequest(id: "a", startTime: 100))
        store.add(makeRequest(id: "b", startTime: 200))
        store.removeOlderThan(9999)
        #expect(store.count == 0)
        #expect(store.requests.isEmpty)
    }

    // MARK: - Concurrent add + query thread safety

    @Test func concurrentAddAndQuery() {
        let store = LogStore(capacity: 200)
        let group = DispatchGroup()

        // Writers
        for i in 0..<100 {
            let req = makeRequest(id: "w\(i)", startTime: Int64(i * 10))
            group.enter()
            DispatchQueue.global().async {
                store.add(req)
                group.leave()
            }
        }

        // Concurrent readers
        for _ in 0..<50 {
            group.enter()
            DispatchQueue.global().async {
                _ = store.recent(10)
                _ = store.query(filter: RequestFilter())
                _ = store.request(byId: "w0")
                group.leave()
            }
        }

        // Bounded: an unbounded DispatchGroup wait turns a lost completion into
        // a CI-length hang rather than a test failure.
        if group.wait(timeout: .now() + 10) == .timedOut { Issue.record("concurrent work did not finish") }
        #expect(store.count == 100)
    }

    // MARK: - Ring buffer ordering after wrap

    @Test func orderingPreservedAfterWrap() {
        let store = LogStore(capacity: 3)
        store.add(makeRequest(id: "1", startTime: 100))
        store.add(makeRequest(id: "2", startTime: 200))
        store.add(makeRequest(id: "3", startTime: 300))
        store.add(makeRequest(id: "4", startTime: 400))

        let all = store.requests
        #expect(all.map(\.id) == ["2", "3", "4"])
    }
}
