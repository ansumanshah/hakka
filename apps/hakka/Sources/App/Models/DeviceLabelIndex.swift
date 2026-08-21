import HakkaServer

/// Which `BridgeDeviceLabel` produced each captured request, keyed by
/// `NetworkRequest.id`. Kept in lockstep with `TrafficModel.requests` (same
/// ids added and evicted together) rather than folded into `NetworkRequest`
/// itself — device identity is knowledge only the desktop app's bridge hub
/// has, never part of the wire contract, so it lives beside the model
/// instead of on the record.
struct DeviceLabelIndex {
    private var labels: [String: BridgeDeviceLabel] = [:]

    subscript(requestID: String) -> BridgeDeviceLabel? { labels[requestID] }

    mutating func record(requestID: String, label: BridgeDeviceLabel) {
        labels[requestID] = label
    }

    /// Drops entries for ids evicted from `TrafficModel.requests` — without
    /// this the index would grow unbounded even though the ring buffer it
    /// tracks does not.
    mutating func evict(requestIDs: some Sequence<String>) {
        for id in requestIDs { labels.removeValue(forKey: id) }
    }

    mutating func removeAll() {
        labels.removeAll()
    }
}
