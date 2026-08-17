package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.Base64

/**
 * JUnit port of `decodeGrpcWeb — length-prefixed frames` and
 * `bodyDecoders registry — grpc-web decoder` from
 * `packages/hakka-core/src/engine/decoders.test.ts`.
 */
class GrpcWebDecoderTest {

    private fun freshRegistryWithBuiltins(): BodyDecoderRegistry = BodyDecoderRegistry().apply {
        register(gzipDecoder)
        register(deflateDecoder)
        register(sseDecoder)
        register(grpcWebDecoder)
        register(protobufWireDecoder)
        register(protobufDetector)
    }

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

    private fun tag(fieldNum: Int, wireType: Int): List<Int> = encodeVarint((fieldNum.toLong() shl 3) or wireType.toLong())

    private fun u32be(n: Int): List<Int> = listOf((n ushr 24) and 0xff, (n ushr 16) and 0xff, (n ushr 8) and 0xff, n and 0xff)

    /** Builds a single gRPC-web frame: [compression byte][4-byte BE length][payload]. */
    private fun grpcWebFrame(payload: List<Int>, trailer: Boolean = false, compressed: Boolean = false): List<Int> {
        var flag = 0
        if (trailer) flag = flag or 0x80
        if (compressed) flag = flag or 0x01
        return listOf(flag) + u32be(payload.size) + payload
    }

    private fun toBytes(ints: List<Int>): ByteArray = ints.map { it.toByte() }.toByteArray()

    private fun toBase64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    // -----------------------------------------------------------------------
    // decodeGrpcWeb — length-prefixed frames
    // -----------------------------------------------------------------------

    @Test
    fun `decodes a single data frame and hands the message to decodeProtobuf`() {
        val message = tag(1, 0) + encodeVarint(99)
        val frameBytes = toBytes(grpcWebFrame(message))
        val b64 = toBase64(frameBytes)

        val frames = decodeGrpcWeb(b64, "application/grpc-web+proto")
        assertEquals(1, frames.size)
        assertEquals(false, frames[0].isTrailer)
        assertEquals(false, frames[0].compressed)
        assertEquals(listOf(ProtoField(field = 1, wireType = 0, varintValue = 99L)), frames[0].message)
    }

    @Test
    fun `decodes multiple data frames followed by a trailer frame`() {
        val msg1 = tag(1, 0) + encodeVarint(1)
        val msg2 = tag(1, 0) + encodeVarint(2)
        val trailerText = "grpc-status: 0\r\ngrpc-message: OK\r\n"
        val trailerPayload = trailerText.toByteArray(Charsets.UTF_8).map { it.toInt() and 0xff }

        val allBytes = toBytes(
            grpcWebFrame(msg1) + grpcWebFrame(msg2) + grpcWebFrame(trailerPayload, trailer = true),
        )
        val b64 = toBase64(allBytes)

        val frames = decodeGrpcWeb(b64, "application/grpc-web+proto")
        assertEquals(3, frames.size)
        assertEquals(listOf(ProtoField(field = 1, wireType = 0, varintValue = 1L)), frames[0].message)
        assertEquals(listOf(ProtoField(field = 1, wireType = 0, varintValue = 2L)), frames[1].message)
        assertEquals(true, frames[2].isTrailer)
        assertEquals(trailerText, frames[2].trailerText)
    }

    @Test
    fun `base64-decodes the whole body first for grpc-web-text`() {
        val message = tag(1, 0) + encodeVarint(7)
        val frameBytes = toBytes(grpcWebFrame(message))
        val b64 = toBase64(frameBytes)

        val frames = decodeGrpcWeb(b64, "application/grpc-web-text")
        assertEquals(1, frames.size)
        assertEquals(listOf(ProtoField(field = 1, wireType = 0, varintValue = 7L)), frames[0].message)
    }

    @Test
    fun `marks the compression flag on a compressed data frame`() {
        val message = tag(1, 0) + encodeVarint(1)
        val frameBytes = toBytes(grpcWebFrame(message, compressed = true))
        val b64 = toBase64(frameBytes)

        val frames = decodeGrpcWeb(b64, "application/grpc-web+proto")
        assertEquals(true, frames[0].compressed)
    }

    @Test
    fun `never throws on malformed truncated frame data`() {
        // Claims a 100-byte payload but only provides 2 bytes
        val truncated = toBytes(listOf(0x00) + u32be(100) + listOf(0x01, 0x02))
        val b64 = toBase64(truncated)

        val frames = decodeGrpcWeb(b64, "application/grpc-web+proto")
        assertTrue(frames.isNotEmpty())
    }

    @Test
    fun `returns empty list for empty body`() {
        assertEquals(emptyList<GrpcWebFrame>(), decodeGrpcWeb("", "application/grpc-web+proto"))
    }

    // -----------------------------------------------------------------------
    // bodyDecoders registry — grpc-web decoder
    // -----------------------------------------------------------------------

    @Test
    fun `decodes application-grpc-web+proto body into readable frame text`() {
        val reg = freshRegistryWithBuiltins()
        val message = tag(1, 0) + encodeVarint(5)
        val frameBytes = toBytes(grpcWebFrame(message))
        val b64 = toBase64(frameBytes)

        val result = reg.decode(b64, "application/grpc-web+proto")
        assertTrue(result.contains("[frame 0] message"))
        assertTrue(result.contains("1 (varint): 5"))
    }

    @Test
    fun `decodes application-grpc-web-text body base64-encoded frames`() {
        val reg = freshRegistryWithBuiltins()
        val message = tag(1, 0) + encodeVarint(3)
        val frameBytes = toBytes(grpcWebFrame(message))
        val b64 = toBase64(frameBytes)

        val result = reg.decode(b64, "application/grpc-web-text")
        assertTrue(result.contains("[frame 0] message"))
    }

    @Test
    fun `surfaces the trailer frame in the formatted output`() {
        val reg = freshRegistryWithBuiltins()
        val trailerText = "grpc-status: 0\r\n"
        val trailerPayload = trailerText.toByteArray(Charsets.UTF_8).map { it.toInt() and 0xff }
        val allBytes = toBytes(grpcWebFrame(trailerPayload, trailer = true))
        val b64 = toBase64(allBytes)

        val result = reg.decode(b64, "application/grpc-web+proto")
        assertTrue(result.contains("trailer"))
        assertTrue(result.contains("grpc-status: 0"))
    }

    @Test
    fun `grpc-web no-op for non-grpc-web content types`() {
        val reg = freshRegistryWithBuiltins()
        val body = "not grpc-web"
        assertEquals(body, reg.decode(body, "application/json"))
    }
}
