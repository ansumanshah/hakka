import HakkaServer

/// One bridge peer as the sidebar shows it — live connection state, kept
/// separate from the traffic tally attributed to it (see
/// `TrafficModel.deviceSummaries`, which computes that tally fresh from
/// `requests`/`deviceIndex` rather than storing it here).
///
/// A disconnected device is not deleted: `TrafficModel.consumeDeviceEvents`
/// flips `isConnected` to `false` and leaves the entry (and its captured
/// traffic) exactly where it was, unless it never sent a single frame — see
/// that method for why an unlabeled device is the one case removed instead.
struct ConnectedDevice: Identifiable, Equatable {
    let peerID: BridgePeerID
    /// `nil` until this peer's first frame is ingested — a connection
    /// exists before that, but `BridgeDeviceLabeler` deliberately doesn't
    /// assign "Device N" until then (see `BridgeDeviceLabel.swift`).
    var label: BridgeDeviceLabel?
    var isConnected: Bool

    var id: BridgePeerID { peerID }

    /// What the sidebar row shows in place of a label that doesn't exist
    /// yet — never invents a number, since that number is the one honesty
    /// guarantee this feature has to keep.
    var displayName: String { label ?? "Connecting…" }
}
