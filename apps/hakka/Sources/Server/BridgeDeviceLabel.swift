import Foundation

/// A human-facing, honestly-derivable identity for one connected bridge peer.
///
/// `BridgePeerID` is a UUID — useless to show a person. The wire protocol
/// (`packages/hakka-bridge/src/protocol.ts`, mirrored by
/// `BridgeWireFrame.swift`) carries only `{type, payload}`: no device name,
/// app name, or bundle id ever crosses the socket, and this file
/// deliberately does not add one — that would be a wire-contract change,
/// which has to land atomically across TypeScript/Swift/Kotlin with shared
/// fixtures, not something the desktop app can decide alone.
///
/// The one thing the hub does know honestly is *how many distinct peers
/// have connected, and in what order*. `BridgeDeviceLabeler` turns that into
/// "Device 1", "Device 2", … — an anonymous but stable-for-the-connection's-
/// lifetime handle, assigned the first time a peer's frame is observed
/// (not at `NWConnection` `.ready`: `BridgeConnection.start` fires
/// `hub.addPeer` and the per-connection ingest loop as two independently
/// scheduled `Task`s with no ordering guarantee between them — see that
/// file's own comment on the same hazard for frame ordering — so "first
/// frame ingested" is the only deterministic hook available).
public typealias BridgeDeviceLabel = String

/// Assigns and remembers `BridgeDeviceLabel`s for the peers a `BridgeHub`
/// has seen. Not an actor: it is only ever touched from inside `BridgeHub`,
/// which is already serializing access as an actor itself.
public struct BridgeDeviceLabeler: Sendable {
    private var labels: [BridgePeerID: BridgeDeviceLabel] = [:]
    private var nextNumber = 1

    public init() {}

    /// The label for `peerID`, assigning the next free number the first
    /// time this peer is seen.
    ///
    /// Deliberately NOT sticky across a reconnect: a dropped connection
    /// gets a brand-new `BridgePeerID`, and there is no honest way to prove
    /// "this is the same physical device as before" — the only candidate
    /// signal, the peer's IP, is worthless here because `BridgeServer`
    /// binds loopback-only by default, so a simulator and every other local
    /// SDK all connect from `127.0.0.1` and would collide. Reassigning
    /// "Device 1" to whichever peer happens to reconnect first would be a
    /// *guess* dressed up as a fact — actively misleading in exactly the
    /// multi-device scenario this feature exists for. A fresh label on
    /// reconnect never lies about which device produced a row; the cost is
    /// that a device's number can climb across a session if it drops and
    /// reconnects, which is a smaller sin than silent misattribution.
    @discardableResult
    public mutating func label(for peerID: BridgePeerID) -> BridgeDeviceLabel {
        if let existing = labels[peerID] { return existing }
        let assigned = "Device \(nextNumber)"
        nextNumber += 1
        labels[peerID] = assigned
        return assigned
    }
}
