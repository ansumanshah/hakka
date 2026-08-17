package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.Base64

/**
 * JUnit port of `decodeProtobuf — hand-built messages` and
 * `bodyDecoders registry — protobuf-wire decoder` from
 * `packages/hakka-core/src/engine/decoders.test.ts`.
 */
class ProtoWireDecoderTest {

    private fun freshRegistryWithBuiltins(): BodyDecoderRegistry = BodyDecoderRegistry().apply {
        register(gzipDecoder)
        register(deflateDecoder)
        register(sseDecoder)
        register(grpcWebDecoder)
        register(protobufWireDecoder)
        register(protobufDetector)
    }

    /** Encode a protobuf varint tag + value for hand-built test fixtures. */
    private fun encodeVarint(n: Long): List<Int> {
        var v = n
        val out = mutableListOf<Int>()
        do {
            var byte = (v and 0x7f).toInt()
            v = v ushr 7
            if (v != 0L) byte = byte or 0x80
            out.add(byte)
        } while (v != 0L)
        return out
    }

    private fun tag(fieldNum: Int, wireType: Int): List<Int> = encodeVarint(((fieldNum.toLong() shl 3) or wireType.toLong()))

    private fun strBytes(s: String): List<Int> = s.toByteArray(Charsets.UTF_8).map { it.toInt() and 0xff }

    private fun bytesOf(vararg parts: List<Int>): ByteArray =
        parts.flatMap { it }.map { it.toByte() }.toByteArray()

    // -----------------------------------------------------------------------
    // decodeProtobuf — hand-built messages
    // -----------------------------------------------------------------------

    @Test
    fun `decodes a varint field wire type 0`() {
        // field 1, varint value 150 (classic protobuf spec example: 0x08 0x96 0x01)
        val bytes = bytesOf(tag(1, 0), encodeVarint(150))
        val fields = decodeProtobuf(bytes)
        assertEquals(1, fields.size)
        assertEquals(ProtoField(field = 1, wireType = 0, varintValue = 150L), fields[0])
    }

    @Test
    fun `decodes a length-delimited string field wire type 2`() {
        // field 2, wire type 2, length 5, "hello"
        val bytes = bytesOf(tag(2, 2), encodeVarint(5), strBytes("hello"))
        val fields = decodeProtobuf(bytes)
        assertEquals(1, fields.size)
        assertEquals(2, fields[0].field)
        assertEquals(2, fields[0].wireType)
        assertTrue(fields[0].isString)
        assertEquals("hello", fields[0].stringValue)
    }

    @Test
    fun `decodes multiple fields of different wire types in one message`() {
        // field 1 varint=42, field 2 string="hi", field 3 fixed32 (1.0f little-endian)
        val fixed32Bytes = listOf(0x00, 0x00, 0x80, 0x3f)
        val bytes = bytesOf(
            tag(1, 0), encodeVarint(42),
            tag(2, 2), encodeVarint(2), strBytes("hi"),
            tag(3, 5), fixed32Bytes,
        )
        val fields = decodeProtobuf(bytes)
        assertEquals(3, fields.size)
        assertEquals(ProtoField(field = 1, wireType = 0, varintValue = 42L), fields[0])
        assertEquals("hi", fields[1].stringValue)
        assertEquals(5, fields[2].wireType)
        assertEquals(1.0f, fields[2].floatValue)
    }

    @Test
    fun `recurses into a length-delimited field that parses cleanly as a sub-message`() {
        // Inner message: field 1, varint 7
        val inner = bytesOf(tag(1, 0), encodeVarint(7))
        // Outer: field 5, wire type 2, length=inner.size, inner bytes
        val outer = bytesOf(tag(5, 2), encodeVarint(inner.size.toLong())) + inner
        val fields = decodeProtobuf(outer)
        assertEquals(1, fields.size)
        assertTrue(fields[0].isMessage)
        assertEquals(listOf(ProtoField(field = 1, wireType = 0, varintValue = 7L)), fields[0].messageValue)
    }

    @Test
    fun `renders non-UTF8 length-delimited bytes as hex bytes`() {
        // Bytes with an invalid UTF-8 continuation and control chars — won't parse as a
        // sub-message and isn't valid text.
        val raw = byteArrayOf(0xff.toByte(), 0x00, 0x01, 0x02)
        val bytes = bytesOf(tag(9, 2), encodeVarint(raw.size.toLong())) + raw
        val fields = decodeProtobuf(bytes)
        assertEquals(1, fields.size)
        assertTrue(fields[0].isBytes)
        assertTrue(fields[0].bytesHex is String)
    }

    @Test
    fun `never throws and returns a partial tree on malformed truncated input`() {
        // Valid first field, then a truncated second field (length-delimited length=10 but
        // only 2 bytes follow)
        val bytes = bytesOf(tag(1, 0), encodeVarint(5), tag(2, 2), encodeVarint(10), listOf(0x01, 0x02))
        val fields = decodeProtobuf(bytes)
        assertTrue(fields.isNotEmpty())
        assertEquals(ProtoField(field = 1, wireType = 0, varintValue = 5L), fields[0])
    }

    @Test
    fun `returns empty list for empty input`() {
        assertEquals(emptyList<ProtoField>(), decodeProtobuf(ByteArray(0)))
    }

    @Test
    fun `never throws on completely random garbage bytes`() {
        val garbage = ByteArray(12) { 0xff.toByte() }
        // Must not throw — result contents aren't asserted (best-effort partial recovery).
        decodeProtobuf(garbage)
    }

    // -----------------------------------------------------------------------
    // bodyDecoders registry — protobuf-wire decoder
    // -----------------------------------------------------------------------

    @Test
    fun `decodes application-x-protobuf into a readable field tree`() {
        val reg = freshRegistryWithBuiltins()
        val bytes = bytesOf(tag(1, 0), encodeVarint(42))
        val b64 = Base64.getEncoder().encodeToString(bytes)
        val result = reg.decode(b64, "application/x-protobuf")
        assertTrue(result.contains("1 (varint): 42"))
    }

    @Test
    fun `protobuf-wire no-op for non-protobuf content types`() {
        val reg = freshRegistryWithBuiltins()
        val body = "not protobuf"
        assertEquals(body, reg.decode(body, "text/plain"))
    }
}
