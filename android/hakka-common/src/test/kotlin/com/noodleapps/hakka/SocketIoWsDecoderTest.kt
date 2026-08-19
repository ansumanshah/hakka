package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * JUnit port of the Socket.IO section of
 * `packages/hakka-core/src/engine/__tests__/wsDecoders.test.ts`.
 */
class SocketIoWsDecoderTest {

    @Test
    fun `decodes a Socket_IO EVENT frame with event name and arg count`() {
        val reg = freshRegistryWithBuiltins()
        // "42" prefix: EIO type 4 (message) + SIO type 2 (EVENT)
        val result = reg.decode(textFrame("""42["chat",{"msg":"hello"}]"""), "")
        assertNotNull(result)
        assertEquals("socket.io", result!!.kind)
        assertTrue(result.summary.contains("EVENT"))
        assertTrue(result.summary.contains("chat"))
        assertTrue(result.summary.contains("1 arg"))
    }

    @Test
    fun `decodes a Socket_IO ping frame (EIO type 2)`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(textFrame("2probe"), "")
        assertNotNull(result)
        assertEquals("socket.io", result!!.kind)
        assertEquals("ping", result.summary)
    }

    @Test
    fun `decodes a Socket_IO EVENT with multiple args`() {
        val reg = freshRegistryWithBuiltins()
        // ["join","room1","room2"] -> event name "join" + 2 args (room1, room2)
        val result = reg.decode(textFrame("""42["join","room1","room2"]"""), "")
        assertNotNull(result)
        assertTrue(result!!.summary.contains("2 args"))
    }

    @Test
    fun `returns null for a plain text frame that is not Socket_IO`() {
        val reg = WsFrameDecoderRegistry().apply {
            // Only socket.io (universal) and mqtt (binary-only) registered — matches the TS
            // test's unregistering of stomp/graphql-ws so only content-based matches remain.
            register(mqttWsDecoder)
            register(socketIoWsDecoder)
        }
        val result = reg.decode(textFrame("hello world"), "")
        assertNull(result)
    }
}
