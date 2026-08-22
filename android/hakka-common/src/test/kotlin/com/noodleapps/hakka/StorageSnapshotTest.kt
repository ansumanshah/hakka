package com.noodleapps.hakka

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * [StorageSnapshot.toJson] — matches `StorageSnapshot` in
 * `packages/hakka-core/src/model/types.ts` and the `fixtures/storage/` fixtures exactly:
 * `store`, `timestamp` (epoch millis), `entries`. Snapshot-replace semantics — see
 * [BridgeSink.sendStorage].
 */
class StorageSnapshotTest {
    @Test
    fun `serialises store, timestamp, and entries`() {
        val json = StorageSnapshot(
            store = "sharedPreferences:prefs",
            timestampMs = 1_732_000_000_000L,
            entries = mapOf("onboardingComplete" to "true", "selectedTheme" to "dark"),
        ).toJson()

        assertEquals("sharedPreferences:prefs", json.getString("store"))
        assertEquals(1_732_000_000_000L, json.getLong("timestamp"))
        assertEquals("true", json.getJSONObject("entries").getString("onboardingComplete"))
        assertEquals("dark", json.getJSONObject("entries").getString("selectedTheme"))
    }

    @Test
    fun `an empty store is 0 entries, not a malformed snapshot`() {
        val json = StorageSnapshot(store = "cookies", entries = emptyMap()).toJson()

        assertEquals(0, json.getJSONObject("entries").length())
    }

    @Test
    fun `timestampMs defaults to now when not supplied`() {
        val before = System.currentTimeMillis()
        val json = StorageSnapshot(store = "test", entries = emptyMap()).toJson()
        val after = System.currentTimeMillis()

        val timestamp = json.getLong("timestamp")
        assert(timestamp in before..after) { "expected $timestamp to fall within [$before, $after]" }
    }
}
