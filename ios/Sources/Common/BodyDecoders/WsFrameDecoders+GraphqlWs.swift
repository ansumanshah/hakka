import Foundation

private let graphqlWsMessageTypes: Set<String> = [
    "connection_init", "connection_ack", "connection_error", "ping", "pong",
    "subscribe", "next", "error", "complete",
    // legacy graphql-ws protocol types
    "start", "stop", "connection_terminate", "ka", "data",
]

/// graphql-ws / graphql-transport-ws frame decoder. Frames are JSON objects
/// with a `type` field; `id` and `payload` are optional. Port of
/// `wsDecoders.ts`'s `graphqlWsDecoder`.
struct GraphqlWsFrameDecoder: HakkaWsFrameDecoder {
    let id = "graphql-ws"
    let protocols: [String]? = ["graphql-transport-ws", "graphql-ws"]

    func decode(_ payload: WsPayload, binary: Bool, wsProtocol: String?) -> WsFrameInfo? {
        guard !binary, case .text(let text) = payload, !text.isEmpty, text.hasPrefix("{") else { return nil }
        guard let data = text.data(using: .utf8),
            let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? [String: Any]
        else { return nil }
        guard let msgType = parsed["type"] as? String, graphqlWsMessageTypes.contains(msgType) else { return nil }

        let idLabel = parsed["id"].flatMap(jsScalarString).map { " #\($0)" } ?? ""
        let payloadPreview = parsed["payload"].flatMap(previewOfPayload)

        return WsFrameInfo(kind: "graphql-ws", summary: "\(msgType)\(idLabel)", payloadPreview: payloadPreview)
    }
}

/// Renders a JSON scalar (from `id`) the way JS's `String(value)` would.
/// Returns `nil` for JSON null, matching the `id !== undefined && id !== null` check.
private func jsScalarString(_ value: Any) -> String? {
    if value is NSNull { return nil }
    if let s = value as? String { return s }
    if let n = value as? NSNumber {
        return CFGetTypeID(n) == CFBooleanGetTypeID() ? (n.boolValue ? "true" : "false") : n.stringValue
    }
    return "\(value)"
}

/// Renders `payload` for the preview: a raw string as-is, everything else
/// JSON-stringified, truncated to ~120 characters. Key order of the
/// re-serialized JSON is not guaranteed to match the source text — callers
/// only need a representative preview, not a byte-exact echo.
private func previewOfPayload(_ value: Any) -> String? {
    if value is NSNull { return nil }
    let raw: String
    if let s = value as? String {
        raw = s
    } else if let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
        let s = String(data: data, encoding: .utf8) {
        raw = s
    } else {
        raw = "\(value)"
    }
    return raw.count > 120 ? String(raw.prefix(120)) + "…" : raw
}
