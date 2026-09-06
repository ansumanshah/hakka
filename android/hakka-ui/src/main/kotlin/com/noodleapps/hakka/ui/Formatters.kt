package com.noodleapps.hakka.ui

import android.content.Context
import com.noodleapps.hakka.NetworkRequest
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ── Pure formatting / classification helpers ────────────────────────
// Data → String/Int only, no View construction, so the helpers stay
// unit-testable without Robolectric.

internal val STATUS_REASONS = mapOf(
    200 to "OK", 201 to "Created", 204 to "No Content",
    301 to "Moved Permanently", 302 to "Found", 304 to "Not Modified",
    400 to "Bad Request", 401 to "Unauthorized", 403 to "Forbidden",
    404 to "Not Found", 405 to "Method Not Allowed", 408 to "Request Timeout",
    409 to "Conflict", 422 to "Unprocessable Entity", 429 to "Too Many Requests",
    500 to "Internal Server Error", 502 to "Bad Gateway",
    503 to "Service Unavailable", 504 to "Gateway Timeout",
)

internal fun fmtDuration(ms: Long): String =
    if (ms >= 1000) "%.1fs".format(ms / 1000.0) else "${ms}ms"

internal fun fmtSize(bytes: Long): String = when {
    bytes <= 0 -> ""; bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "%.1f KB".format(bytes / 1024.0)
    else -> "%.1f MB".format(bytes / (1024.0 * 1024.0))
}

internal fun fmtStatus(code: Int): String =
    STATUS_REASONS[code]?.let { "$code $it" } ?: "$code"

internal fun methodColor(method: String): Int = when (method) {
    "GET" -> Theme.methodGet
    "POST" -> Theme.methodPost
    "PUT" -> Theme.methodPut
    "PATCH" -> Theme.methodPatch
    "DELETE" -> Theme.methodDelete
    else -> Theme.methodOther
}

internal fun barColor(code: Int?): Int = when {
    code == null -> Theme.pending
    code in 200..299 -> Theme.success
    code in 300..399 -> Theme.warning
    code >= 400 -> Theme.error
    else -> Theme.pending
}

internal fun statusTextColor(code: Int?, hasError: Boolean = false): Int = when {
    hasError -> Theme.error
    code == null -> Theme.pending
    else -> barColor(code)
}

/** Duration color: >3s red, >1s amber, else default. */
internal fun durationColor(ctx: Context, ms: Long?): Int = when {
    ms == null -> Theme.textSecondary(ctx)
    ms > 3000 -> Theme.error
    ms > 1000 -> Theme.warning
    else -> Theme.textSecondary(ctx)
}

internal fun pathText(r: NetworkRequest): String {
    val path = try { URL(r.url).path } catch (_: Exception) { r.url }
    return r.graphqlOperationName?.let { "$path  ▸ $it" } ?: path
}

internal fun hostOf(url: String): String = try { URL(url).host } catch (_: Exception) { "" }

internal fun fmtDurationOrPending(ms: Long?): String = when {
    ms == null -> "···"; ms >= 1000 -> "%.1fs".format(ms / 1000.0)
    else -> "${ms}ms"
}

/** Status text only, no size suffix — used where size renders in its own stacked column. */
internal fun fmtStatusOnly(r: NetworkRequest): String = when {
    r.status != null -> fmtStatus(r.status!!)
    r.error != null -> "error"
    else -> "pending"
}

/** Thread-safe time formatter using ThreadLocal. */
private val threadLocalTimeFormat = object : ThreadLocal<SimpleDateFormat>() {
    override fun initialValue(): SimpleDateFormat =
        SimpleDateFormat("HH:mm:ss", Locale.US)
}

internal fun fmtTime(epochMs: Long): String =
    threadLocalTimeFormat.get()!!.format(Date(epochMs))

/** Estimate header size in bytes (key: value\r\n). */
internal fun estimateHeaderSize(headers: Map<String, List<String>>): Long {
    var size = 0L
    for ((key, values) in headers) {
        for (value in values) {
            size += key.length + value.length + 4 // "key: value\r\n"
        }
    }
    return size
}
