package com.noodleapps.hakka

/**
 * MQTT frame decoder — decodes MQTT control packets carried over a WebSocket connection
 * negotiated with an `mqtt*` sub-protocol. Mirrors the MQTT section of
 * `packages/hakka-core/src/engine/wsDecoders.ts`.
 */

private val MQTT_PACKET_TYPES = mapOf(
    1 to "CONNECT", 2 to "CONNACK", 3 to "PUBLISH", 4 to "PUBACK", 5 to "PUBREC",
    6 to "PUBREL", 7 to "PUBCOMP", 8 to "SUBSCRIBE", 9 to "SUBACK", 10 to "UNSUBSCRIBE",
    11 to "UNSUBACK", 12 to "PINGREQ", 13 to "PINGRESP", 14 to "DISCONNECT", 15 to "AUTH",
)

/** Parsed MQTT remaining-length varint: decoded value + how many bytes it occupied. */
private data class RemainingLength(val value: Int, val bytesConsumed: Int)

/**
 * Parses the MQTT remaining-length varint starting at [offset]. MQTT caps this field at
 * 4 bytes (max value 268,435,455) — a 5th continuation byte means malformed input, so this
 * returns null past that point, same as the truncated-buffer case.
 */
private fun parseRemainingLength(bytes: ByteArray, offset: Int): RemainingLength? {
    var value = 0
    var multiplier = 1
    for (i in 0 until 4) {
        val pos = offset + i
        if (pos >= bytes.size) return null
        val byte = bytes[pos].toInt() and 0xff
        value += (byte and 0x7f) * multiplier
        if (byte and 0x80 == 0) return RemainingLength(value, i + 1)
        multiplier *= 128
    }
    return null
}

internal val mqttWsDecoder: WsFrameDecoder = object : WsFrameDecoder {
    override val id = "mqtt"
    override val protocols = listOf("mqtt", "mqttv3.1", "mqttv3.1.1", "mqttv5.0")

    override fun decode(frame: WsMessage, protocol: String?): WsFrameInfo? {
        if (!frame.binary) return null
        val data = frame.data ?: return null
        val bytes = base64Decode(data) ?: return null
        if (bytes.size < 2) return null

        val byte0 = bytes[0].toInt() and 0xff
        val packetType = (byte0 shr 4) and 0x0f
        val flags = byte0 and 0x0f
        val typeName = MQTT_PACKET_TYPES[packetType] ?: return null

        val rl = parseRemainingLength(bytes, 1) ?: return null
        val varHeaderStart = 1 + rl.bytesConsumed
        val packetEnd = varHeaderStart + rl.value

        // Bounds sanity check — allow truncated captures but reject obviously bad headers
        if (varHeaderStart > bytes.size) return null

        if (packetType == 3) return decodePublish(bytes, varHeaderStart, packetEnd, flags)

        return WsFrameInfo(kind = "mqtt", summary = typeName)
    }
}

/** PUBLISH: 2-byte big-endian topic length + topic bytes, optional 2-byte packetId, payload. */
private fun decodePublish(bytes: ByteArray, varHeaderStart: Int, packetEnd: Int, flags: Int): WsFrameInfo {
    val qos = (flags shr 1) and 0x03

    if (varHeaderStart + 2 > bytes.size) return WsFrameInfo(kind = "mqtt", summary = "PUBLISH")
    val topicLen = ((bytes[varHeaderStart].toInt() and 0xff) shl 8) or (bytes[varHeaderStart + 1].toInt() and 0xff)
    val topicStart = varHeaderStart + 2
    val topicEnd = topicStart + topicLen
    if (topicEnd > bytes.size) return WsFrameInfo(kind = "mqtt", summary = "PUBLISH")
    val topic = String(bytes, topicStart, topicLen, Charsets.UTF_8)

    var cursor = topicEnd
    var packetId: Int? = null
    if (qos > 0) {
        if (cursor + 2 > bytes.size) {
            return WsFrameInfo(kind = "mqtt", summary = "PUBLISH topic=$topic qos=$qos", topic = topic, qos = qos)
        }
        packetId = ((bytes[cursor].toInt() and 0xff) shl 8) or (bytes[cursor + 1].toInt() and 0xff)
        cursor += 2
    }

    val payloadEnd = minOf(packetEnd, bytes.size)
    var payloadPreview: String? = null
    if (cursor < payloadEnd) {
        val raw = String(bytes, cursor, payloadEnd - cursor, Charsets.UTF_8)
        payloadPreview = if (raw.length > 120) raw.take(120) + "…" else raw
    }

    val parts = mutableListOf("PUBLISH topic=$topic qos=$qos")
    if (packetId != null) parts.add("packetId=$packetId")
    return WsFrameInfo(
        kind = "mqtt",
        summary = parts.joinToString(" "),
        topic = topic,
        qos = qos,
        packetId = packetId,
        payloadPreview = payloadPreview,
    )
}
