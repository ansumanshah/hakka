import Foundation
import Testing
@testable import HakkaCommon

// ---------------------------------------------------------------------------
// Fixture builders — byte-level MQTT packets, mirroring wsDecoders.test.ts's
// buildPingreq/buildPublish/buildConnect helpers.
// ---------------------------------------------------------------------------

private func buildPingreq() -> [UInt8] { [0xc0, 0x00] }
private func buildConnect() -> [UInt8] { [0x10, 0x00] }

/// Fixed header byte0 = (3 << 4) | (qos << 1); variable header = 2-byte topic
/// length + topic bytes + optional 2-byte packetId; payload appended raw.
private func buildPublish(topic: String, qos: Int, packetId: Int?, payload: String) -> [UInt8] {
    let topicBytes = Array(topic.utf8)
    let payloadBytes = Array(payload.utf8)

    var varHeader: [UInt8] = [UInt8((topicBytes.count >> 8) & 0xff), UInt8(topicBytes.count & 0xff)]
    varHeader.append(contentsOf: topicBytes)
    if qos > 0, let packetId {
        varHeader.append(UInt8((packetId >> 8) & 0xff))
        varHeader.append(UInt8(packetId & 0xff))
    }

    let remainingLength = varHeader.count + payloadBytes.count
    var rl: [UInt8] = []
    var rlVal = remainingLength
    repeat {
        var digit = UInt8(rlVal % 128)
        rlVal /= 128
        if rlVal > 0 { digit |= 0x80 }
        rl.append(digit)
    } while rlVal > 0

    let byte0 = UInt8((3 << 4) | ((qos & 0x03) << 1))
    return [byte0] + rl + varHeader + payloadBytes
}

private func b64(_ bytes: [UInt8]) -> String { Data(bytes).base64EncodedString() }

// ---------------------------------------------------------------------------
// MQTT decoder
// ---------------------------------------------------------------------------

@Suite("MQTT WS frame decoder")
struct MqttWsFrameDecoderTests {
    private let decoder = MqttWsFrameDecoder()

    @Test func decodesPingreq() {
        let result = decoder.decode(.text(b64(buildPingreq())), binary: true, wsProtocol: "mqtt")
        #expect(result?.kind == "mqtt")
        #expect(result?.summary == "PINGREQ")
    }

    @Test func returnsNilForTextFrame() {
        let result = decoder.decode(.text("hello world"), binary: false, wsProtocol: "mqtt")
        #expect(result == nil)
    }

    @Test func decodesPublishQos1WithTopicQosPacketIdAndPreview() {
        let bytes = buildPublish(topic: "a/b", qos: 1, packetId: 42, payload: "hello")
        let result = decoder.decode(.text(b64(bytes)), binary: true, wsProtocol: "mqtt")
        #expect(result?.kind == "mqtt")
        #expect(result?.topic == "a/b")
        #expect(result?.qos == 1)
        #expect(result?.packetId == 42)
        #expect(result?.payloadPreview == "hello")
        #expect(result?.summary.contains("PUBLISH") == true)
        #expect(result?.summary.contains("topic=a/b") == true)
        #expect(result?.summary.contains("qos=1") == true)
        #expect(result?.summary.contains("packetId=42") == true)
    }

    @Test func decodesPublishQos0WithoutPacketId() {
        let bytes = buildPublish(topic: "sensors/temp", qos: 0, packetId: nil, payload: "22.5")
        let result = decoder.decode(.text(b64(bytes)), binary: true, wsProtocol: "mqtt")
        #expect(result?.topic == "sensors/temp")
        #expect(result?.qos == 0)
        #expect(result?.packetId == nil)
        #expect(result?.payloadPreview == "22.5")
    }

    @Test func truncatesLongPayloadTo120Chars() throws {
        let longPayload = String(repeating: "x", count: 200)
        let bytes = buildPublish(topic: "t", qos: 0, packetId: nil, payload: longPayload)
        let result = decoder.decode(.text(b64(bytes)), binary: true, wsProtocol: "mqtt")
        let preview = try #require(result?.payloadPreview)
        #expect(preview.count <= 125) // 120 + ellipsis char
        #expect(preview.hasSuffix("…"))
    }

