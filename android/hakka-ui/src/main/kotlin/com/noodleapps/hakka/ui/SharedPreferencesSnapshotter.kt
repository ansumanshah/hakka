package com.noodleapps.hakka.ui

import android.content.Context
import com.noodleapps.hakka.StorageSnapshot
import com.noodleapps.hakka.redactLogMetadata

/**
 * Scans the app's `shared_prefs` directory and builds one [StorageSnapshot] per file, with
 * values redacted via [redactLogMetadata] — the same field-name matching
 * [com.noodleapps.hakka.HakkaConfig.sensitiveBodyFields] uses everywhere else.
 *
 * Split into a thin Android-scanning layer ([capture]) and a pure grouping/redaction layer
 * ([buildSnapshots]) so the interesting logic (which fields get redacted, how files are
 * grouped, empty files being skipped) is unit-testable without a `Context`/`SharedPreferences`.
 *
 * Shared between [HakkaUI.captureStorageSnapshots] (used by hakka-react-native's on-demand
 * `publishStorageSnapshots()` native module method) and, in future, [StorageTabController]'s
 * own bridge relay — both should see identical output for the same on-disk state.
 */
internal object SharedPreferencesSnapshotter {
    /** Reads every SharedPreferences file for [context] and builds redacted snapshots. */
    fun capture(context: Context, sensitiveFields: Set<String>): List<StorageSnapshot> =
        buildSnapshots(readAllPrefs(context), sensitiveFields)

    /**
     * Pure grouping/redaction step: turns raw `file -> (key -> value)` maps into
     * [StorageSnapshot]s, applying [redactLogMetadata] per file and skipping files with no
     * entries (an empty snapshot carries no information worth a bridge frame).
     */
    fun buildSnapshots(entriesByFile: Map<String, Map<String, String>>, sensitiveFields: Set<String>): List<StorageSnapshot> {
        val snapshots = mutableListOf<StorageSnapshot>()
        for ((file, raw) in entriesByFile) {
            if (raw.isEmpty()) continue
            val redacted = redactLogMetadata(raw, sensitiveFields) ?: raw
            snapshots.add(StorageSnapshot(store = "sharedPreferences:$file", entries = redacted))
        }
        return snapshots
    }

    internal fun readAllPrefs(context: Context): Map<String, Map<String, String>> {
        val prefsDir = java.io.File(context.filesDir.parent, "shared_prefs")
        val prefNames: List<String> = if (prefsDir.exists() && prefsDir.isDirectory) {
            prefsDir.listFiles()
                ?.filter { it.name.endsWith(".xml") }
                ?.map { it.name.removeSuffix(".xml") }
                ?: emptyList()
        } else {
            listOf("${context.packageName}_preferences")
        }

        val result = linkedMapOf<String, Map<String, String>>()
        for (name in prefNames) {
            try {
                val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)
                result[name] = prefs.all.mapValues { (_, value) -> valueToString(value) }
            } catch (_: Exception) {
                // skip unreadable files
            }
        }
        return result
    }

    private fun valueToString(value: Any?): String = when (value) {
        null -> "null"
        is Set<*> -> value.joinToString(", ", prefix = "{", postfix = "}")
        else -> value.toString()
    }
}
