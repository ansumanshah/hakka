package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.Base64

/**
 * JUnit port of `packages/hakka-core/src/engine/__tests__/wsDecoders.test.ts` — registry
 * mechanics and the built-in MQTT decoder. Socket.IO/STOMP/graphql-ws each get their own
 * file (`SocketIoWsDecoderTest.kt`, `StompWsDecoderTest.kt`, `GraphqlWsDecoderTest.kt`).
 *
 * Each test builds a fresh [WsFrameDecoderRegistry] via [freshRegistryWithBuiltins] (mirroring
 * the TS suite's per-test dynamic `import('./wsDecoders?v=...')` isolation trick) so mutations
 * (register/unregister) in one test never leak into another.
 */
class WsFrameDecoderTest {

    // -----------------------------------------------------------------------
    // Registry mechanics
    // -----------------------------------------------------------------------

    @Test
    fun `custom decoder registered for a specific protocol is called`() {
        val reg = WsFrameDecoderRegistry()
        val custom = object : WsFrameDecoder {
            override val id = "my-proto"
            override val protocols = listOf("my-proto")
            override fun decode(frame: WsMessage, protocol: String?) = WsFrameInfo(kind = "my-proto", summary = "custom-match")
        }
        reg.register(custom)

        val result = reg.decode(textFrame("anything"), "my-proto")
        assertNotNull(result)
        assertEquals("custom-match", result!!.summary)
    }

    @Test
    fun `custom decoder is NOT called for a different protocol`() {
        val reg = freshRegistryWithBuiltins()
        val custom = object : WsFrameDecoder {
            override val id = "my-proto-2"
            override val protocols = listOf("my-proto-2")
            override fun decode(frame: WsMessage, protocol: String?) = WsFrameInfo(kind = "my-proto-2", summary = "should-not-appear")
        }
        reg.register(custom)

        // An MQTT PINGREQ frame but negotiated as "mqtt" — my-proto-2 should be skipped,
        // the built-in mqtt decoder should still run.
        val result = reg.decode(binaryFrame(buildPingreq()), "mqtt")
        assertTrue(result?.summary != "should-not-appear")
        assertEquals("PINGREQ", result?.summary)
    }

    @Test
    fun `universal decoder is called regardless of protocol`() {
        val reg = WsFrameDecoderRegistry()
        val universal = object : WsFrameDecoder {
            override val id = "universal"
            override val protocols: List<String>? = null
            override fun decode(frame: WsMessage, protocol: String?) = WsFrameInfo(kind = "universal", summary = "caught-all")
        }
        reg.register(universal)

        val result = reg.decode(textFrame("anything"), "some-unknown-protocol")
        assertNotNull(result)
        assertEquals("caught-all", result!!.summary)
    }

    @Test
    fun `unregister removes a decoder`() {
        val reg = WsFrameDecoderRegistry()
        val temp = object : WsFrameDecoder {
            override val id = "temp"
            override val protocols: List<String>? = null
            override fun decode(frame: WsMessage, protocol: String?) = WsFrameInfo(kind = "temp", summary = "temp")
        }
        reg.register(temp)
        assertNotNull(reg.decode(textFrame("x"), ""))

        reg.unregister("temp")
        assertNull(reg.decode(textFrame("x"), ""))
    }

    @Test
    fun `list returns snapshot of registered decoders`() {
        // Built-in mqtt decoder is always registered on the shared singleton.
        assertTrue(wsFrameDecoders.list().any { it.id == "mqtt" })
    }

    // -----------------------------------------------------------------------
    // MQTT decoder
    // -----------------------------------------------------------------------

