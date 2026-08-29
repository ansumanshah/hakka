import HakkaCommon

/// Grouping key for `TrafficQueryCompiler.group(_:by:)` — the
/// `host`/`status`/`method`/`error` subset of `GroupBy` in
/// `packages/hakka-core/src/query/types.ts` that this desktop UI exposes.
/// `trace` and the RN-only `status-class` alias aren't offered: there is no
/// trace picker on the desktop yet, and `status` already means "status
/// class" here — there is no separate exact-code grouping to alias.
public enum TrafficGroupBy: String, Sendable, Equatable, CaseIterable, Identifiable {
    case none, host, status, method, error

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .none: "None"
        case .host: "Host"
        case .status: "Status"
        case .method: "Method"
        case .error: "Error"
        }
    }
}

/// One bucket produced by `TrafficQueryCompiler.group(_:by:)`. `items` keeps
/// whatever order the caller sorted `requests` into before calling `group` —
/// grouping only partitions, it never reorders.
public struct TrafficRequestGroup: Sendable, Identifiable, Equatable {
    public let key: String
    public let label: String
    public let items: [NetworkRequest]
    public var id: String { key }
}

/// Retroactive conformance so a "Sort By" picker can iterate
/// `TrafficSortField.allCases` with a human label and a stable identity —
/// `TrafficQuery.swift` only needs the raw DSL parsing value
/// (`sort:duration`), not display text, so this lives with the other
/// picker-facing additions instead.
extension TrafficSortField: Identifiable {
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .time: "Time"
        case .duration: "Duration"
        case .size: "Size"
        case .status: "Status"
        }
    }
}

extension TrafficQueryCompiler {
    /// Buckets `requests` by `by`, groups appearing in the order their key
    /// first occurs in `requests` — mirrors `groupRequests` in
    /// `packages/hakka-core/src/query/sortGroup.ts`. Grouping never reorders
    /// items: sort `requests` first (see `TrafficSort`) if the items within
    /// each bucket should come out in a particular order. `.none` returns a
    /// single "All" bucket rather than an empty array, so a caller can
    /// always render `group(requests, by: mode).flatMap(\.items)` and get
    /// `requests` back unchanged regardless of the mode.
    public static func group(_ requests: [NetworkRequest], by: TrafficGroupBy) -> [TrafficRequestGroup] {
        guard by != .none else {
            return [TrafficRequestGroup(key: "", label: "All", items: requests)]
        }

        var order: [String] = []
        var buckets: [String: [NetworkRequest]] = [:]
        for request in requests {
            let key = groupKey(request, by: by)
            if buckets[key] == nil {
                order.append(key)
                buckets[key] = []
            }
            buckets[key]?.append(request)
        }
        return order.map { TrafficRequestGroup(key: $0, label: groupLabel($0, by: by), items: buckets[$0] ?? []) }
    }

    private static func groupKey(_ request: NetworkRequest, by: TrafficGroupBy) -> String {
        switch by {
        case .none: return ""
        case .host: return requestHost(request)
        case .status:
            guard let status = request.status else { return "pending" }
            return "\(status / 100)xx"
        case .method: return request.method.rawValue.uppercased()
        case .error: return request.error != nil ? "error" : "ok"
        }
    }

    /// Human-readable bucket title, mirroring `getGroupLabel` in
    /// `sortGroup.ts` — same wording so a request that lands in "2xx
    /// Success" on this platform lands in a bucket titled the same thing on
    /// RN.
    private static func groupLabel(_ key: String, by: TrafficGroupBy) -> String {
        switch by {
        case .none: "All"
        case .host: key.isEmpty ? "Unknown host" : key
        case .status:
            switch key {
            case "1xx": "1xx Informational"
            case "2xx": "2xx Success"
            case "3xx": "3xx Redirect"
            case "4xx": "4xx Client Error"
            case "5xx": "5xx Server Error"
            case "pending": "Pending"
            default: key
            }
        case .method: key
        case .error: key == "error" ? "Errors" : "OK"
        }
    }
}
