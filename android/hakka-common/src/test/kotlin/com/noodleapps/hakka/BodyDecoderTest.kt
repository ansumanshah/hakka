package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.Deflater
import java.util.zip.DeflaterOutputStream
import java.util.zip.GZIPOutputStream

/**
 * JUnit port of `packages/hakka-core/src/engine/decoders.test.ts` — registry mechanics, and the
 * built-in gzip/deflate/protobuf(-legacy) decoders.
 *
 * Each test builds a fresh [BodyDecoderRegistry], mirroring the TS suite's per-test dynamic
 * `import('./decoders?v=...')` isolation trick (a "fresh module instance" there always comes
 * with the built-ins already registered — see decoders.ts's own module-load registration —
 * so [freshRegistryWithBuiltins] reproduces exactly that starting state here).
 */
class BodyDecoderTest {

    private fun freshRegistryWithBuiltins(): BodyDecoderRegistry = BodyDecoderRegistry().apply {
        register(gzipDecoder)
        register(deflateDecoder)
        register(sseDecoder)
        register(grpcWebDecoder)
        register(protobufWireDecoder)
        register(protobufDetector)
    }

    private fun toBase64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    private fun gzipBase64(text: String): String {
        val out = ByteArrayOutputStream()
        GZIPOutputStream(out).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        return toBase64(out.toByteArray())
    }

    /** HTTP Content-Encoding: deflate in practice sends zlib-wrapped deflate (RFC 2616). */
    private fun deflateBase64(text: String): String {
        val out = ByteArrayOutputStream()
        DeflaterOutputStream(out, Deflater(Deflater.DEFAULT_COMPRESSION, false)).use {
            it.write(text.toByteArray(Charsets.UTF_8))
        }
        return toBase64(out.toByteArray())
    }

    // -----------------------------------------------------------------------
    // Registry — passthrough default
    // -----------------------------------------------------------------------

    @Test
    fun `returns body unchanged when no decoders are registered`() {
        val fresh = BodyDecoderRegistry()
        assertEquals("raw body", fresh.decode("raw body", null))
    }

    @Test
    fun `returns body unchanged for unknown content types`() {
        val fresh = BodyDecoderRegistry()
        assertEquals("""{"a":1}""", fresh.decode("""{"a":1}""", "application/octet-stream"))
    }

    // -----------------------------------------------------------------------
    // Registry — register and decode
    // -----------------------------------------------------------------------

    @Test
    fun `first non-null result wins`() {
        val reg = freshRegistryWithBuiltins()
        val upper = object : BodyDecoder {
            override val id = "upper"
            override fun decode(body: String, contentType: String?, contentEncoding: String?) = body.uppercase()
        }
        val lower = object : BodyDecoder {
            override val id = "lower"
            override fun decode(body: String, contentType: String?, contentEncoding: String?) = body.lowercase()
        }
        reg.register(upper)
        reg.register(lower)

        assertEquals("HELLO", reg.decode("Hello", null))
    }

    @Test
    fun `decoder returning null defers to next decoder`() {
        val reg = freshRegistryWithBuiltins()
        val skip = object : BodyDecoder {
            override val id = "skip"
            override fun decode(body: String, contentType: String?, contentEncoding: String?): String? =
                if (contentType == "text/plain") null else "MATCHED"
        }
        val fallback = object : BodyDecoder {
            override val id = "fallback"
            override fun decode(body: String, contentType: String?, contentEncoding: String?) = "fallback:$body"
        }
        reg.register(skip)
        reg.register(fallback)

        assertEquals("fallback:hello", reg.decode("hello", "text/plain"))
        assertEquals("MATCHED", reg.decode("hello", "application/json"))
    }

    @Test
    fun `registering a decoder with duplicate id replaces the existing one`() {
        val reg = freshRegistryWithBuiltins()
        val v1 = object : BodyDecoder {
            override val id = "my-decoder"
            override fun decode(body: String, contentType: String?, contentEncoding: String?) = "v1"
        }
        val v2 = object : BodyDecoder {
            override val id = "my-decoder"
            override fun decode(body: String, contentType: String?, contentEncoding: String?) = "v2"
        }

        reg.register(v1)
        assertEquals("v1", reg.decode("x", null))

        reg.register(v2)
        assertEquals("v2", reg.decode("x", null))
    }

