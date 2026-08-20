import HakkaCommon

/// Stable sort mirroring `sortRequests` in
/// `packages/hakka-core/src/query/sortGroup.ts`.
///
/// Divergence: TS falls back to `endTime - startTime` when `duration` is
/// absent. The Swift `NetworkRequest` contract has no `endTime` field, so an
/// in-flight request's duration sorts as `0` here.
public enum TrafficSort {
    public static func sort(_ requests: [NetworkRequest], field: TrafficSortField, order: TrafficSortOrder) -> [NetworkRequest] {
        requests.enumerated()
            .sorted { a, b in
                let av = sortValue(a.element, field: field)
                let bv = sortValue(b.element, field: field)
                if av != bv { return order == .asc ? av < bv : av > bv }
                return a.offset < b.offset
            }
            .map(\.element)
    }

    private static func sortValue(_ request: NetworkRequest, field: TrafficSortField) -> Int64 {
        switch field {
        case .time: request.startTime
        case .duration: request.duration ?? 0
        case .size: request.requestBodySize + request.responseBodySize
        case .status: Int64(request.status ?? 0)
        }
    }
}
