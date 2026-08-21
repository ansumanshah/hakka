import Foundation
import HakkaCommon
import HakkaCore

/// Pushes typed control commands from the desktop to every device connected
/// to the bridge hub — the local counterpart of the hub's relay path. A
/// relayed frame arrives from a peer and goes back out to the others
/// verbatim; this sender produces the same kind of bytes locally
/// (`ControlCommandEncoder` + `ControlFrameEncoder`) and hands them to
/// `BridgeHub.broadcast`, so desktop-originated and peer-originated control
/// frames are byte-indistinguishable on the wire.
///
/// `send` is loud about anything that would silently corrupt: malformed
/// rule fields throw during encoding, the finished payload is re-parsed
/// with the device-side `parseControlCommand` (a frame a device would drop
/// is a sender bug — `ControlWireError.roundTripRejected`, the same
/// self-check the Node MCP dispatcher runs), and the frame byte limit is
/// enforced before the first write. Delivery itself is fire-and-forget like
/// the wire: there is no ack, so the return value counts the peers written
/// to — `0` means no devices were connected, which is a condition to
/// surface, not an error to throw.
public struct ControlSender: Sendable {
    private let hub: BridgeHub

    public init(hub: BridgeHub) {
        self.hub = hub
    }

    /// Encode, self-validate, and deliver `command` to every connected
    /// device. Returns the number of peers the frame was written to.
    @discardableResult
    public func send(
        _ command: ControlCommand,
        maxFrameBytes: Int = BridgeWireLimits.maxFrameBytes
    ) async throws -> Int {
        let payload = try ControlCommandEncoder.payloadObject(for: command)
        guard parseControlCommand(payload) != nil else {
            throw ControlWireError.roundTripRejected
        }
        let frame = try ControlFrameEncoder.encodeFrameText(wrapping: payload)
        let byteCount = frame.utf8.count
        guard byteCount <= maxFrameBytes else {
            throw ControlWireError.oversizedFrame(byteCount: byteCount, limit: maxFrameBytes)
        }
        return await hub.broadcast(frame)
    }
}
