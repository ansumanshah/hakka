package com.noodleapps.hakka.ui

/** Finds non-overlapping matches in original UTF-16 offsets for text layout and highlighting. */
internal fun findBodyMatchOffsets(body: String, query: String): List<Int> {
    if (query.isBlank()) return emptyList()
    val matches = mutableListOf<Int>()
    var start = 0
    while (start < body.length) {
        val next = body.indexOf(query, start, ignoreCase = true)
        if (next < 0) break
        matches += next
        start = next + query.length
    }
    return matches
}