    @Test func decodesConnectPacketType() {
        let result = decoder.decode(.text(b64(buildConnect())), binary: true, wsProtocol: "mqtt")
        #expect(result?.kind == "mqtt")
        #expect(result?.summary == "CONNECT")
    }

    @Test func returnsNilForReservedPacketType() {
        let bytes: [UInt8] = [0x00, 0x00] // packet type 0 — reserved, not a valid MQTT type
        let result = decoder.decode(.text(b64(bytes)), binary: true, wsProtocol: "mqtt")
        #expect(result == nil)
    }

    @Test func returnsNilForByteCountPayload() {
        // A binary frame beyond the 32KB capture cap carries no bytes to decode.
        let result = decoder.decode(.byteCount(4096), binary: true, wsProtocol: "mqtt")
        #expect(result == nil)
    }

    @Test func returnsNilForSingleByteFrame() {
        let result = decoder.decode(.text(b64([0xc0])), binary: true, wsProtocol: "mqtt")
        #expect(result == nil)
    }

    @Test func returnsNilForTruncatedRemainingLengthVarint() {
        // Continuation bit set on every byte for 4 bytes straight — never terminates.
        let bytes: [UInt8] = [0x30, 0xff, 0xff, 0xff, 0xff]
        let result = decoder.decode(.text(b64(bytes)), binary: true, wsProtocol: "mqtt")
        #expect(result == nil)
    }

    @Test func returnsBarePublishWhenVariableHeaderIsTruncated() {
        // PUBLISH (type 3), remaining length 5, but only 1 byte follows the fixed header.
        let bytes: [UInt8] = [0x30, 0x05, 0x00]
        let result = decoder.decode(.text(b64(bytes)), binary: true, wsProtocol: "mqtt")
        #expect(result?.summary == "PUBLISH")
        #expect(result?.topic == nil)
    }

    @Test func returnsNilForEmptyBase64() {
        let result = decoder.decode(.text(""), binary: true, wsProtocol: "mqtt")
        #expect(result == nil)
    }
}

// ---------------------------------------------------------------------------
// Socket.IO decoder
// ---------------------------------------------------------------------------

@Suite("Socket.IO WS frame decoder")
struct SocketIoWsFrameDecoderTests {
    private let decoder = SocketIoWsFrameDecoder()

    @Test func decodesEventFrameWithNameAndArgCount() {
        let result = decoder.decode(.text("42[\"chat\",{\"msg\":\"hello\"}]"), binary: false, wsProtocol: "")
        #expect(result?.kind == "socket.io")
        #expect(result?.summary.contains("EVENT") == true)
        #expect(result?.summary.contains("chat") == true)
        #expect(result?.summary.contains("1 arg") == true)
    }

    @Test func decodesPingControlFrame() {
        let result = decoder.decode(.text("2probe"), binary: false, wsProtocol: "")
        #expect(result?.summary == "ping")
    }

    @Test func decodesEventWithMultipleArgs() {
        let result = decoder.decode(.text("42[\"join\",\"room1\",\"room2\"]"), binary: false, wsProtocol: "")
        #expect(result?.summary.contains("2 args") == true)
    }

    @Test func decodesConnectWithNamespace() {
        let result = decoder.decode(.text("40/admin,"), binary: false, wsProtocol: "")
        #expect(result?.summary.contains("CONNECT") == true)
    }

    @Test func returnsNilForPlainText() {
        let result = decoder.decode(.text("hello world"), binary: false, wsProtocol: "")
        #expect(result == nil)
    }

    @Test func returnsNilForBinaryFrame() {
        let result = decoder.decode(.text("40"), binary: true, wsProtocol: "")
        #expect(result == nil)
    }

    @Test func returnsNilForEmptyText() {
        let result = decoder.decode(.text(""), binary: false, wsProtocol: "")
        #expect(result == nil)
    }

    @Test func returnsNilForTruncatedEventJson() {
        // Declares an EVENT packet ("42") but the JSON array is truncated — never crashes.
        let result = decoder.decode(.text("42[\"chat\","), binary: false, wsProtocol: "")
        #expect(result == nil)
    }

