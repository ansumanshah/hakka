package com.noodleapps.hakka.ui

/**
 * A snapshot of the inspector's filter/sort/group state.
 * Mirrors `SavedFilter` from packages/hakka-browser/src/ui/persist.ts.
 */
internal data class FilterPreset(
    val searchQuery: String,
    val methodFilters: Set<String>,
    val statusGroup: String?,   // null = "all"
    val domain: String?,        // null = "all"
    val sortField: SortField,
    val sortAscending: Boolean,
    val groupBy: GroupBy,
) {
    /** Considered "empty" when all fields are at their default -- skip adding to Recent. */
    fun isEmpty(): Boolean =
        searchQuery.isEmpty() &&
            methodFilters.isEmpty() &&
            statusGroup == null &&
            domain == null &&
            sortField == SortField.TIME &&
            !sortAscending &&
            groupBy == GroupBy.NONE

    // -- Serialisation (hand-rolled to avoid Gson/Moshi dep) --
    // Fields joined with ASCII Unit Separator (); commas separate the method list.
    //  never appears in URLs / method names / enum names -- no escaping needed.

    fun serialise(): String = listOf(
        "v1",
        searchQuery,
        methodFilters.joinToString(","),
        statusGroup ?: "",
        domain ?: "",
        sortField.name,
        sortAscending.toString(),
        groupBy.name,
    ).joinToString(DELIM)

    companion object {
        // ASCII Unit Separator -- safe delimiter that never appears in filter field values.
        private const val DELIM = ""

        val DEFAULT = FilterPreset(
            searchQuery = "",
            methodFilters = emptySet(),
            statusGroup = null,
            domain = null,
            sortField = SortField.TIME,
            sortAscending = false,
            groupBy = GroupBy.NONE,
        )

        fun deserialise(s: String): FilterPreset? {
            return try {
                val parts = s.split(DELIM)
                if (parts.size < 8 || parts[0] != "v1") return null
                val search = parts[1]
                val methods = parts[2].split(",").filter { it.isNotEmpty() }.toSet()
                val sg = parts[3].ifEmpty { null }
                val dom = parts[4].ifEmpty { null }
                val sf = SortField.entries.firstOrNull { it.name == parts[5] } ?: SortField.TIME
                val asc = parts[6].toBooleanStrictOrNull() ?: false
                val gb = GroupBy.entries.firstOrNull { it.name == parts[7] } ?: GroupBy.NONE
                FilterPreset(search, methods, sg, dom, sf, asc, gb)
            } catch (_: Exception) { null }
        }
    }
}
