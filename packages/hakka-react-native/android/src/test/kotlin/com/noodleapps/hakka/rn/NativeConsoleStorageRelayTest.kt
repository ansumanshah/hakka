package com.noodleapps.hakka.rn

import com.noodleapps.hakka.LogEntry
import com.noodleapps.hakka.LogLevel
import com.noodleapps.hakka.StorageSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * [NativeCoreDelegate]'s `onHakkaConsole`/`onHakkaStorage` relay (`logEntryToWritableMap` /
 * `storageSnapshotToWritableMap`) hand-mirrors [LogEntry.toJson] / [StorageSnapshot.toJson] field
 * for field, since those two methods aren't directly reachable from a `WritableMap`-based unit
 * test without a real RN/Android runtime (this module has no Robolectric setup — see
 * `HakkaMockEngineTest` for the existing precedent of testing only Android/RN-runtime-free
 * logic here). This file locks down the exact contract the relay mirrors: field names, the
 * lowercase `level` string, and category/metadata being omitted (not nulled) when absent —
 * matching `fixtures/console/` and `fixtures/storage/` exactly, same as
 * `LogEntryJsonTest`/`StorageSnapshotTest` in hakka-common.
 */
class NativeConsoleStorageRelayTest {
    @Test
    fun `minimal LogEntry omits category and metadata`() {
        val json = LogEntry(id = "log_1", timestamp = 1_732_000_000_000L, level = LogLevel.INFO, message = "app launched").toJson()

        assertEquals("log_1", json.getString("id"))
        assertEquals(1_732_000_000_000L, json.getLong("timestamp"))
        assertEquals("info", json.getString("level"))
        assertEquals("app launched", json.getString("message"))
        assertFalse(json.has("category"))
        assertFalse(json.has("metadata"))
    }

    @Test
    fun `full LogEntry includes category and metadata`() {
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
    fun `StorageSnapshot serialises store, timestamp, and entries`() {
        val json = StorageSnapshot(
            store = "sharedPreferences:auth_prefs",
            timestampMs = 1_732_000_000_500L,
            entries = mapOf("userId" to "user_42"),
        ).toJson()

        assertEquals("sharedPreferences:auth_prefs", json.getString("store"))
        assertEquals(1_732_000_000_500L, json.getLong("timestamp"))
        assertEquals("user_42", json.getJSONObject("entries").getString("userId"))
    }
}
