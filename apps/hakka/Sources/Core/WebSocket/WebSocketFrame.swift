import Foundation
import HakkaCommon

/// Frame opcode vocabulary, per the roadmap's Rockxy reference
/// (`WebSocketFrameData`). `URLSessionWebSocketTransport` only ever produces
/// `.text`/`.binary`/`.close` in practice: protocol-level pings the server
/// sends are answered by the OS below the app layer and never reach
/// `URLSessionWebSocketTask.receive()`, and continuation frames are
/// reassembled beneath that same public API. `.ping`/`.pong`/
/// `.continuation` still exist in the enum so the vocabulary is complete for
/// any transport that *can* observe them, and so `WebSocketCaptureSession`'s
/// capping/ordering behavior is proven against the whole opcode set in
/// tests, not just the two cases this transport happens to emit.
public enum WebSocketOpcode: String, Sendable, Equatable, CaseIterable, Codable {
    case text
    case binary
    case ping
    case pong
    case close
    case continuation
}

/// A single frame observed on a desktop-initiated WebSocket connection.
/// Field names deliberately mirror `HakkaCommon.WsMessage` — the SDK's
/// passive-capture model for WebSocket traffic — so the desktop's live
/// console and a device's captured `messages` never render the same
/// underlying idea two different ways: `direction` reuses `WsDirection`
/// as-is, and `payload` reuses `WsPayload`'s text/byteCount split for the
/// same reason the SDK caps binary that way (base64 within the cap, a byte
/// count past it). `opcode` has no SDK-side equivalent — the passive capture
/// only ever tracked `binary: Bool` — because a live connection this app
/// opens itself can distinguish control frames the SDK never needed to name.
public struct WebSocketFrame: Sendable, Identifiable, Equatable {
    public let id: UUID
    /// Epoch milliseconds, same unit as `WsMessage.timestamp`.
    public let timestamp: Int64
    public let direction: WsDirection
    public let opcode: WebSocketOpcode
    /// Capped per `WebSocketCaps.perFramePayloadBytes`, always through
    /// `capped(direction:opcode:text:bytes:timestamp:)` below so every frame
    /// — sent or received — passes through the same rule.
    public let payload: WsPayload
    /// The frame's true size in bytes, even when `payload` was capped to a
    /// byte count — the row always knows how big the frame really was.
    public let size: Int

    public init(
        id: UUID = UUID(),
        timestamp: Int64,
        direction: WsDirection,
        opcode: WebSocketOpcode,
        payload: WsPayload,
        size: Int,
    ) {
        self.id = id
        self.timestamp = timestamp
        self.direction = direction
        self.opcode = opcode
        self.payload = payload
        self.size = size
    }
}

extension WebSocketFrame {
    /// Builds a frame with `WebSocketCaps.perFramePayloadBytes` applied —
    /// the single place a frame's payload is decided, used by both the real
    /// transport's receive loop (bytes it read off the wire) and
    /// `WebSocketCaptureSession.send` (text it just handed to `send`), so a
    /// payload can never exceed the cap regardless of which side produced
    /// it. Pass exactly one of `text`/`bytes`.
    public static func capped(
        direction: WsDirection,
        opcode: WebSocketOpcode,
        text: String?,
        bytes: Data?,
        timestamp: Int64,
    ) -> WebSocketFrame {
        let byteCount = bytes?.count ?? text?.utf8.count ?? 0
        let payload: WsPayload = if byteCount > WebSocketCaps.perFramePayloadBytes {
            .byteCount(byteCount)
        } else if let text {
            .text(text)
        } else if let bytes {
            .text(bytes.base64EncodedString())
        } else {
            .text("")
        }
        return WebSocketFrame(timestamp: timestamp, direction: direction, opcode: opcode, payload: payload, size: byteCount)
    }
}
