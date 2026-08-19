import Foundation

/// Socket.IO / Engine.IO frame decoder. Universal — no protocol gate,
/// detected purely by content: an Engine.IO type digit (0-6), and for
/// message frames (type 4) a nested Socket.IO type digit (0-6) plus an
/// optional namespace and JSON payload. Port of `wsDecoders.ts`'s `socketioDecoder`.
struct SocketIoWsFrameDecoder: HakkaWsFrameDecoder {
    let id = "socket.io"
    let protocols: [String]? = nil

    func decode(_ payload: WsPayload, binary: Bool, wsProtocol: String?) -> WsFrameInfo? {
        guard !binary, case .text(let text) = payload, !text.isEmpty else { return nil }
        let bytes = Array(text.utf8)

        // Engine.IO type digit (0-6) must be the first byte.
        guard let eioType = asciiDigit(bytes, at: 0), (0...6).contains(eioType) else { return nil }
        guard let eioName = eioTypeNames[eioType] else { return nil }

        guard eioType == 4 else {
            // Non-message Engine.IO packets — reject anything implausibly
            // long for a bare control packet.
            return bytes.count > 200 ? nil : WsFrameInfo(kind: "socket.io", summary: eioName)
        }

        // Engine.IO type 4 = Socket.IO packet — next digit is the Socket.IO type.
        guard bytes.count >= 2, let sioType = asciiDigit(bytes, at: 1), (0...6).contains(sioType) else { return nil }
        guard let sioName = sioTypeNames[sioType] else { return nil }

        var cursor = 2
        var namespace = "/"
        // Optional namespace (starts with '/' after the type digit).
        if cursor < bytes.count, bytes[cursor] == UInt8(ascii: "/"),
            let commaIdx = bytes[cursor...].firstIndex(of: UInt8(ascii: ",")) {
            namespace = hakkaWsUtf8Decode(bytes, cursor, commaIdx)
            cursor = commaIdx + 1
        }
        // Skip optional ack id (digits).
        while cursor < bytes.count, (48...57).contains(bytes[cursor]) {
            cursor += 1
        }

        if sioType == 2 || sioType == 3 {
            return decodeEventOrAck(bytes, from: cursor, sioType: sioType, namespace: namespace)
        }

        // CONNECT / DISCONNECT / CONNECT_ERROR / BINARY_EVENT / BINARY_ACK
        let packetPrefix = hakkaWsUtf8Decode(bytes, 0, min(2, bytes.count))
        return WsFrameInfo(kind: "socket.io", summary: "\(packetPrefix) \(sioName)")
    }

    /// EVENT/ACK: the remainder from `cursor` is a JSON array `[eventName, ...args]`.
    private func decodeEventOrAck(_ bytes: [UInt8], from cursor: Int, sioType: Int, namespace: String) -> WsFrameInfo? {
        guard cursor < bytes.count, bytes[cursor] == UInt8(ascii: "[") else { return nil }
        let rest = Array(bytes[cursor...])
        guard
            let parsed = try? JSONSerialization.jsonObject(with: Data(rest), options: [.fragmentsAllowed]) as? [Any]
        else { return nil }

        let eventName = parsed.first as? String ?? ""
        let argCount = parsed.count - 1
        let ns = namespace != "/" ? " (\(namespace))" : ""
        let label = sioType == 2 ? "EVENT" : "ACK"
        let summary = "\(label) \(eventName)\(ns) (\(argCount) arg\(argCount != 1 ? "s" : ""))"
        return WsFrameInfo(kind: "socket.io", summary: summary)
    }
}

private let eioTypeNames: [Int: String] = [
    0: "open", 1: "close", 2: "ping", 3: "pong", 4: "message", 5: "upgrade", 6: "noop",
]

private let sioTypeNames: [Int: String] = [
    0: "CONNECT", 1: "DISCONNECT", 2: "EVENT", 3: "ACK", 4: "CONNECT_ERROR", 5: "BINARY_EVENT", 6: "BINARY_ACK",
]

/// Reads the ASCII digit at `index`, or `nil` if out of range or not '0'-'9'.
private func asciiDigit(_ bytes: [UInt8], at index: Int) -> Int? {
    guard index < bytes.count, (48...57).contains(bytes[index]) else { return nil }
    return Int(bytes[index]) - 48
}
