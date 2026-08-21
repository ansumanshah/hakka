import HakkaCommon
import Testing
@testable import HakkaCore

@Suite("SessionDiff")
struct SessionDiffTests {
    /// The most important case: two runs of the exact same flow should
    /// report nothing worth a developer's attention, even though the diff
    /// still produces one `.matched` entry per request.
    @Test
    func identicalRunsProduceNoNotableFindings() {
        let requests = [
            req("a", "https://api.example.com/orders", .get, status: 200, start: 1),
            req("b", "https://api.example.com/orders/1", .get, status: 200, start: 2),
        ]
        let before = TrafficSession(name: "before", requests: requests)
        let after = TrafficSession(name: "after", requests: requests)

        let diff = SessionDiff.diff(before: before, after: after)

        #expect(diff.entries.count == 2)
        for entry in diff.entries {
            guard case let .matched(pair) = entry else {
                Issue.record("expected only matched entries for identical runs")
                continue
            }
            #expect(!pair.hasNotableChange)
            #expect(!pair.reordered)
        }
        #expect(diff.before.count == diff.after.count)
        #expect(diff.before.errorCount == diff.after.errorCount)
    }

    @Test
    func addedRequestIsReportedAsAdded() {
        let before = TrafficSession(name: "before", requests: [
            req("a", "https://api.example.com/health", .get, status: 200, start: 1),
        ])
        let after = TrafficSession(name: "after", requests: [
            req("a", "https://api.example.com/health", .get, status: 200, start: 1),
            req("b", "https://api.example.com/orders", .post, status: 201, start: 2),
        ])

        let diff = SessionDiff.diff(before: before, after: after)

        let added = diff.entries.compactMap { entry -> NetworkRequest? in
            if case let .added(_, request) = entry { request } else { nil }
        }
        #expect(added.map(\.id) == ["b"])
        #expect(!diff.entries.contains { if case .removed = $0 { true } else { false } })
    }

    @Test
    func removedRequestIsReportedAsRemoved() {
        let before = TrafficSession(name: "before", requests: [
            req("a", "https://api.example.com/health", .get, status: 200, start: 1),
            req("b", "https://api.example.com/orders", .post, status: 201, start: 2),
        ])
        let after = TrafficSession(name: "after", requests: [
            req("a", "https://api.example.com/health", .get, status: 200, start: 1),
        ])

        let diff = SessionDiff.diff(before: before, after: after)

        let removed = diff.entries.compactMap { entry -> NetworkRequest? in
            if case let .removed(_, request) = entry { request } else { nil }
        }
        #expect(removed.map(\.id) == ["b"])
        #expect(!diff.entries.contains { if case .added = $0 { true } else { false } })
    }

    /// Two calls to the same endpoint in one run must stay distinct — the
    /// ordinal in `SessionRequestKey` is what makes that possible. Only the
    /// second call's status changes; the first must read as unchanged.
    @Test
    func sameEndpointCalledTwiceOnlyOneChanging() {
        let before = TrafficSession(name: "before", requests: [
            req("a1", "https://api.example.com/orders", .get, status: 200, start: 1),
            req("a2", "https://api.example.com/orders", .get, status: 200, start: 2),
        ])
        let after = TrafficSession(name: "after", requests: [
            req("b1", "https://api.example.com/orders", .get, status: 200, start: 1),
            req("b2", "https://api.example.com/orders", .get, status: 500, start: 2),
        ])

        let diff = SessionDiff.diff(before: before, after: after)

        let pairs = diff.entries.compactMap { entry -> SessionDiff.MatchedPair? in
            if case let .matched(pair) = entry { pair } else { nil }
        }
        #expect(pairs.count == 2)
        #expect(pairs[0].key.ordinal == 1)
        #expect(!pairs[0].hasNotableChange)
        #expect(pairs[1].key.ordinal == 2)
        #expect(pairs[1].hasNotableChange)
        #expect(pairs[1].diff.status.changed)
    }

    @Test
    func durationChangeBelowThresholdIsNotFlagged() {
        // Δ=20ms against a 500ms baseline: below both the 50ms floor and
        // the 20% relative cutover (100ms) — noise, not a regression.
        let before = TrafficSession(name: "before", requests: [
            req("a", "https://api.example.com/orders", .get, status: 200, start: 1, duration: 500),
        ])
        let after = TrafficSession(name: "after", requests: [
            req("b", "https://api.example.com/orders", .get, status: 200, start: 1, duration: 520),
        ])

        let diff = SessionDiff.diff(before: before, after: after)

        guard case let .matched(pair)? = diff.entries.first else {
            Issue.record("expected a matched pair")
            return
        }
        #expect(!pair.durationChangedBeyondThreshold)
        #expect(!pair.hasNotableChange)
    }

    @Test
    func durationChangeAboveThresholdIsFlagged() {
        // Δ=150ms against a 500ms baseline: past the 100ms relative
        // cutover (20% of 500ms) — a real slowdown, not jitter.
        let before = TrafficSession(name: "before", requests: [
            req("a", "https://api.example.com/orders", .get, status: 200, start: 1, duration: 500),
        ])
        let after = TrafficSession(name: "after", requests: [
            req("b", "https://api.example.com/orders", .get, status: 200, start: 1, duration: 650),
        ])

        let diff = SessionDiff.diff(before: before, after: after)

        guard case let .matched(pair)? = diff.entries.first else {
            Issue.record("expected a matched pair")
            return
        }
        #expect(pair.durationChangedBeyondThreshold)
        #expect(pair.hasNotableChange)
    }

    /// `/orders/12345` and `/orders/67890` are different URLs but the same
    /// logical endpoint — path normalization must line them up rather than
    /// reporting one removed and a different one added.
    @Test
    func pathWithEmbeddedIdMatchesAcrossRuns() {
        let before = TrafficSession(name: "before", requests: [
            req("a", "https://api.example.com/orders/12345", .get, status: 200, start: 1),
        ])
        let after = TrafficSession(name: "after", requests: [
            req("b", "https://api.example.com/orders/67890", .get, status: 200, start: 1),
        ])

        let diff = SessionDiff.diff(before: before, after: after)

        #expect(diff.entries.count == 1)
        guard case let .matched(pair)? = diff.entries.first else {
            Issue.record("expected the two differently-id'd requests to correspond")
            return
        }
        #expect(pair.key.normalizedPath == "/orders/:id")
        #expect(pair.before.id == "a")
        #expect(pair.after.id == "b")
    }
}

private func req(
    _ id: String,
    _ url: String,
    _ method: HttpMethod,
    status: Int?,
    start: Int64,
    duration: Int64? = nil,
) -> NetworkRequest {
    NetworkRequest(id: id, url: url, method: method, status: status, startTime: start, duration: duration)
}
