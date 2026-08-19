import Foundation

/// Rich annotation a WS frame decoder can attach to a single captured frame.
/// Port of `wsDecoders.ts`'s `WsFrameInfo`.
public struct WsFrameInfo: Equatable, Sendable {
    /// Decoder family, e.g. "mqtt".
    public let kind: String
    /// Short human-readable description, e.g. "PUBLISH topic=foo/bar qos=1".
    public let summary: String
    /// Topic string (MQTT PUBLISH/SUBSCRIBE, STOMP destination).
    public let topic: String?
    /// MQTT QoS level (0, 1, or 2).
    public let qos: Int?
    /// MQTT packet identifier (present when QoS > 0).
    public let packetId: Int?
    /// UTF-8 payload preview, truncated to ~120 characters.
    public let payloadPreview: String?

    public init(
        kind: String,
        summary: String,
        topic: String? = nil,
        qos: Int? = nil,
        packetId: Int? = nil,
        payloadPreview: String? = nil
    ) {
        self.kind = kind
        self.summary = summary
        self.topic = topic
        self.qos = qos
        self.packetId = packetId
        self.payloadPreview = payloadPreview
    }
}

/// A decoder that can annotate a single captured WebSocket frame. Port of
/// `wsDecoders.ts`'s `WsFrameDecoder`.
public protocol HakkaWsFrameDecoder: Sendable {
    /// Unique identifier, e.g. "mqtt".
    var id: String { get }
    /// Sub-protocols this decoder handles, e.g. ["mqtt", "mqttv5.0"].
    /// `nil` means the decoder is offered every frame regardless of protocol.
    var protocols: [String]? { get }
    /// Attempt to decode `payload`. Return `nil` when the frame isn't recognised.
    func decode(_ payload: WsPayload, binary: Bool, wsProtocol: String?) -> WsFrameInfo?
}

/// Registry of WS frame decoders, tried in registration order until one
/// returns non-`nil`. Port of `wsDecoders.ts`'s `WsFrameDecoderRegistry`.
public final class WsFrameDecoderRegistry: @unchecked Sendable {
    private var decoders: [HakkaWsFrameDecoder] = []
    private let lock = NSLock()

    public init() {}

    /// Register a decoder. Earlier registrations have higher priority.
    /// Registering with a duplicate id replaces the existing entry.
    public func register(_ decoder: HakkaWsFrameDecoder) {
        lock.lock()
        defer { lock.unlock() }
        if let idx = decoders.firstIndex(where: { $0.id == decoder.id }) {
            decoders[idx] = decoder
        } else {
            decoders.append(decoder)
        }
    }

    /// Remove a decoder by id. No-op if not found.
    public func unregister(_ id: String) {
        lock.lock()
        defer { lock.unlock() }
        decoders.removeAll { $0.id == id }
    }

    /// Snapshot of currently registered decoders (stable copy).
    public func list() -> [HakkaWsFrameDecoder] {
        lock.lock()
        defer { lock.unlock() }
        return decoders
    }

    /// Run the decoder pipeline. A decoder whose `protocols` is non-`nil` is
    /// skipped only when `wsProtocol` is non-empty and absent from that list
    /// (an empty/`nil` `wsProtocol` never excludes a decoder — mirrors the
    /// falsy-`protocol` check in `wsDecoders.ts`'s `decode`). Returns the
    /// first non-`nil` result, or `nil` when no decoder recognises the frame.
    public func decode(_ payload: WsPayload, binary: Bool, wsProtocol: String? = nil) -> WsFrameInfo? {
        lock.lock()
        let snapshot = decoders
        lock.unlock()

        let negotiated = (wsProtocol?.isEmpty == false) ? wsProtocol : nil
        for decoder in snapshot {
            if let protocols = decoder.protocols, let negotiated, !protocols.contains(negotiated) {
                continue
            }
            if let result = decoder.decode(payload, binary: binary, wsProtocol: wsProtocol) {
                return result
            }
        }
        return nil
    }
}

// MARK: - Shared helpers

/// Decodes a UTF-8 byte range to a `String`, replacing invalid sequences with
/// U+FFFD rather than crashing. Out-of-range bounds yield an empty string.
func hakkaWsUtf8Decode(_ bytes: [UInt8], _ start: Int, _ end: Int) -> String {
    guard start >= 0, end <= bytes.count, start <= end else { return "" }
    return String(decoding: bytes[start..<end], as: UTF8.self)
}
