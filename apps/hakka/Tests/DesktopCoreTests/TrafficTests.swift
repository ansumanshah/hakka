import Foundation
import HakkaCommon
import Testing
@testable import HakkaDesktopCore

@Suite("TrafficStore ring buffer + stats")
struct TrafficStoreStatsTests {
    @Test
    func evictionMatchesNaiveRecompute() async {
        let capacity = 41
        let store = TrafficStore(capacity: capacity)
        var rng = SeededGenerator(seed: 1_234_567)
        var window: [NetworkRequest] = []

        for i in 0 ..< 350 {
            let req = makeRequest(&rng, index: i)
            await store.append(req)
            window.append(req)
            if window.count > capacity { window.removeFirst() }

            guard i % 13 == 0 || i == 349 else { continue }
            let stats = await store.stats()
            #expect(stats == naiveStats(window))
            let all = await store.all()
            #expect(all.map(\.id) == window.map(\.id))
        }
    }

    @Test
    func clearResetsStats() async {
        let store = TrafficStore(capacity: 10)
        var rng = SeededGenerator(seed: 7)
        for i in 0 ..< 5 { await store.append(makeRequest(&rng, index: i)) }
        await store.clear()
        let stats = await store.stats()
        #expect(stats == TrafficStats(count: 0, errorCount: 0, p50DurationMs: nil, p95DurationMs: nil, totalBytes: 0))
        #expect(await store.count == 0)
    }
}

@Suite("TrafficQueryCompiler + TrafficSort")
struct TrafficQueryFilterTests {
    static let fixtures: [NetworkRequest] = [
        NetworkRequest(
            id: "a", url: "https://api.example.com/users?x=1", method: .get, status: 200, startTime: 1,
            duration: 120, requestBodySize: 10, responseBodySize: 200,
            responseBody: "{\"ok\":true}",
        ),
        NetworkRequest(
            id: "b", url: "https://api.example.com/orders", method: .post, status: 404, startTime: 2,
            duration: 900, requestBodySize: 500, responseBodySize: 50,
            responseBody: "not found",
        ),
        NetworkRequest(
            id: "c", url: "https://cdn.example.net/logo.png", method: .get, status: 500, startTime: 3,
            duration: 40, requestBodySize: 0, responseBodySize: 20000,
            error: "boom",
        ),
    ]

    @Test(arguments: [
        ("2xx", ["a"]), ("4xx", ["b"]), (">=400", ["b", "c"]), ("<500", ["a", "b"]), ("500", ["c"]),
    ] as [(String, [String])])
    func statusDsl(_ dsl: String, _ expectedIds: [String]) {
        let matched = Self.fixtures.filter(TrafficQueryCompiler.compile(TrafficQuery(statusDsl: dsl))).map(\.id)
        #expect(matched == expectedIds)
    }

    /// `>=600`/`>600`/`>=999` used to construct an invalid `ClosedRange`
    /// (lowerBound > 599) and trap. The out-of-range DSL now parses to
    /// `nil`, matching the sibling `<=?` branch's underflow fallback — a
    /// `nil` range means "no status filter" (see `TrafficQueryCompiler`).
    @Test(arguments: [">600", ">=600", ">=999", ">999"])
    func statusDslAboveMaxReturnsNilInsteadOfTrapping(_ dsl: String) {
        #expect(TrafficStatusDsl.parse(dsl) == nil)
    }

    @Test
    func statusDslAtMaxBoundaryStillParses() {
        #expect(TrafficStatusDsl.parse(">=599") == 599 ... 599)
        #expect(TrafficStatusDsl.parse(">598") == 599 ... 599)
    }

    @Test
    func methodFilter() {
        let matched = Self.fixtures.filter(TrafficQueryCompiler.compile(TrafficQuery(method: "post")))
        #expect(matched.map(\.id) == ["b"])
    }

    @Test
    func hostFilter() {
        let matched = Self.fixtures.filter(TrafficQueryCompiler.compile(TrafficQuery(host: "cdn.")))
        #expect(matched.map(\.id) == ["c"])
    }

    @Test
    func durationRange() {
        let query = TrafficQuery(durationMin: 100, durationMax: 500)
        #expect(Self.fixtures.filter(TrafficQueryCompiler.compile(query)).map(\.id) == ["a"])
    }

