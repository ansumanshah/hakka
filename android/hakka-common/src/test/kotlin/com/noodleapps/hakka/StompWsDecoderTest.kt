package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * JUnit port of the STOMP section of
 * `packages/hakka-core/src/engine/__tests__/wsDecoders.test.ts`.
 */
class StompWsDecoderTest {

    private val term = Char(0)

    @Test
    fun `decodes a STOMP SEND frame with destination and body`() {
        val reg = freshRegistryWithBuiltins()
        val frame = "SEND\ndestination:/queue/orders\ncontent-type:application/json\n\n{\"order\":1}$term"
        val result = reg.decode(textFrame(frame), "v12.stomp")
        assertNotNull(result)
        assertEquals("stomp", result!!.kind)
        assertEquals("SEND /queue/orders", result.summary)
        assertEquals("/queue/orders", result.topic)
        assertEquals("""{"order":1}""", result.payloadPreview)
    }

    @Test
    fun `decodes a STOMP MESSAGE frame`() {
        val reg = freshRegistryWithBuiltins()
        val frame = "MESSAGE\ndestination:/topic/news\nsubscription:sub-0\n\nbreaking news$term"
        val result = reg.decode(textFrame(frame), "v11.stomp")
        assertNotNull(result)
        assertEquals("stomp", result!!.kind)
        assertTrue(result.summary.contains("MESSAGE"))
        assertEquals("/topic/news", result.topic)
    }

    @Test
    fun `returns null for an unrecognised STOMP command`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(textFrame("WHATEVER\n\n$term"), "v12.stomp")
        assertNull(result)
    }

    @Test
    fun `returns null for a plain text frame on stomp protocol`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(textFrame("hello world"), "v12.stomp")
        assertNull(result)
    }
}
