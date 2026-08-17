package com.noodleapps.hakka

/**
 * gRPC-web decoder — unframes length-prefixed messages and decodes each as protobuf. Mirrors
 * the gRPC-web section of `packages/hakka-core/src/engine/decoders.ts`.
 */

/** A single length-prefixed gRPC-web frame. */
data class GrpcWebFrame(
    /** True when this frame is the trailer frame (MSB of the compression byte is set: 0x80). */
    val isTrailer: Boolean,
    /** True when the frame's own payload was gzip-compressed (LSB of the compression byte). */
    val compressed: Boolean,
    /** Byte length of the frame's message payload, per the 4-byte big-endian length prefix. */
    val length: Int,
    /**
     * The decoded message for data frames — the best-effort protobuf field tree (see
     * [decodeProtobuf]). Null for the trailer frame.
     */
    val message: List<ProtoField>? = null,
    /**
     * Raw trailer text (only set when [isTrailer] is true) — gRPC-web trailers are
     * HTTP/1.1-style "Key: Value\r\n" text, not protobuf.
     */
    val trailerText: String? = null,
)

/**
 * Decode a gRPC-web body into its length-prefixed frames.
 *
 * Frame format: [1 compression byte][4-byte big-endian length][message bytes], repeated. The
 * compression byte's high bit (0x80) marks a trailer frame; gRPC-web trailers are plain
 * HTTP-header-style text ("grpc-status: 0\r\n"), not a protobuf message.
 *
 * For `application/grpc-web-text` (and `+text` variants), the body is base64-encoded as a
 * whole; other content types still arrive base64-encoded through Hakka's capture pipeline, so
 * they're decoded unconditionally, falling back to a latin1-style byte mapping if that fails.
 *
 * Never throws — returns whatever frames were successfully parsed before any failure.
 */
fun decodeGrpcWeb(body: String, contentType: String? = null): List<GrpcWebFrame> {
    val ct = (contentType ?: "").lowercase()
    val isText = ct.contains("grpc-web-text") || ct.contains("grpc-web+text")

    val bytes: ByteArray = if (isText) {
        base64Decode(body) ?: return emptyList()
    } else {
        base64Decode(body) ?: ByteArray(body.length) { i -> (body[i].code and 0xff).toByte() }
    }

    val frames = mutableListOf<GrpcWebFrame>()
    var pos = 0
    try {
        while (pos + 5 <= bytes.size) {
            val compressionByte = bytes[pos].toInt() and 0xff
            val isTrailer = (compressionByte and 0x80) != 0
            val compressed = (compressionByte and 0x01) != 0
            val length =
                ((bytes[pos + 1].toInt() and 0xff) shl 24) or
                    ((bytes[pos + 2].toInt() and 0xff) shl 16) or
                    ((bytes[pos + 3].toInt() and 0xff) shl 8) or
                    (bytes[pos + 4].toInt() and 0xff)
            pos += 5
            if (pos + length > bytes.size) {
                // Truncated final frame — surface what we can (empty message) and stop.
                val partialPayload = bytes.copyOfRange(pos, bytes.size)
                if (isTrailer) {
                    frames.add(GrpcWebFrame(isTrailer, compressed, length, trailerText = bytesToUtf8(partialPayload)))
                } else {
                    frames.add(GrpcWebFrame(isTrailer, compressed, length, message = decodeProtobuf(partialPayload)))
                }
                break
            }
            val payload = bytes.copyOfRange(pos, pos + length)
            pos += length

            if (isTrailer) {
                frames.add(GrpcWebFrame(isTrailer, compressed, length, trailerText = bytesToUtf8(payload)))
            } else {
                // Compressed data frames can't be inflated without knowing the codec;
                // best-effort: attempt to decode as protobuf regardless (will yield an
                // empty/partial tree for genuinely compressed bytes, which is still useful
                // signal — the frame is at least identified and length-correct).
                frames.add(GrpcWebFrame(isTrailer, compressed, length, message = decodeProtobuf(payload)))
            }
        }
    } catch (_: Exception) {
        // Swallow — return whatever frames were parsed so far.
    }

    return frames
}

internal fun formatGrpcWebFrames(frames: List<GrpcWebFrame>): String {
    val lines = mutableListOf<String>()
    frames.forEachIndexed { i, frame ->
        if (frame.isTrailer) {
            lines.add("[frame $i] trailer (${frame.length} bytes):")
            lines.add(frame.trailerText ?: "")
        } else {
            val compressedSuffix = if (frame.compressed) ", compressed" else ""
            lines.add("[frame $i] message (${frame.length} bytes$compressedSuffix):")
            lines.add(formatProtoFields(frame.message ?: emptyList()))
        }
    }
    return lines.joinToString("\n")
}

private val GRPC_WEB_CONTENT_TYPES = setOf(
    "application/grpc-web",
    "application/grpc-web+proto",
    "application/grpc-web-text",
    "application/grpc-web+text",
)

internal val grpcWebDecoder = object : BodyDecoder {
    override val id = "grpc-web"

    override fun decode(body: String, contentType: String?, contentEncoding: String?): String? {
        val ct = contentTypeWithoutParams(contentType) ?: return null
        if (ct !in GRPC_WEB_CONTENT_TYPES) return null

        val frames = decodeGrpcWeb(body, ct)
        if (frames.isEmpty()) return null
        return formatGrpcWebFrames(frames)
    }
}
