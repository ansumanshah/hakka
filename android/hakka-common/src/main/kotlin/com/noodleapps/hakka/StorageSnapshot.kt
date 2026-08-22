package com.noodleapps.hakka

import org.json.JSONObject

/**
 * A named device-storage snapshot (e.g. `"sharedPreferences:<file>"`) streamed
 * over the bridge for the desktop app's Storage panel.
 *
 * Mirrors `StorageSnapshot` in `packages/hakka-core/src/model/types.ts` field-
 * for-field: `store` (free-form name), `timestamp` (epoch millis), `entries`
 * (already redacted upstream by the caller — nothing here needs scrubbing by
 * a receiver). **Snapshot-replace semantics**: a later frame for the same
 * `store` fully replaces this one on the receiving end, it is never a diff —
 * see [BridgeSink.sendStorage].
 */
data class StorageSnapshot(
    val store: String,
    val entries: Map<String, String>,
    val timestampMs: Long = System.currentTimeMillis(),
) {
    fun toJson(): JSONObject = JSONObject()
        .put("store", store)
        .put("timestamp", timestampMs)
        .put("entries", JSONObject().apply { entries.forEach { (k, v) -> put(k, v) } })
}
