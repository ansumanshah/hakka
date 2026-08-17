package com.noodleapps.hakka

/**
 * Best-effort protobuf wire-format decoder — no `.proto` schema required. Mirrors the
 * protobuf-wire section of `packages/hakka-core/src/engine/decoders.ts`.
 */

/** Wire types defined by the protobuf encoding spec. */
internal const val WIRE_VARINT = 0
internal const val WIRE_FIXED64 = 1
internal const val WIRE_LENGTH_DELIMITED = 2
internal const val WIRE_FIXED32 = 5

/**
 * A single decoded protobuf field in the best-effort field tree.
 *
 * Exactly one of [varintValue] (wireType 0), [fixed64Bits] (wireType 1), [fixed32Bits]
 * (wireType 5), or one of [messageValue] / [stringValue] / [bytesHex] (wireType 2, selected
 * by [isMessage] / [isString] / [isBytes]) is populated, mirroring the TS `ProtoField` union.
 *
 * [varintValue] and [fixed64Bits] use a signed [Long] (63 usable bits of precision) rather
 * than an arbitrary-precision bigint like core's TS port — sufficient for every field value
 * Hakka's best-effort preview needs to show in practice; a genuine full-range unsigned
 * 64-bit varint (the top few bits of the uint64 range) would print as its two's-complement
 * form. [formatProtoFields] renders the *unsigned* decimal for fixed64/fixed32 raw bits to
 * match core's `>>> 0` / non-negative-bigint display.
 */
data class ProtoField(
    val field: Int,
    val wireType: Int,
    val varintValue: Long? = null,
    val fixed64Bits: Long? = null,
    val doubleValue: Double? = null,
    val fixed32Bits: Int? = null,
    val floatValue: Float? = null,
    val messageValue: List<ProtoField>? = null,
    val stringValue: String? = null,
    val bytesHex: String? = null,
    val isMessage: Boolean = false,
    val isString: Boolean = false,
    val isBytes: Boolean = false,
)

private class ProtoDecodeException(message: String) : Exception(message)

internal class ProtoReader(private val bytes: ByteArray) {
    private var pos = 0

    val remaining: Int
        get() = bytes.size - pos

    fun eof(): Boolean = pos >= bytes.size

    fun readByte(): Int {
        if (pos >= bytes.size) throw ProtoDecodeException("unexpected EOF")
        return bytes[pos++].toInt() and 0xff
    }

    /** Reads a base-128 varint as a [Long] (see the [ProtoField] doc for the precision caveat). */
    fun readVarint(): Long {
        var result = 0L
        var shift = 0
        for (i in 0 until 10) {
            val b = readByte()
            result = result or ((b.toLong() and 0x7f) shl shift)
            if (b and 0x80 == 0) return result
            shift += 7
        }
        throw ProtoDecodeException("varint too long")
    }

    fun readFixed64(): Long {
        if (remaining < 8) throw ProtoDecodeException("unexpected EOF (fixed64)")
        var result = 0L
        for (i in 0 until 8) {
            result = result or ((bytes[pos + i].toLong() and 0xff) shl (8 * i))
        }
        pos += 8
        return result
    }

    fun readFixed32(): Int {
        if (remaining < 4) throw ProtoDecodeException("unexpected EOF (fixed32)")
        val b0 = bytes[pos].toInt() and 0xff
        val b1 = bytes[pos + 1].toInt() and 0xff
        val b2 = bytes[pos + 2].toInt() and 0xff
        val b3 = bytes[pos + 3].toInt() and 0xff
        val result = b0 or (b1 shl 8) or (b2 shl 16) or (b3 shl 24)
        pos += 4
        return result
    }

    fun readBytes(len: Int): ByteArray {
        if (len < 0 || remaining < len) throw ProtoDecodeException("unexpected EOF (length-delimited)")
        val slice = bytes.copyOfRange(pos, pos + len)
        pos += len
        return slice
    }
}

/**
 * True when [bytes] looks like valid, printable-ish UTF-8 text. Used to decide whether a
 * length-delimited field should render as a string instead of raw hex bytes.
 */
internal fun looksLikeUtf8Text(bytes: ByteArray): Boolean {
    if (bytes.isEmpty()) return true
    var i = 0
    var printable = 0
    while (i < bytes.size) {
        val b = bytes[i].toInt() and 0xff
        if (b == 0x09 || b == 0x0a || b == 0x0d) {
            printable++
            i++
            continue
        }
        if (b < 0x20 || b == 0x7f) return false // control chars — not text
        if (b < 0x80) {
            printable++
            i++
            continue
        }
        // Multi-byte UTF-8 sequence lengths
        val extra = when {
            b and 0xe0 == 0xc0 -> 1
            b and 0xf0 == 0xe0 -> 2
            b and 0xf8 == 0xf0 -> 3
            else -> return false
        }
        if (i + extra >= bytes.size) return false
        for (j in 1..extra) {
            if ((bytes[i + j].toInt() and 0xc0) != 0x80) return false
        }
        printable++
        i += extra + 1
    }
    return printable > 0
}

