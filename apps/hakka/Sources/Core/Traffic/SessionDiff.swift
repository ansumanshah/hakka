import HakkaCommon

/// Set-level diff between two `TrafficSession` runs — the same user flow
/// captured before and after a code change. `RequestDiff` already answers
/// "what changed about this one request"; this answers the question a
/// stateless proxy can't, because it has no notion of a session boundary
/// tied to a flow: "what changed about this *flow* as a whole" — which
/// requests were added, removed, reordered, or changed, plus the run-level
/// totals a developer wants at a glance.
///
/// Correspondence — deciding a request in `after` is "the same request" as
/// one in `before` — is the hard part and lives in `SessionCorrespondence`,
/// including an honest account of what its rule gets wrong. This type's job
/// is turning that correspondence into findings and applying noise control
/// (`Options`) so a diff full of timing jitter doesn't bury the real change.
public struct SessionDiff: Sendable, Equatable {
    public let before: TrafficStats
    public let after: TrafficStats
    /// One entry per correspondence key, `before`'s matched/removed entries
    /// in `before`'s run order followed by `after`'s added entries in
    /// `after`'s run order.
    public let entries: [Entry]
    public let options: Options

    public enum Entry: Sendable, Equatable, Identifiable {
        case matched(MatchedPair)
        /// Present in `after` only — a request this run introduced.
        case added(SessionRequestKey, NetworkRequest)
        /// Present in `before` only — a request this run dropped.
        case removed(SessionRequestKey, NetworkRequest)

        public var id: String {
            switch self {
            case let .matched(pair): "matched:\(pair.key)"
            case let .added(key, _): "added:\(key)"
            case let .removed(key, _): "removed:\(key)"
            }
        }
    }

    /// A request present in both runs under the same correspondence key.
    public struct MatchedPair: Sendable, Equatable {
        public let key: SessionRequestKey
        public let before: NetworkRequest
        public let after: NetworkRequest
        public let beforeIndex: Int
        public let afterIndex: Int
        /// Full `RequestDiff` vocabulary (status/headers/body) is reused
        /// rather than re-derived, so a set diff and a single-request diff
        /// never describe the same change two different ways.
        public let diff: RequestDiff
        /// True when this pair fell outside the longest run of pairs that
        /// stayed in relative order across both runs — see
        /// `SessionCorrespondence.lcsAlign`. Independent of content change:
        /// a pair can be reordered with identical bytes (the flow now calls
        /// two endpoints in a different sequence) or reordered *and*
        /// changed, and both facts are worth reading separately.
        public let reordered: Bool
        public let durationChangedBeyondThreshold: Bool
        public let requestBodyShapeChanged: Bool
        public let responseBodyShapeChanged: Bool

        /// Noise control at the pair level: a pair with none of these flags
        /// set produced nothing worth a developer's attention, even though
        /// `diff` may still contain sub-threshold differences (a `Date`
        /// response header, a body value change that doesn't alter shape).
        public var hasNotableChange: Bool {
            reordered
                || diff.status.changed
                || durationChangedBeyondThreshold
                || requestBodyShapeChanged
                || responseBodyShapeChanged
                || !diff.requestHeaders.added.isEmpty
                || !diff.requestHeaders.removed.isEmpty
                || !diff.responseHeaders.added.isEmpty
                || !diff.responseHeaders.removed.isEmpty
        }
    }

    /// Duration noise control. The default combines an absolute floor with
    /// a relative one because either alone is wrong at one end of the
    /// duration range: a fixed floor flags every run of a 20ms healthcheck
    /// whose noise is comparable to its own duration, while a fixed
    /// percentage misses a real regression on a 2s endpoint that grew by
    /// only 15%. The caller can override both.
    public struct Options: Sendable, Equatable {
        /// 50ms sits just above the ~40ms delayed-ACK timer — a common
        /// source of single-digit-to-tens-of-ms jitter between two runs on
        /// the same network path even when nothing about the endpoint
        /// changed. Below this, two runs of an unchanged endpoint routinely
        /// disagree without anything having happened.
        public var absoluteThresholdMs: Int64
        /// 20%: a common "worth investigating" cutover for a latency
        /// regression, applied on top of the absolute floor so a slow
        /// endpoint's proportionally larger jitter doesn't also trip it.
        public var relativeThreshold: Double

        public init(absoluteThresholdMs: Int64 = 50, relativeThreshold: Double = 0.2) {
            self.absoluteThresholdMs = absoluteThresholdMs
            self.relativeThreshold = relativeThreshold
        }

        func changed(before: Int64?, after: Int64?) -> Bool {
            guard let before, let after else { return before != after }
            let delta = abs(after - before)
            let threshold = max(absoluteThresholdMs, Int64((Double(before) * relativeThreshold).rounded()))
            return delta >= threshold
        }
    }

    public static func diff(before: TrafficSession, after: TrafficSession, options: Options = .init()) -> SessionDiff {
        let beforeAssigned = SessionCorrespondence.assignKeys(before.requests)
        let afterAssigned = SessionCorrespondence.assignKeys(after.requests)
        let afterByKey = Dictionary(uniqueKeysWithValues: afterAssigned.enumerated().map { ($1.key, ($1.request, $0)) })
        let matchedKeys = Set(beforeAssigned.map(\.key)).intersection(afterByKey.keys)
        let aligned = SessionCorrespondence.lcsAlign(beforeAssigned.map(\.key), afterAssigned.map(\.key))

        var entries: [Entry] = []
        for (beforeIndex, assigned) in beforeAssigned.enumerated() {
            guard matchedKeys.contains(assigned.key) else {
                entries.append(.removed(assigned.key, assigned.request))
                continue
            }
            let (afterRequest, afterIndex) = afterByKey[assigned.key]!
            let requestDiff = RequestDiff.diff(assigned.request, afterRequest)
            entries.append(.matched(MatchedPair(
                key: assigned.key,
                before: assigned.request,
                after: afterRequest,
                beforeIndex: beforeIndex,
                afterIndex: afterIndex,
                diff: requestDiff,
                reordered: !aligned.contains(assigned.key),
                durationChangedBeyondThreshold: options.changed(before: assigned.request.duration, after: afterRequest.duration),
                requestBodyShapeChanged: BodyShape.changed(before: assigned.request.requestBody, after: afterRequest.requestBody),
                responseBodyShapeChanged: BodyShape.changed(before: assigned.request.responseBody, after: afterRequest.responseBody),
            )))
        }
        for assigned in afterAssigned where !matchedKeys.contains(assigned.key) {
            entries.append(.added(assigned.key, assigned.request))
        }

        return SessionDiff(
            before: Self.stats(for: before.requests),
            after: Self.stats(for: after.requests),
            entries: entries,
            options: options,
        )
    }

    private static func stats(for requests: [NetworkRequest]) -> TrafficStats {
        var accumulator = TrafficStatsAccumulator()
        for request in requests { accumulator.insert(request) }
        return accumulator.snapshot()
    }
}
