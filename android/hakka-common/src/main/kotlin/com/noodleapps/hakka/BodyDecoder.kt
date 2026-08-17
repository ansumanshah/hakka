package com.noodleapps.hakka

import java.util.zip.GZIPInputStream
import java.util.zip.Inflater
import java.util.zip.InflaterInputStream

/**
 * BodyDecoder — extensible body decoding pipeline for Hakka (Android port).
 *
 * Mirrors `packages/hakka-core/src/engine/decoders.ts` almost 1:1. Register custom decoders to
 * transform raw captured bodies before display. Decoders run in registration order; the
 * first non-null result wins. If no registered decoder matches, the built-in passthrough
 * returns the body unchanged.
 *
 * Built-in decoders (auto-registered the first time [bodyDecoders] is touched, mirroring
 * core's module-load registration — see the `by lazy` block below):
 *  - "gzip"          — decompresses gzip bodies (Content-Encoding: gzip / x-gzip, base64-encoded bytes)
 *  - "deflate"       — decompresses deflate/zlib bodies (Content-Encoding: deflate)
 *  - "sse"           — parses text/event-stream bodies into a readable event list
 *  - "grpc-web"      — unframes gRPC-web length-prefixed messages and decodes each as protobuf
 *  - "protobuf-wire" — full best-effort wire-format decode for application/x-protobuf, application/protobuf
 *  - "protobuf"      — legacy hex/base64 fingerprint preview for application/grpc, application/grpc+proto
 */
interface BodyDecoder {
    /** Unique identifier for this decoder (e.g. "json-pretty", "protobuf", "msgpack"). */
    val id: String

    /**
     * Attempt to decode [body].
     * @return the decoded/transformed string, or null to defer to the next decoder.
     */
    fun decode(body: String, contentType: String?, contentEncoding: String?): String?
}

/** Built-in passthrough — always returns the body unchanged (last-resort). */
private val passthroughDecoder = object : BodyDecoder {
    override val id = "__passthrough__"
    override fun decode(body: String, contentType: String?, contentEncoding: String?): String = body
}

/**
 * Public unlike core's module-private `BodyDecoderRegistry`: Kotlin can't expose a public
 * [bodyDecoders] singleton typed internal to another module, and hakka-ui/hakka-network
 * consume it across a module boundary. Construct your own instance only for test isolation —
 * production code should go through [bodyDecoders].
 */
class BodyDecoderRegistry {
    private val decoders = mutableListOf<BodyDecoder>()

    /**
     * Register a decoder. Decoders added earlier take precedence.
     * Registering a decoder with a duplicate id replaces the existing one.
     */
    @Synchronized
    fun register(decoder: BodyDecoder) {
        val idx = decoders.indexOfFirst { it.id == decoder.id }
        if (idx != -1) decoders[idx] = decoder else decoders.add(decoder)
    }

    /**
     * Run the decoder pipeline.
     * Returns the first non-null result from a registered decoder, or the raw body via the
     * built-in passthrough.
     */
    @Synchronized
    fun decode(body: String, contentType: String?, contentEncoding: String? = null): String {
        for (decoder in decoders) {
            val result = decoder.decode(body, contentType, contentEncoding)
            if (result != null) return result
        }
        return passthroughDecoder.decode(body, contentType, contentEncoding)
    }
}

/**
 * Singleton registry — shared across the application. Built-in decoders are registered the
 * first time this is touched (thread-safe, exactly once), mirroring core's module-load
 * registration side effect.
 */
