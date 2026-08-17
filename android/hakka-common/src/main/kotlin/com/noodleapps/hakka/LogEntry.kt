package com.noodleapps.hakka

/**
 * Structured application log level. Mirrors `LogLevel` from
 * `packages/hakka-core/src/log/types.ts` — same four values, same names.
 */
enum class LogLevel { DEBUG, INFO, WARN, ERROR }

/**
 * A single structured log entry captured by [HakkaLogStore].
 *
 * Mirrors `LogEntry` from `packages/hakka-core/src/log/types.ts` field-for-field:
 * `id` (string), `timestamp` (epoch millis), `level`, `message`, optional
 * `category` (subsystem tag, e.g. "auth", "payments"), and optional
 * `metadata` (structured fields, redaction-aware).
 *
 * This is a distinct record type from [NetworkRequest] — [HakkaLogStore] never
 * holds [NetworkRequest]s, and the network-capture [LogStore] never holds
 * [LogEntry]s. Keeping the two ring buffers separate avoids overloading either
 * one with an unrelated record shape.
 */
data class LogEntry(
    val id: String,
    val timestamp: Long,
    val level: LogLevel,
    val message: String,
    val category: String? = null,
    val metadata: Map<String, String>? = null,
)
