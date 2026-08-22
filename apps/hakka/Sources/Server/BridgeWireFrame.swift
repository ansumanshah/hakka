import Foundation
import HakkaCommon
import HakkaCore

/// Swift mirror of the `BridgeMessage` union in
/// `packages/hakka-bridge/src/protocol.ts` — read that file first, it is the
/// source of truth for the wire shape.
///
/// `BridgeFrameKind(rawValue:)` returns `nil` for any string outside this
/// list — a frame whose `type` names a kind this build doesn't know about
/// yet. `parseBridgeFrame` below treats that exactly like malformed JSON: it
/// returns `nil` and the frame is dropped without relay or a crash. That is
/// the whole forward-compat story for a new frame kind (this is how
/// `console`/`storage` themselves were rolled out to a fleet with
/// already-installed older builds) — a case is never removed once shipped,
/// only added, so an old receiver simply ignores a kind it predates.
public enum BridgeFrameKind: String, Sendable, Equatable, Codable {
    case request
    case span
    case console
    case storage
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
    /// Set only for `.control` frames whose `payload` decoded into a
    /// `ControlCommand` via `parseControlCommand` (HakkaCommon). Same rule as
    /// `request` above: a `.control` frame whose payload is object-shaped but
    /// fails that strict parse is still a *parseable* frame (`nil` here, not
    /// a parse failure) — this hub must never be stricter than the TS hub it
    /// mirrors, which relays a control frame it cannot itself interpret.
    public let control: ControlCommand?

    /// Set only for `.span` frames whose `payload` decoded into
    /// `FrameworkSpan`, on the same "still parseable either way" terms.
    public let span: FrameworkSpan?

    /// Set only for `.console` frames whose `payload` decoded into
    /// `[LogEntry]` — always an array on the wire, even for one entry (see
    /// `protocol.ts`'s `BridgeConsoleMessage`). Same "still parseable either
    /// way" terms as `request`/`control`/`span`.
    public let console: [LogEntry]?

    /// Set only for `.storage` frames whose `payload` decoded into
    /// `StorageSnapshot`. Same "still parseable either way" terms as above.
    public let storage: StorageSnapshot?

    public init(
        kind: BridgeFrameKind,
        raw: String,
        request: NetworkRequest? = nil,
        control: ControlCommand? = nil,
        span: FrameworkSpan? = nil,
        console: [LogEntry]? = nil,
        storage: StorageSnapshot? = nil
    ) {
        self.kind = kind
        self.raw = raw
        self.request = request
        self.control = control
        self.span = span
        self.console = console
        self.storage = storage
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

/// Decodes just the `payload` of a `{"type":"console",...}` frame — same
/// rationale as `BridgeRequestEnvelope`. `payload` is always an array on the
/// wire (see `BridgeConsoleMessage` in `protocol.ts`), even for one entry.
private struct BridgeConsoleEnvelope: Decodable {
    let payload: [LogEntry]
}

/// Decodes just the `payload` of a `{"type":"storage",...}` frame — same
/// rationale as `BridgeRequestEnvelope`.
private struct BridgeStorageEnvelope: Decodable {
    let payload: StorageSnapshot
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
    var decodedConsole: [LogEntry]?
    var decodedStorage: StorageSnapshot?
    if kind == .request {
        decodedRequest = try? JSONDecoder().decode(BridgeRequestEnvelope.self, from: data).payload
    } else if kind == .span {
        decodedSpan = try? JSONDecoder().decode(BridgeSpanEnvelope.self, from: data).payload
    } else if kind == .console {
        decodedConsole = try? JSONDecoder().decode(BridgeConsoleEnvelope.self, from: data).payload
    } else if kind == .storage {
        decodedStorage = try? JSONDecoder().decode(BridgeStorageEnvelope.self, from: data).payload
    }
    var decodedControl: ControlCommand?
    if kind == .control {
        // `payload` here is the already-parsed `Any` from the shallow check
        // above (an object or array) — `parseControlCommand` takes it
        // directly rather than re-decoding `data`, matching how it is called
        // everywhere else in the fleet (`parseControlCommand(fromPayloadJSON:)`
        // is the `Data`-first convenience for callers that have not already
        // parsed the frame).
        decodedControl = parseControlCommand(payload)
    }
    return BridgeFrame(
        kind: kind,
        raw: raw,
        request: decodedRequest,
        control: decodedControl,
        span: decodedSpan,
        console: decodedConsole,
        storage: decodedStorage
    )
}
