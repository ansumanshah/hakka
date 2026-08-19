package com.noodleapps.hakka

import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * JUnit port of the graphql-ws section of
 * `packages/hakka-core/src/engine/__tests__/wsDecoders.test.ts`.
 */
class GraphqlWsDecoderTest {

    @Test
    fun `decodes a graphql-ws next frame with id and payload preview`() {
        val reg = freshRegistryWithBuiltins()
        val msg = JSONObject()
            .put("type", "next")
            .put("id", "1")
            .put("payload", JSONObject().put("data", JSONObject().put("user", JSONObject().put("name", "Alice"))))
        val result = reg.decode(textFrame(msg.toString()), "graphql-transport-ws")
        assertNotNull(result)
        assertEquals("graphql-ws", result!!.kind)
        assertEquals("next #1", result.summary)
        assertNotNull(result.payloadPreview)
    }

    @Test
    fun `decodes a graphql-ws subscribe frame`() {
        val reg = freshRegistryWithBuiltins()
        val msg = JSONObject()
            .put("type", "subscribe")
            .put("id", "2")
            .put("payload", JSONObject().put("query", "{ users { id } }"))
        val result = reg.decode(textFrame(msg.toString()), "graphql-transport-ws")
        assertNotNull(result)
        assertEquals("subscribe #2", result!!.summary)
    }

    @Test
    fun `decodes a graphql-ws connection_init with no id`() {
        val reg = freshRegistryWithBuiltins()
        val msg = JSONObject().put("type", "connection_init")
        val result = reg.decode(textFrame(msg.toString()), "graphql-transport-ws")
        assertNotNull(result)
        assertEquals("connection_init", result!!.summary)
    }

    @Test
    fun `returns null for JSON that is not a graphql-ws message`() {
        val reg = freshRegistryWithBuiltins()
        val msg = JSONObject().put("type", "unknown_type_xyz").put("id", "3")
        val result = reg.decode(textFrame(msg.toString()), "graphql-transport-ws")
        assertNull(result)
    }

    @Test
    fun `returns null for a plain text frame on graphql-ws protocol`() {
        val reg = freshRegistryWithBuiltins()
        val result = reg.decode(textFrame("hello world"), "graphql-transport-ws")
        assertNull(result)
    }
}
