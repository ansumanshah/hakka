package com.noodleapps.hakka

/**
 * WsFrameDecoder — extensible WebSocket sub-protocol frame-decoder pipeline for Hakka
 * (Android port). Mirrors `packages/hakka-core/src/engine/wsDecoders.ts` almost 1:1, and
 * follows the same registry idiom as [BodyDecoderRegistry] in `BodyDecoder.kt`. Closes
 * SPEC.md §5 footnote 17's Android half.
 *
 * Decoders whose [WsFrameDecoder.protocols] list includes the connection's negotiated
 * sub-protocol run first; decoders with a null [WsFrameDecoder.protocols] are universal
 * fallbacks, offered every frame regardless of protocol. The first non-null [WsFrameInfo]
 * result wins.
 *
 * Built-in decoders (registered the first time [wsFrameDecoders] is touched):
 *  - "mqtt"        — MQTT control/publish packets (protocol-matched)
 *  - "graphql-ws"  — graphql-transport-ws / legacy graphql-ws JSON envelopes (protocol-matched)
 *  - "stomp"       — STOMP frames (protocol-matched)
 *  - "socket.io"   — Engine.IO/Socket.IO packets (universal — detected by content)
 */

/** Rich annotation a decoder can attach to a single WS frame. */
data class WsFrameInfo(
    /** Decoder family, e.g. "mqtt". */
    val kind: String,
    /** Short human-readable description, e.g. "PUBLISH topic=foo/bar qos=1". */
    val summary: String,
    /** Topic string (MQTT PUBLISH/SUBSCRIBE, STOMP destination). */
    val topic: String? = null,
    /** MQTT QoS level (0, 1, or 2). */
    val qos: Int? = null,
    /** MQTT packet identifier (present when QoS > 0). */
    val packetId: Int? = null,
    /** UTF-8 payload preview, truncated to ~120 chars. */
    val payloadPreview: String? = null,
)

/** A decoder that can annotate a single captured WS frame. */
interface WsFrameDecoder {
    /** Unique identifier, e.g. "mqtt". */
    val id: String

    /**
     * Sub-protocols this decoder handles, e.g. `["mqtt", "mqttv5.0"]`.
     * Null means the decoder is offered every frame regardless of protocol.
     */
    val protocols: List<String>?

    /**
     * Attempt to decode [frame].
     * @param frame    The raw captured WS frame ([WsMessage.data]/[WsMessage.binary]).
     * @param protocol The negotiated sub-protocol string (null/empty if none).
     * @return [WsFrameInfo] when the frame is recognised, or null to defer.
     */
    fun decode(frame: WsMessage, protocol: String?): WsFrameInfo?
}

class WsFrameDecoderRegistry {
    private val decoders = mutableListOf<WsFrameDecoder>()

    /**
     * Register a decoder. Decoders added earlier take precedence.
     * Registering a decoder with a duplicate id replaces the existing one.
     */
    @Synchronized
    fun register(decoder: WsFrameDecoder) {
        val idx = decoders.indexOfFirst { it.id == decoder.id }
        if (idx != -1) decoders[idx] = decoder else decoders.add(decoder)
    }

    /** Remove a decoder by id. No-op if not found. */
    @Synchronized
    fun unregister(id: String) {
        decoders.removeAll { it.id == id }
    }

    /** Snapshot of currently registered decoders (stable copy). */
    @Synchronized
    fun list(): List<WsFrameDecoder> = decoders.toList()

    /**
     * Run the decoder pipeline. A decoder with a non-null [WsFrameDecoder.protocols] is
     * skipped only when [protocol] is non-empty AND absent from that list — an empty/null
     * [protocol] lets every decoder attempt the frame, matching core's `protocol &&` guard.
     * Returns the first non-null result, or null when nothing recognises the frame. A buggy
     * decoder can never break the pipeline — exceptions are swallowed and treated as "defer".
     */
    @Synchronized
    fun decode(frame: WsMessage, protocol: String? = null): WsFrameInfo? {
        for (decoder in decoders) {
            val protocols = decoder.protocols
            if (protocols != null && !protocol.isNullOrEmpty() && protocol !in protocols) continue
            val result = try {
                decoder.decode(frame, protocol)
            } catch (_: Exception) {
                null
            }
            if (result != null) return result
        }
        return null
    }
}

/**
 * Singleton registry — shared across the application. Built-in decoders are registered the
 * first time this is touched (thread-safe, exactly once), mirroring core's module-load
 * registration side effect. Registration order matches core: mqtt first, then the
 * protocol-matched graphql-ws/stomp, then socket.io (the content-matched universal fallback)
 * last, so specific protocol matches are tried before the universal one.
 */
val wsFrameDecoders: WsFrameDecoderRegistry by lazy {
    WsFrameDecoderRegistry().also { registry ->
        registry.register(mqttWsDecoder)
        registry.register(graphqlWsDecoder)
        registry.register(stompWsDecoder)
        registry.register(socketIoWsDecoder)
    }
}