    @Test
    func sizeMin() {
        let matched = Self.fixtures.filter(TrafficQueryCompiler.compile(TrafficQuery(sizeMin: 10000)))
        #expect(matched.map(\.id) == ["c"])
    }

    @Test
    func substringTokenOnBody() {
        let token = TrafficSearchToken(scope: .body, mode: .substring, value: "not found")
        let matched = Self.fixtures.filter(TrafficQueryCompiler.compile(TrafficQuery(tokens: [token])))
        #expect(matched.map(\.id) == ["b"])
    }

    @Test
    func wildcardTokenOnUrl() {
        let token = TrafficSearchToken(scope: .url, mode: .wildcard, value: "*orders")
        let matched = Self.fixtures.filter(TrafficQueryCompiler.compile(TrafficQuery(tokens: [token])))
        #expect(matched.map(\.id) == ["b"])
    }

    @Test
    func regexTokenNegated() {
        let token = TrafficSearchToken(scope: .url, mode: .regex, value: "cdn", negate: true)
        let matched = Self.fixtures.filter(TrafficQueryCompiler.compile(TrafficQuery(tokens: [token])))
        #expect(matched.map(\.id) == ["a", "b"])
    }

    @Test
    func sortByDurationDescending() {
        let sorted = TrafficSort.sort(Self.fixtures, field: .duration, order: .desc)
        #expect(sorted.map(\.id) == ["b", "a", "c"])
    }

    /// `TrafficStore.query(_:)` is the actor method that actually wires
    /// `TrafficQueryCompiler` + `TrafficSort` together; the tests above only
    /// exercise the compiler/sorter directly against raw arrays. Drive the
    /// store itself so a wiring bug (skipped filter, unconditional sort,
    /// wrong order) would fail here.
    @Test
    func storeQueryFiltersThenSorts() async {
        let store = TrafficStore(capacity: 10)
        await store.append(contentsOf: Self.fixtures)

        let filteredAndSorted = await store.query(TrafficQuery(statusDsl: ">=400", sort: .duration, order: .desc))
        #expect(filteredAndSorted.map(\.id) == ["b", "c"])

        let ascending = await store.query(TrafficQuery(statusDsl: ">=400", sort: .duration, order: .asc))
        #expect(ascending.map(\.id) == ["c", "b"])

        let unsorted = await store.query(TrafficQuery(method: "get"))
        #expect(unsorted.map(\.id) == ["a", "c"])
    }
}

@Suite("RequestDiff")
struct RequestDiffTests {
    @Test
    func diffsStatusHeadersAndBody() {
        let before = NetworkRequest(
            id: "before", url: "https://api.example.com/users/1", method: .get, status: 200, startTime: 1,
            requestHeaders: ["Authorization": ["Bearer old"]],
            responseHeaders: ["Content-Type": ["application/json"], "X-Cache": ["HIT"]],
            responseBody: "line1\nline2\nline3",
        )
        let after = NetworkRequest(
            id: "after", url: "https://api.example.com/users/1", method: .get, status: 304, startTime: 2,
            requestHeaders: ["Authorization": ["Bearer new"]],
            responseHeaders: ["Content-Type": ["application/json"], "ETag": ["\"abc\""]],
            responseBody: "line1\nline2 changed\nline3",
        )

        let diff = RequestDiff.diff(before, after)

        #expect(diff.status.before == 200)
        #expect(diff.status.after == 304)
        #expect(diff.status.changed)
        #expect(diff.requestHeaders.changed.map(\.name) == ["Authorization"])
        #expect(diff.responseHeaders.added.map(\.name) == ["ETag"])
        #expect(diff.responseHeaders.removed.map(\.name) == ["X-Cache"])
        #expect(diff.responseHeaders.changed.isEmpty)
        #expect(diff.responseBody == [
            .unchanged("line1"), .removed("line2"), .added("line2 changed"), .unchanged("line3"),
        ])
    }
}

