import Foundation
import HakkaCommon

/// Wraps an encoded control payload in the bridge frame envelope pinned by
/// `packages/hakka-bridge/src/protocol.ts` (`BridgeControlMessage`):
/// `{"type":"control","payload":<payload>}`. Field names `type` and
/// `payload` are the contract; any peer on the bridge (device runtimes, the
/// Node hub, the MCP server) accepts the result — the hub routes these
/// frames verbatim and the receiving device validates the inner payload
/// with `parseControlCommand`.
///
/// Byte note: keys are sorted for deterministic output, and Apple's
/// `JSONSerialization` escapes `/` as `\/` where other runtimes' serializers
/// do not. Both spellings are the same JSON — every parser in the fleet
/// (`JSON.parse`, `JSONSerialization`, Android's parser) decodes them
/// identically — so the difference is cosmetic and pinned as-is by the
/// byte-compat tests rather than worked around with fragile string surgery.
public enum ControlFrameEncoder {
    /// The envelope's `type` value. Spelled as a literal with this doc
    /// instead of referencing `BridgeFrameKind` (HakkaServer) because
    /// HakkaCore must stay independent of the server target.
    private static let controlFrameType = "control"

    /// The full WebSocket text frame for `command` — the exact bytes to
    /// write to a connected peer.
    public static func encodeFrameText(for command: ControlCommand) throws -> String {
        try encodeFrameText(wrapping: ControlCommandEncoder.payloadObject(for: command))
    }

    /// The full WebSocket text frame around an already-validated payload
    /// object (as produced by `ControlCommandEncoder.payloadObject`), so a
    /// sender that has already validated/round-tripped the payload does not
    /// rebuild it.
    public static func encodeFrameText(wrapping payloadObject: [String: Any]) throws -> String {
        let envelope: [String: Any] = [
            "type": controlFrameType,
            "payload": payloadObject,
        ]
        do {
            let data = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
            guard let text = String(data: data, encoding: .utf8) else {
                throw ControlWireError.encodingFailed("frame was not valid UTF-8")
            }
            return text
        } catch let error as ControlWireError {
            throw error
        } catch {
            throw ControlWireError.encodingFailed(String(describing: error))
        }
    }
}