val bodyDecoders: BodyDecoderRegistry by lazy {
    BodyDecoderRegistry().also { registry ->
        // gzip/deflate run first so compressed bodies decompress before content-type checks.
        registry.register(gzipDecoder)
        registry.register(deflateDecoder)
        registry.register(sseDecoder)
        registry.register(grpcWebDecoder)
        registry.register(protobufWireDecoder)
        registry.register(protobufDetector)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when [enc] contains [token] (case-insensitive, comma-list aware: "gzip, br"). */
internal fun hasEncoding(enc: String?, token: String): Boolean {
    if (enc.isNullOrEmpty()) return false
    return enc.lowercase().split(",").map { it.trim() }.contains(token)
}

/** Content-Type with parameters stripped and lowercased: "application/json; charset=utf-8" → "application/json". */
internal fun contentTypeWithoutParams(contentType: String?): String? =
    contentType?.lowercase()?.split(";")?.firstOrNull()?.trim()

/**
 * Lenient base64 decode: the MIME decoder ignores invalid characters instead of throwing,
 * matching core's `base64ToBytes` behavior. Returns null only if decoding still fails.
 */
internal fun base64Decode(body: String): ByteArray? =
    try {
        java.util.Base64.getMimeDecoder().decode(body)
    } catch (_: IllegalArgumentException) {
        null
    }

/** True when [bytes] starts with the gzip magic bytes (0x1f 0x8b). */
internal fun looksLikeGzipBytes(bytes: ByteArray): Boolean =
    bytes.size >= 2 && bytes[0] == 0x1f.toByte() && bytes[1] == 0x8b.toByte()

/** Valid zlib FLG bytes that can follow the 0x78 CMF byte (32KB-window deflate, the HTTP-common case). */
private val DEFLATE_ZLIB_FLG = setOf(0x01, 0x5e, 0x9c, 0xda)

/**
 * True when [bytes] looks like a deflate candidate:
 *  - zlib-wrapped (CMF byte 0x78 followed by a valid FLG byte) — most HTTP servers, or
 *  - a "raw deflate" candidate — raw deflate has no reliable magic bytes, so any
 *    successfully base64-decoded body of at least 2 bytes is accepted as a candidate; the
 *    decompression step itself is the real validator (matches core's auto-detection between
 *    zlib-wrapped and raw deflate).
 */
internal fun looksLikeDeflateBytes(bytes: ByteArray): Boolean {
    if (bytes.size < 2) return false
    if (bytes[0] == 0x78.toByte()) return (bytes[1].toInt() and 0xff) in DEFLATE_ZLIB_FLG
    return true
}

/** JSON-escapes and quotes [s], matching JS `JSON.stringify` for a plain string value. */
internal fun jsonQuote(s: String): String {
    val sb = StringBuilder(s.length + 2)
    sb.append('"')
    for (ch in s) {
        when (ch) {
            '"' -> sb.append("\\\"")
            '\\' -> sb.append("\\\\")
            '\b' -> sb.append("\\b")
            '\u000C' -> sb.append("\\f")
            '\n' -> sb.append("\\n")
            '\r' -> sb.append("\\r")
            '\t' -> sb.append("\\t")
            else -> if (ch.code < 0x20) {
                sb.append("\\u").append(ch.code.toString(16).padStart(4, '0'))
            } else {
                sb.append(ch)
            }
        }
    }
    sb.append('"')
    return sb.toString()
}

// ---------------------------------------------------------------------------
// Built-in gzip decoder
// ---------------------------------------------------------------------------

internal val gzipDecoder = object : BodyDecoder {
    override val id = "gzip"

    override fun decode(body: String, contentType: String?, contentEncoding: String?): String? {
        if (!hasEncoding(contentEncoding, "gzip") && !hasEncoding(contentEncoding, "x-gzip")) return null

        val bytes = base64Decode(body) ?: return null
        // Platforms auto-decompress in the normal fetch/OkHttp path; this decoder only
        // matters for raw/proxy/native captures that deliver compressed bytes.
        if (!looksLikeGzipBytes(bytes)) return null

        return try {
            GZIPInputStream(bytes.inputStream()).use { it.readBytes() }.toString(Charsets.UTF_8)
        } catch (_: Exception) {
            // Decompression failed — return null to fall through to passthrough
            null
        }
    }
}

// ---------------------------------------------------------------------------
// Built-in deflate decoder
// ---------------------------------------------------------------------------

internal val deflateDecoder = object : BodyDecoder {
    override val id = "deflate"

    override fun decode(body: String, contentType: String?, contentEncoding: String?): String? {
        if (!hasEncoding(contentEncoding, "deflate")) return null

        val bytes = base64Decode(body) ?: return null
        if (!looksLikeDeflateBytes(bytes)) return null

        return inflateAutoDetect(bytes)
    }
}

/**
 * Inflate [bytes] as zlib-wrapped deflate first (RFC 1950), falling back to raw deflate (no
 * zlib header) — matches core's auto-detection between the two formats. Returns null when
 * both attempts fail (e.g. the body isn't actually compressed).
 */
private fun inflateAutoDetect(bytes: ByteArray): String? {
    for (nowrap in listOf(false, true)) {
        try {
            val inflater = Inflater(nowrap)
            val decoded = InflaterInputStream(bytes.inputStream(), inflater).use { it.readBytes() }
            inflater.end()
            return decoded.toString(Charsets.UTF_8)
        } catch (_: Exception) {
            // try the next mode
        }
    }
    return null
}

// ---------------------------------------------------------------------------
// Built-in protobuf detector (legacy hex/base64 fingerprint preview)
// ---------------------------------------------------------------------------

private val PROTOBUF_CONTENT_TYPES = setOf(
    "application/x-protobuf",
    "application/protobuf",
    "application/vnd.google.protobuf",
    "application/grpc",
    "application/grpc+proto",
)

/**
 * Protobuf/gRPC detection. Does NOT attempt schema-less decoding for these content types
 * (kept as the legacy fingerprint preview — application/x-protobuf and application/protobuf
 * are instead handled by [protobufWireDecoder]'s full wire-format decode, registered before
 * this one). Marks the body as protobuf and returns a structured preview with byte-length
 * and a hex/base64 snippet.
 */
internal val protobufDetector = object : BodyDecoder {
    override val id = "protobuf"

    override fun decode(body: String, contentType: String?, contentEncoding: String?): String? {
        val ct = contentTypeWithoutParams(contentType) ?: return null
        if (ct !in PROTOBUF_CONTENT_TYPES) return null

        val bytes = base64Decode(body)
        val byteLength = bytes?.size ?: body.length

        var hexPreview = ""
        if (bytes != null && bytes.isNotEmpty()) {
            val previewBytes = bytes.copyOfRange(0, minOf(32, bytes.size))
            hexPreview = previewBytes.joinToString(" ") { "%02x".format(it) }
            if (bytes.size > 32) hexPreview += " …"
        }

        val lines = mutableListOf("[protobuf — $byteLength bytes]")
        if (hexPreview.isNotEmpty()) lines.add("hex: $hexPreview")
        // Also include the raw base64 preview (first 64 chars) for copy-paste into protoc
        val b64Preview = if (body.length > 64) body.substring(0, 64) + "…" else body
        lines.add("base64: $b64Preview")

        return lines.joinToString("\n")
    }
}
