package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** Mirrors packages/hakka-core/src/utils/urlCodec.test.ts. */
class UrlCodecTest {

    // ── isUrlEncoded ─────────────────────────────────────────────────────

    @Test
    fun `isUrlEncoded returns true for a URL with percent sequence`() {
        assertTrue(isUrlEncoded("https://example.com/path?q=hello%20world"))
    }

    @Test
    fun `isUrlEncoded returns false for a plain URL`() {
        assertFalse(isUrlEncoded("https://example.com/path?q=hello world"))
    }

    @Test
    fun `isUrlEncoded returns false for an empty string`() {
        assertFalse(isUrlEncoded(""))
    }

    @Test
    fun `isUrlEncoded returns true for percent-2F in path`() {
        assertTrue(isUrlEncoded("/api%2Fv1"))
    }

    // ── decodeUrl ────────────────────────────────────────────────────────

    @Test
    fun `decodeUrl decodes a percent-encoded URL`() {
        assertEquals(
            "https://example.com/search?q=hello world",
            decodeUrl("https://example.com/search?q=hello%20world"),
        )
    }

    @Test
    fun `decodeUrl returns original string for a non-encoded URL`() {
        val url = "https://example.com/path"
        assertEquals(url, decodeUrl(url))
    }

    @Test
    fun `decodeUrl falls back to original on malformed encoding`() {
        val malformed = "https://example.com/%GG"
        assertEquals(malformed, decodeUrl(malformed))
    }

    @Test
    fun `decodeUrl falls back to original on truncated percent at end`() {
        val malformed = "https://example.com/100%"
        assertEquals(malformed, decodeUrl(malformed))
    }

    @Test
    fun `decodeUrl decodes unicode sequences`() {
        assertEquals("中文", decodeUrl("%E4%B8%AD%E6%96%87"))
    }

    @Test
    fun `decodeUrl leaves plus sign untouched (not form decoding)`() {
        // decodeURIComponent semantics: '+' is literal, unlike application-x-www-form-urlencoded —
        // only the %20 sequence decodes, the '+' passes through unchanged.
        assertEquals("a+b c", decodeUrl("a+b%20c"))
    }

    // ── encodeUrl ────────────────────────────────────────────────────────

    @Test
    fun `encodeUrl is a no-op on an already-encoded URL`() {
        val encoded = "https://example.com/search?q=hello%20world"
        assertEquals(encoded, encodeUrl(encoded))
    }

    @Test
    fun `encodeUrl encodes a URL with spaces`() {
        val result = encodeUrl("https://example.com/search?q=hello world")
        assertTrue(result.contains("%20"))
        assertFalse(result.contains(" "))
    }

    @Test
    fun `encodeUrl preserves unreserved chars`() {
        val url = "https://example.com/path-to_resource.txt"
        assertEquals(url, encodeUrl(url))
    }

    @Test
    fun `encodeUrl round-trips through decode then encode`() {
        val original = "https://example.com/path?q=hello%20world&lang=en"
        val decoded = decodeUrl(original)
        val reencoded = encodeUrl(decoded)
        assertTrue(reencoded.contains("%20"))
        assertFalse(reencoded.contains(" "))
    }

    // ── percentDecode (query param key/value convenience alias) ─────────

    @Test
    fun `percentDecode decodes a query value`() {
        assertEquals("hello world", percentDecode("hello%20world"))
    }

    @Test
    fun `percentDecode falls back on malformed input`() {
        assertEquals("100%", percentDecode("100%"))
    }
}
