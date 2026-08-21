import HakkaCommon

/// Split out of `TrafficModel.swift` to hold the 200-line budget, the same
/// way `TrafficModel+Session.swift`/`TrafficModel+NoiseScope.swift` are —
/// this is the "Compare with Selected" pairing, a self-contained concern
/// with no reason to sit next to bridge wiring.
extension TrafficModel {
    /// The pair to compare, oldest first, or nil when no comparison is open.
    /// Ordered by arrival rather than by which row was right-clicked, so the
    /// diff always reads "what changed since", not "what changed backwards".
    var comparison: (before: NetworkRequest, after: NetworkRequest)? {
        guard let baselineID = comparisonBaselineID,
              let selectedID = selectedRequestID,
              baselineID != selectedID,
              let baselineIndex = requests.firstIndex(where: { $0.id == baselineID }),
              let selectedIndex = requests.firstIndex(where: { $0.id == selectedID })
        else { return nil }
        return baselineIndex < selectedIndex
            ? (requests[baselineIndex], requests[selectedIndex])
            : (requests[selectedIndex], requests[baselineIndex])
    }
}
