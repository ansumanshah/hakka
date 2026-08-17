package com.noodleapps.hakka.ui

import android.content.Context
import android.content.SharedPreferences

/**
 * SharedPreferences-backed store for saved and recent filter presets.
 *
 * Keys are namespaced under the "hakka_filter_" prefix so they're unlikely
 * to collide with anything the host app stores.
 *
 * Semantics mirror packages/hakka-browser/src/ui/persist.ts:
 *  - recentFilters  — last N non-empty filter states, deduped by searchQuery, capped at [RECENT_CAP].
 *  - savedFilters   — named presets; overwrite on same name; user-deletable.
 */
internal class FilterPresetStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // ── Recent filters ──────────────────────────────────────────────────

    /** Returns the recent list, newest first. */
    fun loadRecent(): List<FilterPreset> {
        val count = prefs.getInt(KEY_RECENT_COUNT, 0)
        return (0 until count).mapNotNull { i ->
            prefs.getString("$KEY_RECENT_ITEM$i", null)?.let { FilterPreset.deserialise(it) }
        }
    }

    /**
     * Prepend [preset] to the recent list (deduped by [FilterPreset.searchQuery], capped at
     * [RECENT_CAP]). No-op when [preset] is considered empty (all defaults).
     */
    fun pushRecent(preset: FilterPreset) {
        if (preset.isEmpty()) return
        val existing = loadRecent()
        val deduped = existing.filter { it.searchQuery != preset.searchQuery }
        val next = (listOf(preset) + deduped).take(RECENT_CAP)
        saveList(KEY_RECENT_COUNT, KEY_RECENT_ITEM, next)
    }

    // ── Saved (named) filters ───────────────────────────────────────────

    data class NamedPreset(val name: String, val preset: FilterPreset)

    /** Returns saved presets, oldest-first (insertion order). */
    fun loadSaved(): List<NamedPreset> {
        val count = prefs.getInt(KEY_SAVED_COUNT, 0)
        return (0 until count).mapNotNull { i ->
            val name = prefs.getString("$KEY_SAVED_NAME$i", null) ?: return@mapNotNull null
            val data = prefs.getString("$KEY_SAVED_DATA$i", null) ?: return@mapNotNull null
            FilterPreset.deserialise(data)?.let { NamedPreset(name, it) }
        }
    }

    /**
     * Save [preset] under [name]. If a preset with the same name already exists it is
     * overwritten (mirroring the web addSavedFilter behaviour).
     */
    fun save(name: String, preset: FilterPreset) {
        val existing = loadSaved().filter { it.name != name }
        val next = existing + NamedPreset(name, preset)
        saveSavedList(next)
    }

    /** Remove the preset with [name]. No-op if not found. */
    fun remove(name: String) {
        val next = loadSaved().filter { it.name != name }
        saveSavedList(next)
    }

    // ── Private helpers ─────────────────────────────────────────────────

    private fun saveList(countKey: String, itemKeyPrefix: String, list: List<FilterPreset>) {
        prefs.edit().apply {
            // Clear any previously stored items beyond the new count
            val oldCount = prefs.getInt(countKey, 0)
            for (i in list.size until oldCount) remove("$itemKeyPrefix$i")
            putInt(countKey, list.size)
            list.forEachIndexed { i, p -> putString("$itemKeyPrefix$i", p.serialise()) }
        }.apply()
    }

    private fun saveSavedList(list: List<NamedPreset>) {
        prefs.edit().apply {
            val oldCount = prefs.getInt(KEY_SAVED_COUNT, 0)
            for (i in list.size until oldCount) {
                remove("$KEY_SAVED_NAME$i")
                remove("$KEY_SAVED_DATA$i")
            }
            putInt(KEY_SAVED_COUNT, list.size)
            list.forEachIndexed { i, np ->
                putString("$KEY_SAVED_NAME$i", np.name)
                putString("$KEY_SAVED_DATA$i", np.preset.serialise())
            }
        }.apply()
    }

    companion object {
        private const val PREFS_NAME = "hakka_filter_presets"
        private const val RECENT_CAP = 8

        private const val KEY_RECENT_COUNT = "hakka_filter_recent_count"
        private const val KEY_RECENT_ITEM  = "hakka_filter_recent_"

        private const val KEY_SAVED_COUNT  = "hakka_filter_saved_count"
        private const val KEY_SAVED_NAME   = "hakka_filter_saved_name_"
        private const val KEY_SAVED_DATA   = "hakka_filter_saved_data_"
    }
}