    @Test
    fun `MQTT decodes PINGREQ`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(binaryFrame(buildPingreq()), "mqtt")
        assertNotNull(result)
        assertEquals("mqtt", result!!.kind)
        assertEquals("PINGREQ", result.summary)
    }

    @Test
    fun `MQTT returns null for a text frame (not binary)`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(textFrame("hello world"), "mqtt")
        assertNull(result)
    }

    @Test
    fun `MQTT decodes PUBLISH QoS 1 with topic, qos, packetId, and payloadPreview`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(binaryFrame(buildPublish("a/b", 1, 42, "hello")), "mqtt")
        assertNotNull(result)
        assertEquals("mqtt", result!!.kind)
        assertEquals("a/b", result.topic)
        assertEquals(1, result.qos)
        assertEquals(42, result.packetId)
        assertEquals("hello", result.payloadPreview)
        assertTrue(result.summary.contains("PUBLISH"))
        assertTrue(result.summary.contains("topic=a/b"))
        assertTrue(result.summary.contains("qos=1"))
        assertTrue(result.summary.contains("packetId=42"))
    }

    @Test
    fun `MQTT decodes PUBLISH QoS 0 with no packetId`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(binaryFrame(buildPublish("sensors/temp", 0, null, "22.5")), "mqtt")
        assertNotNull(result)
        assertEquals("sensors/temp", result!!.topic)
        assertEquals(0, result.qos)
        assertNull(result.packetId)
        assertEquals("22.5", result.payloadPreview)
    }

    @Test
    fun `MQTT truncates a long payload to ~120 chars`() {
        val reg = freshRegistryWithBuiltins()
        val longPayload = "x".repeat(200)
        val result = reg.decode(binaryFrame(buildPublish("t", 0, null, longPayload)), "mqtt")
        assertNotNull(result)
        assertNotNull(result!!.payloadPreview)
        assertTrue(result.payloadPreview!!.length <= 125) // 120 + ellipsis char
        assertTrue(result.payloadPreview!!.endsWith("…"))
    }

    @Test
    fun `MQTT decodes packet type 1 as CONNECT`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(binaryFrame(buildConnect()), "mqtt")
        assertNotNull(result)
        assertEquals("mqtt", result!!.kind)
        assertEquals("CONNECT", result.summary)
    }

    @Test
    fun `MQTT random binary that does not parse as MQTT returns null`() {
        val reg = freshRegistryWithBuiltins()
        // Packet type 0 (reserved) is not a valid MQTT type.
        val result = reg.decode(binaryFrame(byteArrayOf(0x00, 0x00)), "mqtt")
        assertNull(result)
    }

    @Test
    fun `MQTT text frame with mqtt protocol returns null`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(textFrame("""{"type":"ping"}"""), "mqtt")
        assertNull(result)
    }
}

/**
 * Same registration order as [wsFrameDecoders]: mqtt, graphql-ws, stomp, socket.io.
 * `internal` so [SocketIoWsDecoderTest], [StompWsDecoderTest], and [GraphqlWsDecoderTest]
 * share this one definition instead of each re-declaring it.
 */
internal fun freshRegistryWithBuiltins(): WsFrameDecoderRegistry = WsFrameDecoderRegistry().apply {
    register(mqttWsDecoder)
    register(graphqlWsDecoder)
    register(stompWsDecoder)
    register(socketIoWsDecoder)
}

/** Text frame builder shared by every `*WsDecoderTest` file. */
internal fun textFrame(data: String) = WsMessage(timestampMs = 0L, sent = true, data = data, size = data.length.toLong(), binary = false)

/** Binary frame builder — base64-encodes [bytes], matching the wrapper's frame capture contract. */
internal fun binaryFrame(bytes: ByteArray) = WsMessage(
    timestampMs = 0L, sent = true, data = Base64.getEncoder().encodeToString(bytes), size = bytes.size.toLong(), binary = true,
)

private fun buildPingreq(): ByteArray = byteArrayOf(0xC0.toByte(), 0x00)

private fun buildConnect(): ByteArray = byteArrayOf(0x10, 0x00)

/** Builds a minimal MQTT PUBLISH packet: fixed header + varint remaining-length + variable header + payload. */
private fun buildPublish(topic: String, qos: Int, packetId: Int?, payload: String): ByteArray {
    val topicBytes = topic.toByteArray(Charsets.UTF_8)
    val payloadBytes = payload.toByteArray(Charsets.UTF_8)

    val varHeader = mutableListOf<Int>()
    varHeader.add((topicBytes.size shr 8) and 0xff)
    varHeader.add(topicBytes.size and 0xff)
    topicBytes.forEach { varHeader.add(it.toInt() and 0xff) }
    if (qos > 0 && packetId != null) {
        varHeader.add((packetId shr 8) and 0xff)
        varHeader.add(packetId and 0xff)
    }

    val remainingLength = varHeader.size + payloadBytes.size
    val rl = mutableListOf<Int>()
    var rlVal = remainingLength
    do {
        var digit = rlVal % 128
        rlVal /= 128
        if (rlVal > 0) digit = digit or 0x80
        rl.add(digit)
    } while (rlVal > 0)

    val byte0 = (3 shl 4) or ((qos and 0x03) shl 1)
    val allBytes = mutableListOf(byte0)
    allBytes.addAll(rl)
    allBytes.addAll(varHeader)
    payloadBytes.forEach { allBytes.add(it.toInt() and 0xff) }
    return ByteArray(allBytes.size) { allBytes[it].toByte() }
}
