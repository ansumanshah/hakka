package com.noodleapps.hakka

/**
 * STOMP frame decoder — decodes STOMP frames over a WebSocket connection negotiated with a
 * `vN.stomp` sub-protocol. Mirrors the STOMP section of
 * `packages/hakka-core/src/engine/wsDecoders.ts`.
 */

private val STOMP_COMMANDS = setOf(
    "CONNECT", "STOMP", "CONNECTED", "SEND", "SUBSCRIBE", "UNSUBSCRIBE", "ACK", "NACK",
    "BEGIN", "COMMIT", "ABORT", "DISCONNECT", "RECEIPT", "ERROR", "MESSAGE",
)

/** STOMP frames are NUL-terminated; built via `Char(0)` to avoid an embedded raw NUL byte in source. */
private val STOMP_FRAME_TERMINATOR: Char = Char(0)

internal val stompWsDecoder: WsFrameDecoder = object : WsFrameDecoder {
    override val id = "stomp"
    override val protocols = listOf("v10.stomp", "v11.stomp", "v12.stomp")

    override fun decode(frame: WsMessage, protocol: String?): WsFrameInfo? {
        if (frame.binary) return null
        val text = frame.data ?: return null
        if (text.isEmpty()) return null

        return try {
            val newlineIdx = text.indexOf('\n')
            val commandLine = if (newlineIdx == -1) text else text.substring(0, newlineIdx)
            val command = commandLine.removeSuffix("\r")
            if (command !in STOMP_COMMANDS) return null

            // Headers: "key:value" lines until the first blank line.
            val headers = mutableMapOf<String, String>()
            var cursor = newlineIdx + 1
            while (cursor < text.length) {
                val lineEnd = text.indexOf('\n', cursor)
                val line = if (lineEnd == -1) text.substring(cursor) else text.substring(cursor, lineEnd)
                val trimmed = line.removeSuffix("\r")
                if (trimmed.isEmpty()) {
                    cursor = (if (lineEnd == -1) text.length else lineEnd) + 1
                    break
                }
                val colonIdx = trimmed.indexOf(':')
                if (colonIdx != -1) {
                    headers[trimmed.substring(0, colonIdx).trim()] = trimmed.substring(colonIdx + 1).trim()
                }
                cursor = if (lineEnd == -1) text.length else lineEnd + 1
            }

            val destination = headers["destination"]

            // Body: everything from cursor up to the frame terminator.
            val termIdx = text.indexOf(STOMP_FRAME_TERMINATOR, cursor)
            val bodyEnd = if (termIdx == -1) text.length else termIdx
            val body = text.substring(cursor, bodyEnd)
            val payloadPreview = when {
                body.length > 120 -> body.take(120) + "…"
                body.isNotEmpty() -> body
                else -> null
            }

            val summaryParts = mutableListOf(command)
            if (destination != null) summaryParts.add(destination)

            WsFrameInfo(
                kind = "stomp",
                summary = summaryParts.joinToString(" "),
                topic = destination,
                payloadPreview = payloadPreview,
            )
        } catch (_: Exception) {
            null
        }
    }
}