internal fun bytesToUtf8(bytes: ByteArray): String = String(bytes, Charsets.UTF_8)

internal fun bytesToHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

private sealed interface LengthDelimitedClassification {
    data class Message(val fields: List<ProtoField>) : LengthDelimitedClassification
    data class Str(val text: String) : LengthDelimitedClassification
    data class Bytes(val hex: String) : LengthDelimitedClassification
}

/**
 * Attempt to parse [bytes] as a nested protobuf sub-message. Returns the field tree on
 * success, or null if the bytes don't look like a valid message.
 */
private fun tryParseSubMessage(bytes: ByteArray): List<ProtoField>? {
    if (bytes.isEmpty()) return emptyList()
    return try {
        val fields = parseProtoFields(ProtoReader(bytes))
        // A "clean" parse: consumed all bytes and produced at least one field.
        if (fields.isEmpty()) null else fields
    } catch (_: Exception) {
        null
    }
}

/**
 * Classify a length-delimited (wire type 2) payload as a nested sub-message, a UTF-8 string,
 * or raw bytes. Plain printable text wins over an ambiguous sub-message interpretation — a
 * sub-message is only attempted when the bytes do NOT look like clean printable text (see
 * [looksLikeUtf8Text]'s doc in decoders.ts for the rationale).
 */
private fun classifyLengthDelimited(raw: ByteArray): LengthDelimitedClassification {
    if (!looksLikeUtf8Text(raw)) {
        val sub = tryParseSubMessage(raw)
        if (sub != null) return LengthDelimitedClassification.Message(sub)
        return LengthDelimitedClassification.Bytes(bytesToHex(raw))
    }
    return LengthDelimitedClassification.Str(bytesToUtf8(raw))
}

/** Parses all top-level fields out of [reader] until EOF. Throws on malformed data. */
private fun parseProtoFields(reader: ProtoReader): List<ProtoField> {
    val fields = mutableListOf<ProtoField>()
    while (!reader.eof()) {
        val tagValue = reader.readVarint()
        val fieldNum = (tagValue ushr 3).toInt()
        val wireType = (tagValue and 0x7L).toInt()
        if (fieldNum < 1) throw ProtoDecodeException("invalid field number")

        when (wireType) {
            WIRE_VARINT -> fields.add(ProtoField(fieldNum, wireType, varintValue = reader.readVarint()))
            WIRE_FIXED64 -> {
                val bits = reader.readFixed64()
                fields.add(ProtoField(fieldNum, wireType, fixed64Bits = bits, doubleValue = java.lang.Double.longBitsToDouble(bits)))
            }
            WIRE_FIXED32 -> {
                val bits = reader.readFixed32()
                fields.add(ProtoField(fieldNum, wireType, fixed32Bits = bits, floatValue = java.lang.Float.intBitsToFloat(bits)))
            }
            WIRE_LENGTH_DELIMITED -> {
                val len = reader.readVarint().toInt()
                val raw = reader.readBytes(len)
                fields.add(fieldFromClassification(fieldNum, wireType, classifyLengthDelimited(raw)))
            }
            else -> {
                // Wire type 3/4 (deprecated groups) or anything unrecognized — bail out of
                // this level; malformed/unsupported data still yields a partial tree.
                throw ProtoDecodeException("unsupported wire type $wireType")
            }
        }
    }
    return fields
}

private fun fieldFromClassification(fieldNum: Int, wireType: Int, classified: LengthDelimitedClassification): ProtoField =
    when (classified) {
        is LengthDelimitedClassification.Message -> ProtoField(fieldNum, wireType, messageValue = classified.fields, isMessage = true)
        is LengthDelimitedClassification.Str -> ProtoField(fieldNum, wireType, stringValue = classified.text, isString = true)
        is LengthDelimitedClassification.Bytes -> ProtoField(fieldNum, wireType, bytesHex = classified.hex, isBytes = true)
    }

/**
 * Best-effort protobuf wire-format decoder — no `.proto` schema required.
 *
 * Walks the raw bytes as a sequence of (field number, wire type) tags, decoding
 * varint/64-bit/length-delimited/32-bit values. Length-delimited values are recursively
 * re-parsed as nested sub-messages when they decode cleanly; otherwise they're rendered as
 * UTF-8 text or, failing that, hex bytes.
 *
 * Never throws: on malformed/truncated input this returns whatever fields were successfully
 * parsed before the failure (a partial tree), or an empty list.
 */
