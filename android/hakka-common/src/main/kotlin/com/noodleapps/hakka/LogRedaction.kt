package com.noodleapps.hakka

/**
 * Redacts structured-log metadata using the same field-name matching as body
 * redaction (`HakkaConfig.sensitiveBodyFields` / `HakkaInterceptor.redactBodyFields`
 * in hakka-network) — reused here rather than reimplemented, since log metadata
 * is a flat string map and doesn't need the JSON-tree walk that body redaction
 * does. Matches [HakkaConfig.shouldRedactHeader]'s case-insensitive semantics.
 *
 * Returns [metadata] unchanged when [sensitiveFields] is empty or [metadata] is
 * null. Never throws.
 */
fun redactLogMetadata(metadata: Map<String, String>?, sensitiveFields: Set<String>): Map<String, String>? {
    if (metadata == null || sensitiveFields.isEmpty()) return metadata
    return try {
        val sensitive = sensitiveFields.map { it.lowercase() }.toSet()
        metadata.mapValues { (key, value) ->
            if (key.lowercase() in sensitive) "██" else value
        }
    } catch (_: Exception) {
        metadata
    }
}
