package com.noodleapps.hakka

/**
 * Server-Sent Events (`text/event-stream`) decoder. Mirrors the SSE section of
 * `packages/hakka-core/src/engine/decoders.ts`.
 */

/** A single parsed Server-Sent Event record. */
data class SseEvent(
    /** The `data:` field value(s), joined with '\n' per the EventSource spec. */
    val data: String,
    /** The `event:` field value, if present. */
    val event: String? = null,
    /** The `id:` field value, if present. */
    val id: String? = null,
    /** The `retry:` field value (reconnection time in ms), if present and numeric. */
    val retry: Long? = null,
)

/**
 * Parse a raw text/event-stream body into a list of SSE events.
 *
 * Follows the WHATWG EventSource framing:
 *  - Stream is split into records separated by a blank line (a dispatch boundary).
 *  - Each record is a set of `field: value` lines: `event`, `data`, `id`, `retry`.
 *  - Multiple `data:` lines in the same record are joined with '\n'.
 *  - Lines starting with ':' are comments and are ignored.
 *  - A record with no recognized field produces no event; a record with at least one
 *    recognized field is always emitted, using `data: ""` if no `data:` line was present.
 *  - CRLF, LF, and CR line endings are all accepted.
 *
 * Never throws — malformed input degrades to best-effort parsing.
 */
fun decodeSse(body: String): List<SseEvent> {
    val events = mutableListOf<SseEvent>()
    if (body.isEmpty()) return events

    // Normalize line endings, then split into records on blank-line boundaries.
    val normalized = body.replace("\r\n", "\n").replace("\r", "\n")
    val lines = normalized.split("\n")

    var curEvent: String? = null
    val curData = mutableListOf<String>()
    var curId: String? = null
    var curRetry: Long? = null
    var sawAnyField = false

    fun flush() {
        if (sawAnyField) {
            events.add(SseEvent(data = curData.joinToString("\n"), event = curEvent, id = curId, retry = curRetry))
        }
        curEvent = null
        curData.clear()
        curId = null
        curRetry = null
        sawAnyField = false
    }

    for (rawLine in lines) {
        if (rawLine.isEmpty()) {
            // Blank line = dispatch boundary
            flush()
            continue
        }
        if (rawLine.startsWith(":")) {
            // Comment line — ignored
            continue
        }

        val colonIdx = rawLine.indexOf(':')
        val field: String
        var value: String
        if (colonIdx == -1) {
            // Line with no colon: the whole line is the field name, value is ""
            field = rawLine
            value = ""
        } else {
            field = rawLine.substring(0, colonIdx)
            value = rawLine.substring(colonIdx + 1)
            // A single leading space in the value is stripped per spec
            if (value.startsWith(" ")) value = value.substring(1)
        }

        when (field) {
            "event" -> {
                curEvent = value
                sawAnyField = true
            }
            "data" -> {
                curData.add(value)
                sawAnyField = true
            }
            "id" -> {
                // Per spec, an id containing a NUL character should be ignored; skipped here
                // since bodies are Kotlin strings without embedded NULs in practice.
                curId = value
                sawAnyField = true
            }
            "retry" -> {
                if (value.isNotEmpty() && value.all { it in '0'..'9' }) {
                    curRetry = value.toLongOrNull()
                    if (curRetry != null) sawAnyField = true
                }
            }
            else -> {
                // Unknown field — ignored per spec
            }
        }
    }

    // Flush any trailing record that wasn't terminated by a final blank line
    flush()

    return events
}

/** Serializes [events] to match JS `JSON.stringify(events, null, 2)` field-for-field. */
private fun sseEventsToJson(events: List<SseEvent>): String {
    if (events.isEmpty()) return "[]"
    val sb = StringBuilder()
    sb.append("[\n")
    events.forEachIndexed { i, ev ->
        sb.append("  {\n")
        val fields = mutableListOf<Pair<String, String>>()
        fields.add("data" to jsonQuote(ev.data))
        ev.event?.let { fields.add("event" to jsonQuote(it)) }
        ev.id?.let { fields.add("id" to jsonQuote(it)) }
        ev.retry?.let { fields.add("retry" to it.toString()) }
        fields.forEachIndexed { j, (key, value) ->
            sb.append("    ").append(jsonQuote(key)).append(": ").append(value)
            if (j != fields.lastIndex) sb.append(",")
            sb.append("\n")
        }
        sb.append("  }")
        if (i != events.lastIndex) sb.append(",")
        sb.append("\n")
    }
    sb.append("]")
    return sb.toString()
}

private const val SSE_CONTENT_TYPE = "text/event-stream"

internal val sseDecoder = object : BodyDecoder {
    override val id = "sse"

    override fun decode(body: String, contentType: String?, contentEncoding: String?): String? {
        val ct = contentTypeWithoutParams(contentType) ?: return null
        if (ct != SSE_CONTENT_TYPE) return null

        val events = decodeSse(body)
        return sseEventsToJson(events)
    }
}
