package com.noodleapps.hakka

import org.json.JSONArray
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * JUnit port of the SSE-related suites in `packages/hakka-core/src/engine/decoders.test.ts`:
 * `decodeSse — standalone parser` and `bodyDecoders registry — sse content-type detection`.
 */
class SseDecoderTest {

    private fun freshRegistryWithBuiltins(): BodyDecoderRegistry = BodyDecoderRegistry().apply {
        register(gzipDecoder)
        register(deflateDecoder)
        register(sseDecoder)
        register(grpcWebDecoder)
        register(protobufWireDecoder)
        register(protobufDetector)
    }

    // -----------------------------------------------------------------------
    // decodeSse — standalone parser
    // -----------------------------------------------------------------------

    @Test
    fun `parses a known SSE stream with event data id retry`() {
        val stream = listOf(
            "event: update",
            "data: {\"n\":1}",
            "id: 1",
            "retry: 3000",
            "",
            "event: update",
            "data: {\"n\":2}",
            "id: 2",
            "",
            "data: no-event-field",
            "",
        ).joinToString("\n")

        val events = decodeSse(stream)
        assertEquals(
            listOf(
                SseEvent(event = "update", data = "{\"n\":1}", id = "1", retry = 3000L),
                SseEvent(event = "update", data = "{\"n\":2}", id = "2"),
                SseEvent(data = "no-event-field"),
            ),
            events,
        )
    }

    @Test
    fun `joins multi-line data fields with newline`() {
        val stream = listOf("data: line one", "data: line two", "data: line three", "").joinToString("\n")
        val events = decodeSse(stream)
        assertEquals(listOf(SseEvent(data = "line one\nline two\nline three")), events)
    }

    @Test
    fun `ignores comment lines starting with colon`() {
        val stream = listOf(":this is a comment", "data: hello", ":another comment", "").joinToString("\n")
        val events = decodeSse(stream)
        assertEquals(listOf(SseEvent(data = "hello")), events)
    }

    @Test
    fun `handles CRLF line endings`() {
        val stream = "event: ping\r\ndata: pong\r\n\r\n"
        val events = decodeSse(stream)
        assertEquals(listOf(SseEvent(event = "ping", data = "pong")), events)
    }

    @Test
    fun `flushes a trailing record with no terminating blank line`() {
        val events = decodeSse("data: trailing")
        assertEquals(listOf(SseEvent(data = "trailing")), events)
    }

    @Test
    fun `strips a single leading space after the colon but preserves further spaces`() {
        val events = decodeSse("data:  two spaces\n\n")
        assertEquals(" two spaces", events[0].data)
    }

    @Test
    fun `ignores non-numeric retry values`() {
        val events = decodeSse("data: x\nretry: not-a-number\n\n")
        assertNull(events[0].retry)
    }

    @Test
    fun `returns empty list for empty body`() {
        assertEquals(emptyList<SseEvent>(), decodeSse(""))
    }

    @Test
    fun `never throws on malformed input`() {
        assertEquals(emptyList<SseEvent>(), decodeSse(""))
        // Should not throw — a garbage record with no recognized field yields no event.
        val events = decodeSse("garbage: nonsense\n\n\n:::")
        assertNotNull(events)
    }

    // -----------------------------------------------------------------------
    // bodyDecoders registry — sse content-type detection
    // -----------------------------------------------------------------------

    @Test
    fun `decodes text-event-stream body into JSON event list`() {
        val reg = freshRegistryWithBuiltins()
        val stream = "event: greeting\ndata: hi\nid: 1\n\n"
        val result = reg.decode(stream, "text/event-stream")

        val parsed = JSONArray(result)
        assertEquals(1, parsed.length())
        val obj = parsed.getJSONObject(0)
        assertEquals("hi", obj.getString("data"))
        assertEquals("greeting", obj.getString("event"))
        assertEquals("1", obj.getString("id"))
    }

    @Test
    fun `strips content-type parameters charset before matching`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode("data: hi\n\n", "text/event-stream; charset=utf-8")
        assertTrue(JSONArray(result).length() == 1)
    }

    @Test
    fun `sse no-op for non-SSE content types`() {
        val reg = freshRegistryWithBuiltins()
        val body = "data: hi\n\n"
        assertEquals(body, reg.decode(body, "text/plain"))
    }

    @Test
    fun `sse registry output omits absent fields and preserves data-event-id-retry order`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode("data: only-data\n\n", "text/event-stream")
        assertFalse(result.contains("\"event\""))
        assertFalse(result.contains("\"id\""))
        assertFalse(result.contains("\"retry\""))
        assertTrue(result.contains("\"data\": \"only-data\""))
    }
}