    @Test
    fun `all decoders returning null falls back to passthrough`() {
        val reg = freshRegistryWithBuiltins()
        val noop = object : BodyDecoder {
            override val id = "noop"
            override fun decode(body: String, contentType: String?, contentEncoding: String?): String? = null
        }
        reg.register(noop)

        assertEquals("unchanged", reg.decode("unchanged", "application/json"))
    }

    // -----------------------------------------------------------------------
    // gzip decoder — round-trip
    // -----------------------------------------------------------------------

    @Test
    fun `decompresses a gzip-compressed base64 body`() {
        val reg = freshRegistryWithBuiltins()
        val original = """{"hello":"world","n":42}"""
        val compressed = gzipBase64(original)

        assertEquals(original, reg.decode(compressed, "application/json", "gzip"))
    }

    @Test
    fun `decompresses with content-encoding x-gzip`() {
        val reg = freshRegistryWithBuiltins()
        val original = "plain text body"
        val compressed = gzipBase64(original)

        assertEquals(original, reg.decode(compressed, "text/plain", "x-gzip"))
    }

    @Test
    fun `gzip no-op when content-encoding is absent`() {
        val reg = freshRegistryWithBuiltins()
        val original = """{"hello":"world"}"""
        val compressed = gzipBase64(original)

        assertEquals(compressed, reg.decode(compressed, "application/json", null))
    }

    @Test
    fun `gzip no-op on plain body even when encoding says gzip`() {
        val reg = freshRegistryWithBuiltins()
        val plain = """{"already":"decoded"}"""

        assertEquals(plain, reg.decode(plain, "application/json", "gzip"))
    }

    @Test
    fun `gzip graceful fallback on corrupt compressed data`() {
        val reg = freshRegistryWithBuiltins()
        // Valid gzip magic prefix in base64 ("H4s..." decodes to 0x1f 0x8b ...) but garbage after.
        val corrupt = "H4sIAAAAAAAA/corrupt+data+here=="

        assertEquals(corrupt, reg.decode(corrupt, "application/json", "gzip"))
    }

    @Test
    fun `decompresses larger gzip payload correctly`() {
        val reg = freshRegistryWithBuiltins()
        val items = (0 until 100).joinToString(",") { """{"id":$it,"name":"item-$it"}""" }
        val original = """{"items":[$items]}"""
        val compressed = gzipBase64(original)

        assertEquals(original, reg.decode(compressed, "application/json", "gzip"))
    }

    // -----------------------------------------------------------------------
    // deflate decoder — round-trip
    // -----------------------------------------------------------------------

    @Test
    fun `decompresses a deflate-compressed base64 body`() {
        val reg = freshRegistryWithBuiltins()
        val original = """{"hello":"world","n":42}"""
        val compressed = deflateBase64(original)

        assertEquals(original, reg.decode(compressed, "application/json", "deflate"))
    }

    @Test
    fun `deflate no-op when content-encoding is absent`() {
        val reg = freshRegistryWithBuiltins()
        val original = "hello world"
        val compressed = deflateBase64(original)

        assertEquals(compressed, reg.decode(compressed, "text/plain", null))
    }

    @Test
    fun `deflate no-op on plain body even when encoding says deflate`() {
        val reg = freshRegistryWithBuiltins()
        val plain = """{"already":"decoded","value":42}"""

        assertEquals(plain, reg.decode(plain, "application/json", "deflate"))
    }

    @Test
    fun `deflate graceful fallback on corrupt compressed data`() {
        val reg = freshRegistryWithBuiltins()
        // 0x78 0x9c = valid zlib CMF+FLG prefix in base64: "eJw..."
        val corrupt = "eJwcorrupt+data+here=="

        assertEquals(corrupt, reg.decode(corrupt, "application/json", "deflate"))
    }

    // -----------------------------------------------------------------------
    // protobuf detector (legacy hex/base64 preview)
    // -----------------------------------------------------------------------

