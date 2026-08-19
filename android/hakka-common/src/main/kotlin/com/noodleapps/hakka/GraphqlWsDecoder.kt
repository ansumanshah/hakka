package com.noodleapps.hakka

import org.json.JSONObject

/**
 * graphql-ws frame decoder — decodes `graphql-transport-ws` (and legacy `graphql-ws`) JSON
 * envelopes. Mirrors the graphql-ws section of
 * `packages/hakka-core/src/engine/wsDecoders.ts`.
 */

private val GQL_WS_TYPES = setOf(
    "connection_init", "connection_ack", "connection_error", "ping", "pong",
    "subscribe", "next", "error", "complete",
    // legacy graphql-ws protocol types
    "start", "stop", "connection_terminate", "ka", "data",
)

internal val graphqlWsDecoder: WsFrameDecoder = object : WsFrameDecoder {
    override val id = "graphql-ws"
    override val protocols = listOf("graphql-transport-ws", "graphql-ws")

    override fun decode(frame: WsMessage, protocol: String?): WsFrameInfo? {
        if (frame.binary) return null
        val text = frame.data ?: return null
        if (text.isEmpty() || text[0] != '{') return null

        return try {
            val msg = JSONObject(text)
            val msgType = msg.opt("type") as? String ?: return null
            if (msgType !in GQL_WS_TYPES) return null

            val id = msg.opt("id")
            val idLabel = if (id != null && id != JSONObject.NULL) " #$id" else ""

            val payload = msg.opt("payload")
            val payloadPreview = if (payload != null && payload != JSONObject.NULL) {
                val raw = payload as? String ?: payload.toString()
                if (raw.length > 120) raw.take(120) + "…" else raw
            } else {
                null
            }

            WsFrameInfo(kind = "graphql-ws", summary = "$msgType$idLabel", payloadPreview = payloadPreview)
        } catch (_: Exception) {
            null
        }
    }
}