fun decodeProtobuf(bytes: ByteArray): List<ProtoField> {
    return try {
        parseProtoFields(ProtoReader(bytes))
    } catch (_: Exception) {
        // Best-effort partial recovery: re-parse byte-by-byte, collecting fields until we hit
        // the point of failure, so a malformed tail doesn't erase an otherwise-valid prefix.
        val partial = mutableListOf<ProtoField>()
        val reader = ProtoReader(bytes)
        try {
            while (!reader.eof()) {
                val before = reader.remaining
                val tagValue = reader.readVarint()
                val fieldNum = (tagValue ushr 3).toInt()
                val wireType = (tagValue and 0x7L).toInt()
                if (fieldNum < 1) break

                when (wireType) {
                    WIRE_VARINT -> partial.add(ProtoField(fieldNum, wireType, varintValue = reader.readVarint()))
                    WIRE_FIXED64 -> {
                        val bits = reader.readFixed64()
                        partial.add(ProtoField(fieldNum, wireType, fixed64Bits = bits, doubleValue = java.lang.Double.longBitsToDouble(bits)))
                    }
                    WIRE_FIXED32 -> {
                        val bits = reader.readFixed32()
                        partial.add(ProtoField(fieldNum, wireType, fixed32Bits = bits, floatValue = java.lang.Float.intBitsToFloat(bits)))
                    }
                    WIRE_LENGTH_DELIMITED -> {
                        val len = reader.readVarint().toInt()
                        val raw = reader.readBytes(len)
                        partial.add(fieldFromClassification(fieldNum, wireType, classifyLengthDelimited(raw)))
                    }
                    else -> break
                }

                // Safety valve: if we didn't make progress, stop to avoid an infinite loop.
                if (reader.remaining >= before) break
            }
        } catch (_: Exception) {
            // Swallow — return whatever we accumulated so far.
        }
        partial
    }
}

/** Render a ProtoField tree as an indented, human-readable string (used by the registry decoder). */
internal fun formatProtoFields(fields: List<ProtoField>, indent: Int = 0): String {
    val pad = "  ".repeat(indent)
    val lines = mutableListOf<String>()
    for (f in fields) {
        when {
            f.isMessage -> {
                lines.add("$pad${f.field} (message):")
                lines.add(formatProtoFields(f.messageValue.orEmpty(), indent + 1))
            }
            f.isString -> lines.add("$pad${f.field} (string): ${jsonQuote(f.stringValue.orEmpty())}")
            f.isBytes -> lines.add("$pad${f.field} (bytes): ${f.bytesHex}")
            f.wireType == WIRE_FIXED64 -> {
                val bitsStr = f.fixed64Bits?.let { java.lang.Long.toUnsignedString(it) } ?: "0"
                lines.add("$pad${f.field} (fixed64): $bitsStr (double: ${f.doubleValue})")
            }
            f.wireType == WIRE_FIXED32 -> {
                val bitsStr = f.fixed32Bits?.let { (it.toLong() and 0xffffffffL).toString() } ?: "0"
                lines.add("$pad${f.field} (fixed32): $bitsStr (float: ${f.floatValue})")
            }
            else -> lines.add("$pad${f.field} (varint): ${f.varintValue}")
        }
    }
    return lines.joinToString("\n")
}

private val PROTOBUF_WIRE_CONTENT_TYPES = setOf("application/x-protobuf", "application/protobuf")

/**
 * Registry decoder for standalone protobuf bodies (not gRPC-wrapped): performs the full
 * best-effort wire-format walk and returns a readable field tree. Registered before
 * [protobufDetector] so `application/x-protobuf` / `application/protobuf` get the
 * fully-decoded tree while `application/grpc` / `application/grpc+proto` (unary gRPC, not
 * gRPC-web) keep the lightweight fingerprint preview.
 */
internal val protobufWireDecoder = object : BodyDecoder {
    override val id = "protobuf-wire"

    override fun decode(body: String, contentType: String?, contentEncoding: String?): String? {
        val ct = contentTypeWithoutParams(contentType) ?: return null
        if (ct !in PROTOBUF_WIRE_CONTENT_TYPES) return null

        val bytes = base64Decode(body)
        if (bytes == null || bytes.isEmpty()) return null

        val fields = decodeProtobuf(bytes)
        if (fields.isEmpty()) return null
        return formatProtoFields(fields)
    }
}