    @Test func returnsNilForOverlongControlPacket() {
        let result = decoder.decode(.text("0" + String(repeating: "z", count: 250)), binary: false, wsProtocol: "")
        #expect(result == nil)
    }
}

// ---------------------------------------------------------------------------
// STOMP decoder
// ---------------------------------------------------------------------------

@Suite("STOMP WS frame decoder")
struct StompWsFrameDecoderTests {
    private let decoder = StompWsFrameDecoder()

    @Test func decodesSendFrameWithDestinationAndBody() {
        let frame = "SEND\ndestination:/queue/orders\ncontent-type:application/json\n\n{\"order\":1}\0"
        let result = decoder.decode(.text(frame), binary: false, wsProtocol: "v12.stomp")
        #expect(result?.kind == "stomp")
        #expect(result?.summary == "SEND /queue/orders")
        #expect(result?.topic == "/queue/orders")
        #expect(result?.payloadPreview == "{\"order\":1}")
    }

    @Test func decodesMessageFrame() {
        let frame = "MESSAGE\ndestination:/topic/news\nsubscription:sub-0\n\nbreaking news\0"
        let result = decoder.decode(.text(frame), binary: false, wsProtocol: "v11.stomp")
        #expect(result?.kind == "stomp")
        #expect(result?.summary.contains("MESSAGE") == true)
        #expect(result?.topic == "/topic/news")
    }

    @Test func returnsNilForUnrecognisedCommand() {
        let result = decoder.decode(.text("WHATEVER\n\n\0"), binary: false, wsProtocol: "v12.stomp")
        #expect(result == nil)
    }

    @Test func returnsNilForPlainText() {
        let result = decoder.decode(.text("hello world"), binary: false, wsProtocol: "v12.stomp")
        #expect(result == nil)
    }

    @Test func returnsNilForBinaryFrame() {
        let result = decoder.decode(.text("SEND\n\n\0"), binary: true, wsProtocol: "v12.stomp")
        #expect(result == nil)
    }

    @Test func returnsNilForEmptyText() {
        let result = decoder.decode(.text(""), binary: false, wsProtocol: "v12.stomp")
        #expect(result == nil)
    }

    @Test func handlesMissingNullTerminatorGracefully() {
        let frame = "SEND\ndestination:/x\n\nbody-without-terminator"
        let result = decoder.decode(.text(frame), binary: false, wsProtocol: "v12.stomp")
        #expect(result?.payloadPreview == "body-without-terminator")
    }

    @Test func truncatesLongBodyTo120Chars() throws {
        let frame = "SEND\ndestination:/x\n\n\(String(repeating: "y", count: 200))\0"
        let result = decoder.decode(.text(frame), binary: false, wsProtocol: "v12.stomp")
        let preview = try #require(result?.payloadPreview)
        #expect(preview.count <= 125)
        #expect(preview.hasSuffix("…"))
    }

    @Test func headersWithoutColonAreIgnored() {
        let frame = "SEND\nmalformed-header-no-colon\ndestination:/x\n\nbody\0"
        let result = decoder.decode(.text(frame), binary: false, wsProtocol: "v12.stomp")
        #expect(result?.topic == "/x")
    }
}

// ---------------------------------------------------------------------------
// graphql-ws decoder
// ---------------------------------------------------------------------------

@Suite("graphql-ws WS frame decoder")
struct GraphqlWsFrameDecoderTests {
    private let decoder = GraphqlWsFrameDecoder()

    @Test func decodesNextFrameWithIdAndPayloadPreview() {
        let msg = "{\"type\":\"next\",\"id\":\"1\",\"payload\":{\"data\":{\"user\":{\"name\":\"Alice\"}}}}"
        let result = decoder.decode(.text(msg), binary: false, wsProtocol: "graphql-transport-ws")
        #expect(result?.kind == "graphql-ws")
        #expect(result?.summary == "next #1")
        #expect(result?.payloadPreview != nil)
    }

    @Test func decodesSubscribeFrame() {
        let msg = "{\"type\":\"subscribe\",\"id\":\"2\",\"payload\":{\"query\":\"{ users { id } }\"}}"
        let result = decoder.decode(.text(msg), binary: false, wsProtocol: "graphql-transport-ws")
        #expect(result?.summary == "subscribe #2")
    }

