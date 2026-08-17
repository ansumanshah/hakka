package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class LogRedactionTest {
    @Test
    fun `returns null metadata unchanged`() {
        assertNull(redactLogMetadata(null, setOf("password")))
    }

    @Test
    fun `returns metadata unchanged when no sensitive fields configured`() {
        val metadata = mapOf("password" to "hunter2")
        assertEquals(metadata, redactLogMetadata(metadata, emptySet()))
    }

    @Test
    fun `redacts matching field case-insensitively`() {
        val metadata = mapOf("Password" to "hunter2", "userId" to "123")
        val result = redactLogMetadata(metadata, setOf("password"))
        assertEquals("██", result?.get("Password"))
        assertEquals("123", result?.get("userId"))
    }

    @Test
    fun `leaves non-matching fields untouched`() {
        val metadata = mapOf("userId" to "123", "action" to "login")
        val result = redactLogMetadata(metadata, setOf("password"))
        assertEquals(metadata, result)
    }
}
