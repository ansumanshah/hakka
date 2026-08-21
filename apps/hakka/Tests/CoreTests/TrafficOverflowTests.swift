import Foundation
import HakkaCommon
import Testing

@testable import HakkaCore

/// Body sizes arrive as unvalidated `Int64`s — off an unauthenticated local
/// socket, or out of a `.hakka-session` file the user opened. Swift's `+`
/// traps on overflow in release as well as debug, so summing them was enough
/// for one hostile or corrupt record to kill the app.
///
/// The existing property test could never have caught this: it cross-checks
/// the accumulator against a naive recompute that shares the same unguarded
/// sum, so both sides trap together.
@Suite("traffic size overflow")
struct TrafficOverflowTests {
    private func request(id: String, requestBytes: Int64, responseBytes: Int64) -> NetworkRequest {
        NetworkRequest(
            id: id,
            url: "https://example.com/\(id)",
            method: .get,
            status: 200,
            startTime: 0,
            duration: 10,
            requestBodySize: requestBytes,
            responseBodySize: responseBytes,
        )
    }

    @Test("summing Int64.max body sizes saturates instead of trapping")
    func insertDoesNotTrap() {
        var stats = TrafficStatsAccumulator()

        stats.insert(request(id: "a", requestBytes: .max, responseBytes: .max))

        #expect(stats.count == 1)
        #expect(stats.totalBytes == .max)
    }

    @Test("a saturating insert followed by remove leaves a sane total")
    func removeDoesNotTrap() {
        var stats = TrafficStatsAccumulator()
        let hostile = request(id: "a", requestBytes: .max, responseBytes: .max)

        stats.insert(hostile)
        stats.remove(hostile)

        #expect(stats.count == 0)
        #expect(stats.totalBytes >= 0)
    }

    /// A negative size is corrupt input; it must not quietly subtract from the
    /// running total.
    @Test("negative body sizes are clamped to zero")
    func negativeSizesClamped() {
        var stats = TrafficStatsAccumulator()

        stats.insert(request(id: "a", requestBytes: -5000, responseBytes: -1))

        #expect(stats.totalBytes == 0)
    }

    @Test("ordinary sizes still sum exactly")
    func ordinarySizesAreExact() {
        var stats = TrafficStatsAccumulator()

        stats.insert(request(id: "a", requestBytes: 1200, responseBytes: 3400))
        stats.insert(request(id: "b", requestBytes: 100, responseBytes: 200))

        #expect(stats.totalBytes == 4900)
    }

    @Test("removing restores the exact previous total")
    func removeIsExactForOrdinarySizes() {
        var stats = TrafficStatsAccumulator()
        let first = request(id: "a", requestBytes: 1200, responseBytes: 3400)
        let second = request(id: "b", requestBytes: 100, responseBytes: 200)

        stats.insert(first)
        stats.insert(second)
        stats.remove(second)

        #expect(stats.totalBytes == 4600)
    }

    @Test("sorting by size does not trap on a hostile record")
    func sortDoesNotTrap() {
        let requests = [
            request(id: "a", requestBytes: .max, responseBytes: .max),
            request(id: "b", requestBytes: 10, responseBytes: 20),
        ]

        let sorted = TrafficSort.sort(requests, field: .size, order: .desc)

        #expect(sorted.first?.id == "a")
    }

    /// The store is the path a real frame takes: `BridgeHub` → `TrafficModel`
    /// → `append`. This is the end-to-end shape of the reported crash.
    @Test("appending a hostile record to the store does not trap")
    func storeAppendDoesNotTrap() async {
        let store = TrafficStore(capacity: 16)

        await store.append(request(id: "a", requestBytes: .max, responseBytes: 1))
        let stats = await store.stats()

        #expect(stats.count == 1)
        #expect(stats.totalBytes == .max)
    }

    /// The second reported vector: importing a corrupted session file, no
    /// network involved.
    @Test("importing a hostile session does not trap")
    func importDoesNotTrap() async {
        let store = TrafficStore(capacity: 16)

        await store.importSession(TrafficSession(name: "hostile", requests: [
            request(id: "a", requestBytes: .max, responseBytes: .max),
        ]))
        let stats = await store.stats()

        #expect(stats.count == 1)
    }
}
