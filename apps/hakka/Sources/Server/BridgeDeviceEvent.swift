import Foundation

/// One connect/disconnect transition for a bridge peer, in the order
/// `BridgeHub` observes it. Powers the desktop app's device sidebar (see
/// `TrafficModel+Devices.swift`) without adding a second source of truth for
/// "who's connected" — `BridgeHub.peers` already tracks that; this just lets
/// the app observe the transitions instead of polling `peerCount`.
///
/// Carries only `BridgePeerID`, never a `BridgeDeviceLabel`: a peer's label
/// isn't assigned until its first frame is ingested (see
/// `BridgeDeviceLabeler`'s doc comment for why), which can race this event
/// either way. The app pairs a `connected` event with the label from
/// `CapturedRequest.deviceLabel` once traffic actually starts flowing, and
/// handles both possible arrival orders — see
/// `TrafficModel.consumeDeviceEvents`/`attributeToDevice`.
public enum BridgeDeviceEvent: Sendable, Equatable {
    case connected(BridgePeerID)
    case disconnected(BridgePeerID)
}
