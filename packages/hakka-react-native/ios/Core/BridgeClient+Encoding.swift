// @generated — do not edit. Synced from ios/Sources/Common/BridgeClient+Encoding.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// Wire-frame encoding for ``HakkaBridgeClient``, split out of
/// `BridgeClient.swift` to keep that file under the 200-line convention.
/// Not `private` (module-internal instead) since a private member of a type
/// declared in another file is unreachable from these methods otherwise —
/// none of them touch the client's private connection state, only encode.
extension HakkaBridgeClient {
    func encodeFrame(_ request: NetworkRequest) -> String? {
        encodeFrame(request, type: "request")
    }

    /// Encodes `{ "type": <type>, "payload": <payload> }` for any `Encodable`
    /// payload — the shared envelope shape every bridge frame kind uses
    /// (matches `protocol.ts`'s `BridgeMessage` union member by member).
    func encodeFrame(_ payload: some Encodable, type: String) -> String? {
        let wrapper = BridgeWireMessage(type: type, payload: payload)
        let encoder = JSONEncoder()
        encoder.outputFormatting = []
        guard let data = try? encoder.encode(wrapper),
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }
        return string
    }
}

// MARK: - Wire types

/// `{ "type": <type>, "payload": <payload> }` — the shared envelope shape
/// matching every `BridgeMessage` member in `protocol.ts`.
struct BridgeWireMessage<Payload: Encodable>: Encodable {
    let type: String
    let payload: Payload
}
