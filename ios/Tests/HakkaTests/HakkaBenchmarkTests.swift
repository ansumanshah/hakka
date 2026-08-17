import Testing
@testable import HakkaNetwork
import HakkaCommon
import Foundation

@Suite("Benchmarks")
struct HakkaBenchmarkTests {

    @Test("LogStore throughput — 10000 adds")
    func logStoreThroughput() {
        let store = LogStore(capacity: 500)
        let iterations = 10_000

        let start = CFAbsoluteTimeGetCurrent()
        for i in 0..<iterations {
            store.add(makeRequest(id: "req-\(i)", index: i))
        }
        let elapsed = CFAbsoluteTimeGetCurrent() - start
        let avgUs = (elapsed * 1_000_000) / Double(iterations)

        print("=== iOS LOGSTORE THROUGHPUT ===")
        print("Iterations:       \(iterations)")
        print("Total:            \(String(format: "%.2f", elapsed * 1000)) ms")
        print("Avg per add:      \(String(format: "%.2f", avgUs)) µs")
        print("Store size:       \(store.count) (capped at 500)")

        #expect(avgUs < 100.0, "LogStore.add() avg \(avgUs)µs exceeds 100µs target")
        #expect(store.count == 500)
    }

    @Test("Memory footprint — 500 requests")
    func memoryFootprint() {
        let store = LogStore(capacity: 500)

        // Fill with realistic requests
        for i in 0..<500 {
            store.add(makeRequest(id: "req-\(i)", index: i))
        }

        // Rough estimate: count * estimated per-request size
        // NetworkRequest with headers + body is roughly 500-800 bytes
        let estimatedKB = Double(store.count) * 1.2 // ~1.2KB per request estimated
        print("=== iOS MEMORY FOOTPRINT ===")
        print("Requests stored:  \(store.count)")
        print("Estimated:        \(String(format: "%.0f", estimatedKB)) KB (~\(String(format: "%.1f", estimatedKB / 1024)) MB)")

        #expect(store.count == 500)
    }

    @Test("Export performance — HAR and cURL")
    func exportPerformance() {
        let store = LogStore(capacity: 100)
        for i in 0..<100 {
            store.add(makeRequest(id: "req-\(i)", index: i))
        }
        let requests = store.requests

        // HAR export
        let harStart = CFAbsoluteTimeGetCurrent()
        let har = HarExporter.export(requests)
        let harMs = (CFAbsoluteTimeGetCurrent() - harStart) * 1000

        // cURL export
        let curlStart = CFAbsoluteTimeGetCurrent()
        for req in requests {
            _ = CurlExporter.export(req)
        }
        let curlMs = (CFAbsoluteTimeGetCurrent() - curlStart) * 1000

        print("=== iOS EXPORT PERFORMANCE ===")
        print("HAR (100 reqs):   \(String(format: "%.2f", harMs)) ms")
        print("HAR size:         \((har ?? "").count / 1024) KB")
        print("cURL (100 reqs):  \(String(format: "%.2f", curlMs)) ms")

        #expect(harMs < 100.0, "HAR export exceeds 100ms")
    }

    @Test("LogStore query performance — filtered reads")
    func queryPerformance() {
        let store = LogStore(capacity: 500)
        for i in 0..<500 {
            store.add(makeRequest(id: "req-\(i)", index: i))
        }

        let start = CFAbsoluteTimeGetCurrent()
        let iterations = 1000
        for _ in 0..<iterations {
            _ = store.requests  // snapshot all
        }
        let elapsed = CFAbsoluteTimeGetCurrent() - start
        let avgUs = (elapsed * 1_000_000) / Double(iterations)

        print("=== iOS QUERY PERFORMANCE ===")
        print("store.requests (500 items) x \(iterations)")
        print("Total:            \(String(format: "%.2f", elapsed * 1000)) ms")
        print("Avg per read:     \(String(format: "%.2f", avgUs)) µs")

        #expect(avgUs < 500.0, "Query avg \(avgUs)µs too slow")
    }

    @Test("LogStore metrics summary performance — cached reads")
    func metricsSummaryPerformance() {
        let store = LogStore(capacity: 500)
        for i in 0..<500 {
            store.add(makeRequest(id: "req-\(i)", index: i))
        }

        _ = store.metricsSummary()

        let start = CFAbsoluteTimeGetCurrent()
        let iterations = 10_000
        for _ in 0..<iterations {
            _ = store.metricsSummary()
        }
        let elapsed = CFAbsoluteTimeGetCurrent() - start
        let avgUs = (elapsed * 1_000_000) / Double(iterations)

        print("=== iOS METRICS SUMMARY PERFORMANCE ===")
        print("metricsSummary() (500 items, cached p95) x \(iterations)")
        print("Total:            \(String(format: "%.2f", elapsed * 1000)) ms")
        print("Avg per read:     \(String(format: "%.2f", avgUs)) µs")

        #expect(avgUs < 100.0, "Metrics summary avg \(avgUs)µs too slow")
    }

    private func makeRequest(id: String, index: Int) -> NetworkRequest {
        let body = """
        {"userId":1,"id":\(index),"title":"benchmark test","body":"quia et suscipit recusandae consequuntur"}
        """
        return NetworkRequest(
            id: id,
            url: "https://jsonplaceholder.typicode.com/posts/\(index)",
            method: index % 3 == 0 ? .post : .get,
            status: index % 10 == 0 ? 404 : 200,
            startTime: Int64(Date().timeIntervalSince1970 * 1000),
            duration: Int64.random(in: 50...500),
            requestHeaders: [
                "Content-Type": ["application/json"],
                "Authorization": ["██"],
                "Accept": ["application/json"],
            ],
            responseHeaders: [
                "Content-Type": ["application/json; charset=utf-8"],
                "Cache-Control": ["no-cache"],
            ],
            requestBodySize: index % 3 == 0 ? Int64(body.count) : 0,
            responseBodySize: Int64(body.count),
            requestBody: index % 3 == 0 ? body : nil,
            responseBody: body,
            error: nil,
            source: .urlSession
        )
    }
}
