import Foundation
import HakkaCommon
import HakkaCore

/// Swift mirror of the `BridgeMessage` union in
/// `packages/hakka-bridge/src/protocol.ts` — read that file first, it is the
/// source of truth for the wire shape.
public enum BridgeFrameKind: String, Sendable, Equatable, Codable {
    case request
    case span
    case control
}

/// One parsed frame off the wire. `raw` is always the original text, so a
/// caller can relay it verbatim without re-encoding (relaying a re-encoded
/// copy risks disagreeing with a client's exact byte layout for no reason).
public struct BridgeFrame: Sendable, Equatable {
    public let kind: BridgeFrameKind
    public let raw: String
    /// Set only for `.request` frames whose `payload` decoded into
    /// `NetworkRequest`. A `.request` frame with a payload that is shaped
    /// like an object but fails that decode is still a *parseable* frame
    /// (`nil` here, not a parse failure) — see `parseBridgeFrame`.
    public let request: NetworkRequest?
    /// Set only for `.span` frames whose `payload` decoded into
    /// `FrameworkSpan`, on the same "still parseable either way" terms as
    /// `request` above.
    public let span: FrameworkSpan?

    public init(kind: BridgeFrameKind, raw: String, request: NetworkRequest? = nil, span: FrameworkSpan? = nil) {
        self.kind = kind
        self.raw = raw
        self.request = request
        self.span = span
    }
}

public enum BridgeWireLimits {
    /// Hard cap on a single frame's UTF-8 byte length, checked by
    /// `parseBridgeFrame` and mirrored on the listening socket via
    /// `NWProtocolWebSocket.Options.maximumMessageSize` (`BridgeServer`) —
    /// belt and suspenders against a hostile or buggy peer's memory
    /// footprint. Generous relative to typical captured bodies (Hakka
    /// captures full request/response bodies) while still bounded.
    public static let maxFrameBytes = 8 * 1024 * 1024
}

/// Decodes just the `payload` of a `{"type":"request",...}` frame, so the
/// `NetworkRequest` decode runs directly against the original wire bytes —
/// no re-serialization round trip through `JSONSerialization`, which would
/// risk quietly reformatting numbers.
private struct BridgeRequestEnvelope: Decodable {
    let payload: NetworkRequest
}

/// Decodes just the `payload` of a `{"type":"span",...}` frame — same
/// rationale as `BridgeRequestEnvelope`.
private struct BridgeSpanEnvelope: Decodable {
    let payload: FrameworkSpan
}

/// Parse one raw WebSocket text frame into a typed `BridgeFrame`. Returns
/// `nil` for anything that does not satisfy the shallow wire contract —
/// malformed JSON, a missing/unrecognized `type`, a missing/null `payload`,
/// or a `payload` that isn't a JSON object/array — mirroring
/// `parseBridgeMessage` in `protocol.ts` exactly, including that a `.request`
/// frame's `payload` is only checked shallowly here: it does NOT have to
/// satisfy `NetworkRequest`'s full shape to count as parseable (that would
/// make this parser stricter than the TS hub it must match). Never throws —
/// this is the boundary hostile/partial input crosses.
public func parseBridgeFrame(_ raw: String, maxBytes: Int = BridgeWireLimits.maxFrameBytes) -> BridgeFrame? {
    guard raw.utf8.count <= maxBytes else { return nil }
    guard let data = raw.data(using: .utf8) else { return nil }

    guard let any = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
          let obj = any as? [String: Any],
          let typeRaw = obj["type"] as? String,
          let kind = BridgeFrameKind(rawValue: typeRaw),
          let payload = obj["payload"], !(payload is NSNull),
          payload is [String: Any] || payload is [Any]
    else {
        return nil
    }

    var decodedRequest: NetworkRequest?
    var decodedSpan: FrameworkSpan?
    if kind == .request {
        decodedRequest = try? JSONDecoder().decode(BridgeRequestEnvelope.self, from: data).payload
    } else if kind == .span {
        decodedSpan = try? JSONDecoder().decode(BridgeSpanEnvelope.self, from: data).payload
    }
    return BridgeFrame(kind: kind, raw: raw, request: decodedRequest, span: decodedSpan)
}
