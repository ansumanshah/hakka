package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

/**
 * [LogEntry.toJson] — the element shape of a `{type:"console", payload}` bridge frame
 * (see [BridgeSink.sendConsole]). Field names and the lowercase `level` string must match
 * `LogEntry` in `packages/hakka-core/src/log/types.ts` and the `fixtures/console/` fixtures
 * exactly, since every runtime's decoder is checked against those same fixtures.
 */
class LogEntryJsonTest {
    @Test
    fun `minimal entry omits category and metadata rather than nulling them`() {
        val json = LogEntry(id = "log_1", timestamp = 1_732_000_000_000L, level = LogLevel.INFO, message = "app launched").toJson()

        assertEquals("log_1", json.getString("id"))
        assertEquals(1_732_000_000_000L, json.getLong("timestamp"))
        assertEquals("info", json.getString("level"))
        assertEquals("app launched", json.getString("message"))
        assertFalse(json.has("category"))
        assertFalse(json.has("metadata"))
    }

    @Test
    fun `full entry includes category and metadata`() {
        val json = LogEntry(
            id = "log_2",
            timestamp = 1_732_000_000_420L,
            level = LogLevel.ERROR,
            message = "checkout failed",
            category = "payments",
            metadata = mapOf("orderId" to "ord_9", "code" to "card_declined"),
        ).toJson()

        assertEquals("payments", json.getString("category"))
        assertEquals("ord_9", json.getJSONObject("metadata").getString("orderId"))
        assertEquals("card_declined", json.getJSONObject("metadata").getString("code"))
    }

    @Test
    fun `level is serialised lowercase for every LogLevel`() {
        assertEquals("debug", LogEntry("i", 1, LogLevel.DEBUG, "m").toJson().getString("level"))
        assertEquals("info", LogEntry("i", 1, LogLevel.INFO, "m").toJson().getString("level"))
        assertEquals("warn", LogEntry("i", 1, LogLevel.WARN, "m").toJson().getString("level"))
        assertEquals("error", LogEntry("i", 1, LogLevel.ERROR, "m").toJson().getString("level"))
    }
}
