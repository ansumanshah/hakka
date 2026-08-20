import HakkaCommon

/// A structured comparison between two captured requests — Proxyman-style
/// "compare," for answering "why did this response change after my edit."
public struct RequestDiff: Sendable, Equatable {
    public struct StatusDiff: Sendable, Equatable {
        public let before: Int?
        public let after: Int?
        public var changed: Bool { before != after }
    }

    public struct HeaderChange: Sendable, Equatable {
        public let name: String
        public let before: [String]
        public let after: [String]
    }

    public struct HeaderDiff: Sendable, Equatable {
        public let added: [HeaderChange]
        public let removed: [HeaderChange]
        public let changed: [HeaderChange]
    }

    /// The outcome of comparing one body.
    ///
    /// A `NetworkRequest` body is `nil` whenever it was binary or over the
    /// capture cap. Coercing that to `""` made two completely different binary
    /// payloads compare as identical — a compare tool confidently reporting
    /// "no changes" about bytes it never saw. The distinction is now in the
    /// type, so a caller has to decide what to show.
    public enum BodyDiff: Sendable, Equatable {
        /// Neither side captured a body. Whether the bytes differed is
        /// unknowable from the capture — this is not "they matched".
        case notCaptured
        /// One side captured a body and the other did not.
        case availabilityChanged(hadBefore: Bool, hadAfter: Bool)
        case lines([LineDiffEntry])
    }

    public let status: StatusDiff
    public let requestHeaders: HeaderDiff
    public let responseHeaders: HeaderDiff
    public let requestBody: BodyDiff
    public let responseBody: BodyDiff

    public static func diff(_ before: NetworkRequest, _ after: NetworkRequest) -> RequestDiff {
        RequestDiff(
            status: StatusDiff(before: before.status, after: after.status),
            requestHeaders: diffHeaders(before.requestHeaders, after.requestHeaders),
            responseHeaders: diffHeaders(before.responseHeaders, after.responseHeaders),
            requestBody: diffBody(before.requestBody, after.requestBody),
            responseBody: diffBody(before.responseBody, after.responseBody),
        )
    }

    private static func diffBody(_ before: String?, _ after: String?) -> BodyDiff {
        switch (before, after) {
        case (nil, nil): .notCaptured
        case let (before?, after?): .lines(LineDiff.compute(old: before, new: after))
        default: .availabilityChanged(hadBefore: before != nil, hadAfter: after != nil)
        }
    }

    /// Header names are matched case-insensitively (HTTP semantics) but
    /// displayed using whichever side's original casing is available.
    private static func diffHeaders(_ before: [String: [String]], _ after: [String: [String]]) -> HeaderDiff {
        let beforeKeys = Set(before.keys.map { $0.lowercased() })
        let afterKeys = Set(after.keys.map { $0.lowercased() })

        func casedName(_ lower: String, preferring headers: [String: [String]]) -> String {
            headers.keys.first { $0.lowercased() == lower } ?? lower
        }
        func values(_ lower: String, in headers: [String: [String]]) -> [String] {
            headers.first { $0.key.lowercased() == lower }?.value ?? []
        }

        var added: [HeaderChange] = []
        var removed: [HeaderChange] = []
        var changed: [HeaderChange] = []

        for lower in afterKeys.subtracting(beforeKeys).sorted() {
            added.append(HeaderChange(name: casedName(lower, preferring: after), before: [], after: values(lower, in: after)))
        }
        for lower in beforeKeys.subtracting(afterKeys).sorted() {
            removed.append(HeaderChange(name: casedName(lower, preferring: before), before: values(lower, in: before), after: []))
        }
        for lower in beforeKeys.intersection(afterKeys).sorted() {
            let beforeValues = values(lower, in: before)
            let afterValues = values(lower, in: after)
            if beforeValues != afterValues {
                changed.append(HeaderChange(name: casedName(lower, preferring: after), before: beforeValues, after: afterValues))
            }
        }

        return HeaderDiff(added: added, removed: removed, changed: changed)
    }
}