    // A minimal protobuf: field 1, wire type 2 (length-delimited), value "hi"
    // Tag: (1 << 3) | 2 = 0x0a, length: 0x02, payload: 0x68 0x69
    private val protoBytes = byteArrayOf(0x0a, 0x02, 0x68, 0x69)
    private val protoB64 get() = toBase64(protoBytes)

    @Test
    fun `detects application-grpc`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(protoB64, "application/grpc")
        assertTrue(result.contains("[protobuf"))
    }

    @Test
    fun `detects application-grpc+proto`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(protoB64, "application/grpc+proto")
        assertTrue(result.contains("[protobuf"))
    }

    @Test
    fun `protobuf detector no-op on non-protobuf content types`() {
        val reg = freshRegistryWithBuiltins()
        assertEquals(protoB64, reg.decode(protoB64, "application/json"))
    }

    @Test
    fun `protobuf detector no-op when content-type is null`() {
        val reg = freshRegistryWithBuiltins()
        assertEquals(protoB64, reg.decode(protoB64, null))
    }

    // -----------------------------------------------------------------------
    // application/x-protobuf now fully decoded via protobuf-wire, not the legacy preview
    // -----------------------------------------------------------------------

    @Test
    fun `decodes application-x-protobuf into a readable field tree, not a hex preview`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(protoB64, "application/x-protobuf")
        assertTrue(result.contains("1 (string): \"hi\""))
        assertTrue(!result.contains("[protobuf"))
    }

    @Test
    fun `decodes application-protobuf the same way`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(protoB64, "application/protobuf")
        assertTrue(result.contains("1 (string): \"hi\""))
    }

    @Test
    fun `strips content-type parameters before matching`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(protoB64, "application/x-protobuf; charset=binary")
        assertTrue(result.contains("1 (string): \"hi\""))
    }

    // -----------------------------------------------------------------------
    // Gate: built-in decoders must not run on normal (already-decoded) bodies
    // -----------------------------------------------------------------------

    @Test
    fun `plain JSON body with gzip encoding header passes through if not actually compressed`() {
        val reg = freshRegistryWithBuiltins()
        val plain = """{"data":"value"}"""
        assertEquals(plain, reg.decode(plain, "application/json", "gzip"))
    }

    @Test
    fun `plain text body with deflate encoding header passes through if not actually compressed`() {
        val reg = freshRegistryWithBuiltins()
        val plain = """{"already":"uncompressed"}"""
        assertEquals(plain, reg.decode(plain, "text/plain", "deflate"))
    }

    @Test
    fun `zero-overhead on the normal path — no encoding header`() {
        val reg = freshRegistryWithBuiltins()
        val plain = """{"normal":"response"}"""
        assertEquals(plain, reg.decode(plain, "application/json", null))
    }

    @Test
    fun `encoding header with unrelated value does not trigger gzip decoder`() {
        val reg = freshRegistryWithBuiltins()
        val plain = "brotli-decompressed text"
        assertEquals(plain, reg.decode(plain, "text/plain", "br"))
    }

    // -----------------------------------------------------------------------
    // contentEncoding forwarded through registry.decode()
    // -----------------------------------------------------------------------

    @Test
    fun `passes contentEncoding to each registered decoder`() {
        val reg = freshRegistryWithBuiltins()
        var seen: String? = null
        val spy = object : BodyDecoder {
            override val id = "spy"
            override fun decode(body: String, contentType: String?, contentEncoding: String?): String? {
                seen = contentEncoding
                return null
            }
        }
        reg.register(spy)
        reg.decode("body", "text/plain", "gzip")
        assertEquals("gzip", seen)
    }

    @Test
    fun `bodyDecoders singleton is pre-populated with all built-in decoders`() {
        // Sanity check on the production singleton (registration order + content matching),
        // exercised once here rather than in every other test file.
        val original = """{"ok":true}"""
        assertEquals(original, bodyDecoders.decode(gzipBase64(original), "application/json", "gzip"))
        assertNotNull(bodyDecoders.decode(protoB64, "application/grpc"))
    }
}
