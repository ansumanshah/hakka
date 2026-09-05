// @generated — do not edit. Synced from ios/Sources/Common/BodyDecoders/WsFrameDecoders+Mqtt.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// MQTT WS sub-protocol frame decoder (`mqtt`, `mqttv3.1`, `mqttv3.1.1`,
/// `mqttv5.0`). Binary frames only — base64-decodes the payload and parses
/// the fixed header, remaining-length varint, and (for PUBLISH) the variable
/// header. Port of `wsDecoders.ts`'s `mqttDecoder`.
struct MqttWsFrameDecoder: HakkaWsFrameDecoder {
    let id = "mqtt"
    let protocols: [String]? = ["mqtt", "mqttv3.1", "mqttv3.1.1", "mqttv5.0"]

    func decode(_ payload: WsPayload, binary: Bool, wsProtocol: String?) -> WsFrameInfo? {
        guard binary, case .text(let base64) = payload else { return nil }
        // Reuses the shared lenient base64 decoder (skips invalid characters)
        // rather than the oracle's local strict `base64ToBytes`, which rejects
        // on any invalid char — equivalent for every well-formed MQTT capture.
        guard let bytes = hakkaBase64Decode(base64), bytes.count >= 2 else { return nil }

        let byte0 = bytes[0]
        let packetType = Int((byte0 >> 4) & 0x0f)
        let flags = Int(byte0 & 0x0f)
        guard let typeName = mqttPacketTypeNames[packetType] else { return nil }

        guard let (remainingLength, rlBytes) = mqttParseRemainingLength(bytes, offset: 1) else { return nil }
        let varHeaderStart = 1 + rlBytes
        let packetEnd = varHeaderStart + remainingLength
        // Bounds sanity check — allow truncated captures but reject obviously bad headers.
        guard varHeaderStart <= bytes.count else { return nil }

        guard packetType == 3 else {
            return WsFrameInfo(kind: "mqtt", summary: typeName)
        }
        return decodePublish(bytes, flags: flags, varHeaderStart: varHeaderStart, packetEnd: packetEnd)
    }

    /// PUBLISH variable header: 2-byte big-endian topic length + UTF-8 topic,
    /// then an optional 2-byte packet id (QoS > 0), then the payload up to
    /// `packetEnd`.
    private func decodePublish(_ bytes: [UInt8], flags: Int, varHeaderStart: Int, packetEnd: Int) -> WsFrameInfo {
        let qos = (flags >> 1) & 0x03
        guard varHeaderStart + 2 <= bytes.count else { return WsFrameInfo(kind: "mqtt", summary: "PUBLISH") }

        let topicLen = (Int(bytes[varHeaderStart]) << 8) | Int(bytes[varHeaderStart + 1])
        let topicStart = varHeaderStart + 2
        let topicEnd = topicStart + topicLen
        guard topicEnd <= bytes.count else { return WsFrameInfo(kind: "mqtt", summary: "PUBLISH") }
        let topic = hakkaWsUtf8Decode(bytes, topicStart, topicEnd)

        var cursor = topicEnd
        var packetId: Int?
        if qos > 0 {
            guard cursor + 2 <= bytes.count else {
                return WsFrameInfo(kind: "mqtt", summary: "PUBLISH topic=\(topic) qos=\(qos)", topic: topic, qos: qos)
            }
            packetId = (Int(bytes[cursor]) << 8) | Int(bytes[cursor + 1])
            cursor += 2
        }

        let payloadEnd = min(packetEnd, bytes.count)
        var payloadPreview: String?
        if cursor < payloadEnd {
            let raw = hakkaWsUtf8Decode(bytes, cursor, payloadEnd)
            payloadPreview = raw.count > 120 ? String(raw.prefix(120)) + "…" : raw
        }

        var parts = ["PUBLISH topic=\(topic) qos=\(qos)"]
        if let packetId { parts.append("packetId=\(packetId)") }
        return WsFrameInfo(
            kind: "mqtt",
            summary: parts.joined(separator: " "),
            topic: topic,
            qos: qos,
            packetId: packetId,
            payloadPreview: payloadPreview
        )
    }
}

private let mqttPacketTypeNames: [Int: String] = [
    1: "CONNECT", 2: "CONNACK", 3: "PUBLISH", 4: "PUBACK", 5: "PUBREC",
    6: "PUBREL", 7: "PUBCOMP", 8: "SUBSCRIBE", 9: "SUBACK", 10: "UNSUBSCRIBE",
    11: "UNSUBACK", 12: "PINGREQ", 13: "PINGRESP", 14: "DISCONNECT", 15: "AUTH",
]

/// Parses the MQTT remaining-length varint (up to 4 bytes). Returns
/// `(value, bytesConsumed)`, or `nil` on truncation/overflow.
private func mqttParseRemainingLength(_ bytes: [UInt8], offset: Int) -> (value: Int, consumed: Int)? {
    var value = 0
    var multiplier = 1
    var consumed = 0
    for i in 0..<4 {
        let pos = offset + i
        guard pos < bytes.count else { return nil }
        let byte = bytes[pos]
        value += Int(byte & 0x7f) * multiplier
        consumed += 1
        if byte & 0x80 == 0 { return (value, consumed) }
        multiplier *= 128
    }
    return nil // malformed: more than 4 bytes
}