    @Test func decodesConnectionInitWithoutId() {
        let result = decoder.decode(.text("{\"type\":\"connection_init\"}"), binary: false, wsProtocol: "graphql-transport-ws")
        #expect(result?.summary == "connection_init")
    }

    @Test func returnsNilForUnknownMessageType() {
        let msg = "{\"type\":\"unknown_type_xyz\",\"id\":\"3\"}"
        let result = decoder.decode(.text(msg), binary: false, wsProtocol: "graphql-transport-ws")
        #expect(result == nil)
    }

    @Test func returnsNilForPlainText() {
        let result = decoder.decode(.text("hello world"), binary: false, wsProtocol: "graphql-transport-ws")
        #expect(result == nil)
    }

    @Test func returnsNilForBinaryFrame() {
        let result = decoder.decode(.text("{\"type\":\"ping\"}"), binary: true, wsProtocol: "graphql-transport-ws")
        #expect(result == nil)
    }

    @Test func returnsNilForMalformedJson() {
        let result = decoder.decode(.text("{\"type\":\"next\","), binary: false, wsProtocol: "graphql-transport-ws")
        #expect(result == nil)
    }

    @Test func returnsNilForNonObjectJson() {
        let result = decoder.decode(.text("[1,2,3]"), binary: false, wsProtocol: "graphql-transport-ws")
        #expect(result == nil)
    }

    @Test func truncatesLongPayloadPreview() throws {
        let msg = "{\"type\":\"subscribe\",\"id\":\"9\",\"payload\":\"\(String(repeating: "q", count: 200))\"}"
        let result = decoder.decode(.text(msg), binary: false, wsProtocol: "graphql-transport-ws")
        let preview = try #require(result?.payloadPreview)
        #expect(preview.count <= 125)
        #expect(preview.hasSuffix("…"))
    }
}

// ---------------------------------------------------------------------------
// WsFrameDecoderRegistry mechanics — fresh instances only, never the shared
// global singleton, so tests never race on shared mutable state.
// ---------------------------------------------------------------------------

private struct ClosureWsFrameDecoder: HakkaWsFrameDecoder {
    let id: String
    let protocols: [String]?
    let handler: @Sendable (WsPayload, Bool, String?) -> WsFrameInfo?
    func decode(_ payload: WsPayload, binary: Bool, wsProtocol: String?) -> WsFrameInfo? {
        handler(payload, binary, wsProtocol)
    }
}

@Suite("WsFrameDecoderRegistry")
struct WsFrameDecoderRegistryTests {
    @Test func firstNonNilWins() {
        let reg = WsFrameDecoderRegistry()
        reg.register(ClosureWsFrameDecoder(id: "a", protocols: nil) { _, _, _ in WsFrameInfo(kind: "a", summary: "first") })
        reg.register(ClosureWsFrameDecoder(id: "b", protocols: nil) { _, _, _ in WsFrameInfo(kind: "b", summary: "second") })
        #expect(reg.decode(.text("x"), binary: false)?.summary == "first")
    }

    @Test func nilDefersToNextDecoder() {
        let reg = WsFrameDecoderRegistry()
        reg.register(ClosureWsFrameDecoder(id: "skip", protocols: nil) { _, _, _ in nil })
        reg.register(ClosureWsFrameDecoder(id: "fallback", protocols: nil) { _, _, _ in WsFrameInfo(kind: "fallback", summary: "matched") })
        #expect(reg.decode(.text("x"), binary: false)?.summary == "matched")
    }

    @Test func duplicateIdReplaces() {
        let reg = WsFrameDecoderRegistry()
        reg.register(ClosureWsFrameDecoder(id: "dup", protocols: nil) { _, _, _ in WsFrameInfo(kind: "dup", summary: "v1") })
        reg.register(ClosureWsFrameDecoder(id: "dup", protocols: nil) { _, _, _ in WsFrameInfo(kind: "dup", summary: "v2") })
        #expect(reg.decode(.text("x"), binary: false)?.summary == "v2")
    }

