package com.noodleapps.hakka.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * [SharedPreferencesSnapshotter.buildSnapshots] — the pure grouping/redaction step behind
 * [HakkaUI.captureStorageSnapshots] (hakka-react-native's on-demand `publishStorageSnapshots()`
 * relay) and the Compose Storage page. Wire shape (`store`/`timestamp`/
 * `entries`) is [StorageSnapshot.toJson]'s job and is covered by `StorageSnapshotTest` in
 * hakka-common; this file only exercises the redaction/grouping/empty-file-skipping behavior
 * that is specific to this scanner.
 */
class SharedPreferencesSnapshotterTest {
    @Test
    fun `redacts only sensitive fields, case-insensitively`() {
        val snapshots = SharedPreferencesSnapshotter.buildSnapshots(
            entriesByFile = mapOf(
                "auth_prefs" to mapOf(
                    "authToken" to "secret-abc",
                    "userId" to "user_42",
                ),
            ),
            sensitiveFields = setOf("AUTHTOKEN"),
        )

        assertEquals(1, snapshots.size)
        val snapshot = snapshots.single()
        assertEquals("sharedPreferences:auth_prefs", snapshot.store)
        assertEquals("██", snapshot.entries["authToken"])
        assertEquals("user_42", snapshot.entries["userId"])
    }

    @Test
    fun `no sensitive fields configured leaves entries untouched`() {
        val snapshots = SharedPreferencesSnapshotter.buildSnapshots(
            entriesByFile = mapOf("prefs" to mapOf("theme" to "dark")),
            sensitiveFields = emptySet(),
        )

        assertEquals("dark", snapshots.single().entries["theme"])
    }

    @Test
    fun `one snapshot per file, each prefixed sharedPreferences`() {
        val snapshots = SharedPreferencesSnapshotter.buildSnapshots(
            entriesByFile = mapOf(
                "prefs_a" to mapOf("k1" to "v1"),
                "prefs_b" to mapOf("k2" to "v2"),
            ),
            sensitiveFields = emptySet(),
        )

        val stores = snapshots.map { it.store }.toSet()
        assertEquals(setOf("sharedPreferences:prefs_a", "sharedPreferences:prefs_b"), stores)
    }

    @Test
    fun `empty files are skipped rather than producing an empty snapshot`() {
        val snapshots = SharedPreferencesSnapshotter.buildSnapshots(
            entriesByFile = mapOf(
                "empty_prefs" to emptyMap(),
                "real_prefs" to mapOf("k" to "v"),
            ),
            sensitiveFields = emptySet(),
        )

        assertEquals(1, snapshots.size)
        assertEquals("sharedPreferences:real_prefs", snapshots.single().store)
    }

    @Test
    fun `no files at all yields no snapshots`() {
        val snapshots = SharedPreferencesSnapshotter.buildSnapshots(emptyMap(), emptySet())
        assertTrue(snapshots.isEmpty())
    }
}
