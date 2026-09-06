package com.noodleapps.hakka.ui

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal data class ComposeNetworkPreset(
    val query: String = "",
    val methods: List<String> = emptyList(),
    val status: String? = null,
    val protocol: String? = null,
    val host: String? = null,
    val outcome: String? = null,
    val sortField: SortField = SortField.TIME,
    val sortAscending: Boolean = false,
    val groupBy: GroupBy = GroupBy.NONE,
) {
    fun isEmpty() = query.isEmpty() && methods.isEmpty() && status == null && protocol == null &&
        host == null && outcome == null && sortField == SortField.TIME && !sortAscending && groupBy == GroupBy.NONE

    fun toLegacy() = FilterPreset(query, methods.toSet(), status, host, sortField, sortAscending, groupBy)

    fun encode(): String = JSONObject()
        .put("query", query).put("methods", JSONArray(methods)).put("status", status)
        .put("protocol", protocol).put("host", host).put("outcome", outcome)
        .put("sort", sortField.name).put("ascending", sortAscending).put("group", groupBy.name).toString()

    companion object {
        fun fromLegacy(value: FilterPreset) = ComposeNetworkPreset(
            value.searchQuery, value.methodFilters.toList(), value.statusGroup, host = value.domain,
            sortField = value.sortField, sortAscending = value.sortAscending, groupBy = value.groupBy,
        )

        fun decode(value: String): ComposeNetworkPreset? = runCatching {
            val json = JSONObject(value)
            val methods = json.optJSONArray("methods") ?: JSONArray()
            ComposeNetworkPreset(
                query = json.optString("query"),
                methods = (0 until methods.length()).map { methods.getString(it) },
                status = json.optString("status").ifEmpty { null },
                protocol = json.optString("protocol").ifEmpty { null },
                host = json.optString("host").ifEmpty { null },
                outcome = json.optString("outcome").ifEmpty { null },
                sortField = SortField.entries.firstOrNull { it.name == json.optString("sort") } ?: SortField.TIME,
                sortAscending = json.optBoolean("ascending"),
                groupBy = GroupBy.entries.firstOrNull { it.name == json.optString("group") } ?: GroupBy.NONE,
            )
        }.getOrNull()
    }
}

internal data class NamedComposeNetworkPreset(val name: String, val preset: ComposeNetworkPreset)

internal class ComposeNetworkPresetStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("hakka_compose_network_presets", Context.MODE_PRIVATE)
    private val legacy = FilterPresetStore(context)

    fun loadSaved(): List<NamedComposeNetworkPreset> {
        val compose = loadNamed("saved")
        val composeNames = compose.mapTo(mutableSetOf()) { it.name }
        return compose + legacy.loadSaved().filter { it.name !in composeNames }.map { NamedComposeNetworkPreset(it.name, ComposeNetworkPreset.fromLegacy(it.preset)) }
    }

    fun loadRecent(): List<ComposeNetworkPreset> {
        val encoded = preferences.getStringSet("recent", emptySet()).orEmpty().toList()
            .sortedBy { it.substringBefore(':').toLongOrNull() ?: 0L }.reversed()
            .mapNotNull { ComposeNetworkPreset.decode(it.substringAfter(':')) }
        return if (encoded.isNotEmpty()) encoded else legacy.loadRecent().map(ComposeNetworkPreset::fromLegacy)
    }

    fun save(name: String, preset: ComposeNetworkPreset) {
        val next = loadNamed("saved").filter { it.name != name } + NamedComposeNetworkPreset(name, preset)
        saveNamed("saved", next)
        legacy.save(name, preset.toLegacy())
    }

    fun remove(name: String) {
        saveNamed("saved", loadNamed("saved").filter { it.name != name })
        legacy.remove(name)
    }

    fun pushRecent(preset: ComposeNetworkPreset) {
        if (preset.isEmpty()) return
        val current = loadRecent().filter { it != preset }
        val next = (listOf(preset) + current).take(8)
        preferences.edit().putStringSet("recent", next.mapIndexed { index, item ->
            "${System.currentTimeMillis() - index}:${item.encode()}"
        }.toSet()).apply()
        legacy.pushRecent(preset.toLegacy())
    }

    private fun loadNamed(key: String): List<NamedComposeNetworkPreset> =
        preferences.getStringSet(key, emptySet()).orEmpty().mapNotNull { encoded ->
            val separator = encoded.indexOf('\u001f')
            if (separator < 0) null else ComposeNetworkPreset.decode(encoded.substring(separator + 1))?.let {
                NamedComposeNetworkPreset(encoded.substring(0, separator), it)
            }
        }.sortedBy { it.name.lowercase() }

    private fun saveNamed(key: String, values: List<NamedComposeNetworkPreset>) {
        preferences.edit().putStringSet(key, values.map { "${it.name}\u001f${it.preset.encode()}" }.toSet()).apply()
    }
}