    @Test func protocolGatedDecoderWinsForItsProtocol() {
        let reg = WsFrameDecoderRegistry()
        reg.register(
            ClosureWsFrameDecoder(id: "my-proto", protocols: ["my-proto"]) { _, _, _ in
                WsFrameInfo(kind: "my-proto", summary: "custom-match")
            })
        #expect(reg.decode(.text("anything"), binary: false, wsProtocol: "my-proto")?.summary == "custom-match")
    }

    @Test func protocolGatedDecoderSkippedForDifferentProtocol() {
        let reg = WsFrameDecoderRegistry()
        reg.register(
            ClosureWsFrameDecoder(id: "my-proto-2", protocols: ["my-proto-2"]) { _, _, _ in
                WsFrameInfo(kind: "my-proto-2", summary: "should-not-appear")
            })
        reg.register(MqttWsFrameDecoder())
        let result = reg.decode(.text(b64(buildPingreq())), binary: true, wsProtocol: "mqtt")
        #expect(result?.summary != "should-not-appear")
        #expect(result?.summary == "PINGREQ")
    }

    @Test func universalDecoderRunsRegardlessOfProtocol() {
        let reg = WsFrameDecoderRegistry()
        reg.register(
            ClosureWsFrameDecoder(id: "universal", protocols: nil) { _, _, _ in
                WsFrameInfo(kind: "universal", summary: "caught-all")
            })
        #expect(reg.decode(.text("anything"), binary: false, wsProtocol: "some-unknown-protocol")?.summary == "caught-all")
    }

    @Test func emptyProtocolDoesNotExcludeAProtocolGatedDecoder() {
        let reg = WsFrameDecoderRegistry()
        reg.register(
            ClosureWsFrameDecoder(id: "gated", protocols: ["only-this"]) { _, _, _ in
                WsFrameInfo(kind: "gated", summary: "ran-anyway")
            })
        #expect(reg.decode(.text("x"), binary: false, wsProtocol: "")?.summary == "ran-anyway")
    }

    @Test func unregisterRemovesADecoder() {
        let reg = WsFrameDecoderRegistry()
        reg.register(ClosureWsFrameDecoder(id: "temp", protocols: nil) { _, _, _ in WsFrameInfo(kind: "temp", summary: "temp") })
        #expect(reg.decode(.text("x"), binary: false) != nil)
        reg.unregister("temp")
        #expect(reg.decode(.text("x"), binary: false) == nil)
    }

    @Test func listReturnsSnapshotOfRegisteredDecoders() {
        let reg = WsFrameDecoderRegistry()
        reg.register(MqttWsFrameDecoder())
        #expect(reg.list().contains { $0.id == "mqtt" })
    }
}

// ---------------------------------------------------------------------------
// Built-in registry wiring — read-only calls against the shared global
// singleton (never register/unregister here; other suites may run in parallel).
// ---------------------------------------------------------------------------

@Suite("wsFrameDecoders — built-in registry wiring")
struct BuiltinWsFrameDecodersTests {
    @Test func decodesMqttThroughGlobalRegistry() {
        let result = wsFrameDecoders.decode(.text(b64(buildPingreq())), binary: true, wsProtocol: "mqtt")
        #expect(result?.kind == "mqtt")
    }

    @Test func decodesSocketIoThroughGlobalRegistry() {
        let result = wsFrameDecoders.decode(.text("2probe"), binary: false, wsProtocol: "")
        #expect(result?.summary == "ping")
    }

    @Test func decodesGraphqlWsThroughConvenienceWrapper() {
        let result = decodeWsFrame(.text("{\"type\":\"connection_init\"}"), binary: false, wsProtocol: "graphql-transport-ws")
        #expect(result?.summary == "connection_init")
    }

    @Test func decodesStompThroughGlobalRegistry() {
        let result = wsFrameDecoders.decode(.text("CONNECT\naccept-version:1.2\n\n\0"), binary: false, wsProtocol: "v12.stomp")
        #expect(result?.kind == "stomp")
    }

    @Test func builtinRegistryListsAllFourDecoders() {
        let ids = Set(wsFrameDecoders.list().map(\.id))
        #expect(ids.isSuperset(of: ["mqtt", "graphql-ws", "stomp", "socket.io"]))
    }
}
