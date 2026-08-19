package com.noodleapps.hakka

import org.json.JSONArray

/**
 * Socket.IO / Engine.IO frame decoder. Universal fallback (no protocol list) — Socket.IO
 * negotiates no WebSocket sub-protocol, so frames are recognised by their leading digit
 * prefix instead. Mirrors the Socket.IO section of
 * `packages/hakka-core/src/engine/wsDecoders.ts`.
 */

private val EIO_TYPE_NAMES = mapOf(
    0 to "open", 1 to "close", 2 to "ping", 3 to "pong", 4 to "message", 5 to "upgrade", 6 to "noop",
)

private val SIO_TYPE_NAMES = mapOf(
    0 to "CONNECT", 1 to "DISCONNECT", 2 to "EVENT", 3 to "ACK", 4 to "CONNECT_ERROR", 5 to "BINARY_EVENT", 6 to "BINARY_ACK",
)

internal val socketIoWsDecoder: WsFrameDecoder = object : WsFrameDecoder {
    override val id = "socket.io"
    override val protocols: List<String>? = null // detect by content, not by negotiated protocol

    override fun decode(frame: WsMessage, protocol: String?): WsFrameInfo? {
        if (frame.binary) return null
        val text = frame.data ?: return null
        if (text.isEmpty()) return null

        return try {
            // Engine.IO type digit (0-6) must be the first character.
            val eioTypeChar = text[0].code - '0'.code
            if (eioTypeChar !in 0..6) return null
            val eioTypeName = EIO_TYPE_NAMES[eioTypeChar] ?: return null

            if (eioTypeChar != 4) {
                // Non-message Engine.IO packets (ping/pong/open/close/…) — reject anything
                // implausibly long for a bare control packet.
                if (text.length > 200) return null
                return WsFrameInfo(kind = "socket.io", summary = eioTypeName)
            }

            // Engine.IO type 4 = Socket.IO packet — next digit is the Socket.IO type.
            if (text.length < 2) return null
            val sioTypeChar = text[1].code - '0'.code
            if (sioTypeChar !in 0..6) return null
            val sioTypeName = SIO_TYPE_NAMES[sioTypeChar] ?: return null

            // Parse optional namespace (starts with '/' after the type digit).
            var cursor = 2
            var namespace = "/"
            if (cursor < text.length && text[cursor] == '/') {
                val commaIdx = text.indexOf(',', cursor)
                if (commaIdx != -1) {
                    namespace = text.substring(cursor, commaIdx)
                    cursor = commaIdx + 1
                }
            }

            // Skip optional ack id (digits).
            while (cursor < text.length && text[cursor] in '0'..'9') cursor++

            // For EVENT and ACK, the rest is a JSON array.
            if (sioTypeChar == 2 || sioTypeChar == 3) {
                val rest = text.substring(cursor)
                if (!rest.startsWith("[")) return null
                val parsed = JSONArray(rest)
                val eventName = if (parsed.length() > 0) parsed.opt(0) else null
                val argCount = parsed.length() - 1
                val nameLabel = eventName as? String ?: ""
                val ns = if (namespace != "/") " ($namespace)" else ""
                val argWord = if (argCount != 1) "args" else "arg"
                val summary = if (sioTypeChar == 2) {
                    "EVENT $nameLabel$ns ($argCount $argWord)"
                } else {
                    "ACK $nameLabel$ns ($argCount $argWord)"
                }
                return WsFrameInfo(kind = "socket.io", summary = summary)
            }

            // CONNECT / DISCONNECT / CONNECT_ERROR
            val packetLabel = "${text.take(2)} $sioTypeName"
            WsFrameInfo(kind = "socket.io", summary = packetLabel)
        } catch (_: Exception) {
            null
        }
    }
}