@Suite("Session + HAR export")
struct TrafficExportTests {
    @Test
    func harExportShape() async throws {
        let store = TrafficStore(capacity: 10)
        await store.append(NetworkRequest(
            id: "har-1", url: "https://api.example.com/ping", method: .get, status: 200,
            startTime: 1_700_000_000_000, duration: 42,
            responseHeaders: ["Content-Type": ["application/json"]],
            requestBodySize: 0, responseBodySize: 2, responseBody: "{}",
        ))

        let harString = try #require(await store.exportHar())
        let json = try #require(try JSONSerialization.jsonObject(with: Data(harString.utf8)) as? [String: Any])
        let log = try #require(json["log"] as? [String: Any])
        #expect(log["version"] as? String == "1.2")
        let entries = try #require(log["entries"] as? [[String: Any]])
        #expect(entries.count == 1)
        let request = try #require(entries[0]["request"] as? [String: Any])
        #expect(request["method"] as? String == "GET")
        #expect(request["url"] as? String == "https://api.example.com/ping")
        let response = try #require(entries[0]["response"] as? [String: Any])
        #expect(response["status"] as? Int == 200)
    }

    @Test
    func sessionRoundTrip() async throws {
        let store = TrafficStore(capacity: 10)
        await store.append(NetworkRequest(id: "s1", url: "https://x.test/a", method: .get, startTime: 1))
        await store.append(NetworkRequest(id: "s2", url: "https://x.test/b", method: .post, startTime: 2))

        #expect(await store.request(id: "s1")?.url == "https://x.test/a")
        #expect(TrafficSession.fileExtension == "hakka-session")

        let session = await store.exportSession(name: "My Capture")
        let decoded = try TrafficSessionCodec.decode(try TrafficSessionCodec.encode(session))
        #expect(decoded.name == "My Capture")
        #expect(decoded.requests.map(\.id) == ["s1", "s2"])

        let imported = TrafficStore(capacity: 10)
        await imported.importSession(decoded)
        #expect(await imported.count == 2)
        #expect(await imported.all().map(\.id) == ["s1", "s2"])
    }

    /// `.hakka-session` files are untrusted input (imported from disk, could
    /// come from a newer/foreign build). `decode` must reject a mismatched
    /// `version` rather than silently misreading the payload.
    @Test
    func decodeRejectsUnsupportedVersion() throws {
        let session = TrafficSession(name: "v-test", requests: [])
        let encoded = try TrafficSessionCodec.encode(session)
        var json = try #require(try JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        json["version"] = 99
        let foreignVersion = try JSONSerialization.data(withJSONObject: json)

        do {
            _ = try TrafficSessionCodec.decode(foreignVersion)
            Issue.record("expected decode to throw unsupportedVersion")
        } catch let error as TrafficSessionCodec.CodecError {
            #expect(error == .unsupportedVersion(99))
        }
    }
}

// MARK: - Test fixtures

/// Deterministic splitmix64 PRNG — a seeded, reproducible source for the
/// property-style eviction test (no seedable generator ships in the stdlib).
private struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed &+ 0x9E37_79B9_7F4A_7C15 }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

private func makeRequest(_ rng: inout SeededGenerator, index: Int) -> NetworkRequest {
    let hasStatus = rng.next() % 5 != 0
    let status = hasStatus ? Int(rng.next() % 500) + 100 : nil
    let hasDuration = rng.next() % 10 != 0
    let duration = hasDuration ? Int64(rng.next() % 3000) : nil
    let hasError = !hasStatus && rng.next() % 2 == 0
    return NetworkRequest(
        id: "req-\(index)",
        url: "https://example.com/path/\(index)",
        method: .get,
        status: status,
        startTime: Int64(index),
        duration: duration,
        requestBodySize: Int64(rng.next() % 4096),
        responseBodySize: Int64(rng.next() % 8192),
        error: hasError ? "boom" : nil,
    )
}

/// Ground truth for the property test — recomputed from scratch on every
/// call, deliberately independent of `TrafficStatsAccumulator`'s incremental
/// bookkeeping so the two can be cross-checked against each other.
private func naiveStats(_ requests: [NetworkRequest]) -> TrafficStats {
    let errorCount = requests.filter { $0.error != nil || ($0.status ?? 0) >= 400 }.count
    let totalBytes = requests.reduce(Int64(0)) { $0 + $1.requestBodySize + $1.responseBodySize }
    let durations = requests.compactMap(\.duration).sorted()
    func percentile(_ rank: Double) -> Int64? {
        guard !durations.isEmpty else { return nil }
        let index = Int((Double(durations.count) * rank).rounded(.up)) - 1
        return durations[max(0, min(durations.count - 1, index))]
    }
    return TrafficStats(
        count: requests.count, errorCount: errorCount,
        p50DurationMs: percentile(0.5), p95DurationMs: percentile(0.95), totalBytes: totalBytes,
    )
}
