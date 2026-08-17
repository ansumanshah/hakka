package com.noodleapps.hakka

/**
 * Configuration for Hakka network interception.
 * No-op implementation: values are ignored.
 */
data class HakkaConfig(
    val maxRequests: Int = 500,
    val maxBodySize: Long = 262_144L,
    val redactHeaders: Set<String> = DEFAULT_REDACTED_HEADERS,
    /** URL query parameter names to redact (case-insensitive). Ignored in noop. */
    val sensitiveQueryItems: Set<String> = emptySet(),
    /** JSON body field names to redact recursively (case-insensitive). Ignored in noop. */
    val sensitiveBodyFields: Set<String> = emptySet(),
    val ignoreHosts: Set<String> = emptySet(),
    /** URL regex patterns to ignore. Ignored in noop. */
    val ignorePatterns: List<String> = emptyList(),
    val maxAgeMs: Long? = null,
    /**
     * WebSocket URL of the Hakka desktop bridge hub (e.g. `ws://localhost:8989`).
     * When non-null, captured records are streamed to the bridge so they become
     * visible in hakka mcp and the desktop app. Opt-in — null (default) disables
     * the bridge sink entirely. Ignored in noop.
     */
    val bridgeUrl: String? = null,
    /**
     * When true, HakkaInterceptor injects an `x-hakka-trace` UUID on each outgoing
     * request whose host matches the app's own origin or an allowlisted entry in
     * [tracePropagateOrigins]. The same UUID is stamped as [NetworkRequest.correlationId]
     * so the captured record can be correlated with server-side traces.
     * Off by default — the header is never sent without explicit opt-in.
     * Mirrors `TraceConfig.enabled` on the web/JS side.
     */
    val traceEnabled: Boolean = false,
    /**
     * Additional hosts (exact match, case-insensitive) that may receive the
     * `x-hakka-trace` header when [traceEnabled] is true. Same-host requests are
     * always eligible; cross-origin hosts must be listed here.
     * Mirrors `TraceConfig.propagateOrigins` on the web/JS side.
     */
    val tracePropagateOrigins: List<String> = emptyList(),
) {
    companion object {
        val DEFAULT_REDACTED_HEADERS = setOf("authorization", "proxy-authorization", "cookie", "set-cookie")
        private const val REDACTED = "\u2588\u2588"
    }

    /** Returns redacted value if the header name is in [redactHeaders]. */
    fun redact(headerName: String, headerValue: String): String =
        if (shouldRedactHeader(headerName)) REDACTED else headerValue

    /** Redacts all values for a multi-value header if the name is in [redactHeaders]. */
    fun redact(headerName: String, values: List<String>): List<String> =
        if (shouldRedactHeader(headerName)) values.map { REDACTED } else values

    fun shouldRedactHeader(headerName: String): Boolean {
        val normalized = headerName.lowercase()
        return redactHeaders.any { matchesPattern(normalized, it.lowercase(), exactPlain = true) }
    }

    fun shouldIgnoreHost(host: String): Boolean {
        val normalized = host.lowercase()
        return ignoreHosts.any { rawPattern ->
            val pattern = rawPattern.lowercase()
            when {
                pattern.startsWith(".") -> normalized == pattern.drop(1) || normalized.endsWith(pattern)
                pattern.startsWith("*.") -> normalized == pattern.drop(2) || normalized.endsWith(pattern.drop(1))
                normalized.endsWith(".$pattern") -> true
                else -> matchesPattern(normalized, pattern, exactPlain = true)
            }
        }
    }

    fun shouldIgnoreUrl(url: String): Boolean =
        ignorePatterns.any { matchesPattern(url, it, exactPlain = false) }

    /**
     * Returns true when the `x-hakka-trace` header should be injected on a request
     * to [host]. Always false when [traceEnabled] is false.
     *
     * Android has no concept of "own origin" so the rule is:
     * - If [tracePropagateOrigins] is empty, all captured hosts are eligible
     *   (all traffic is considered "same-application").
     * - If [tracePropagateOrigins] is non-empty, only the listed hosts receive
     *   the header (case-insensitive exact or subdomain match).
     *
     * This mirrors `shouldPropagateTrace` on the web/JS side where same-origin is
     * always allowed and extra origins must be explicitly listed.
     */
    fun shouldPropagateTrace(host: String): Boolean {
        if (!traceEnabled) return false
        if (tracePropagateOrigins.isEmpty()) return true
        val normalized = host.lowercase()
        return tracePropagateOrigins.any { it.lowercase() == normalized }
    }

    private fun matchesPattern(value: String, pattern: String, exactPlain: Boolean): Boolean {
        if (pattern.isEmpty()) return false
        if (pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/")) {
            return runCatching {
                Regex(pattern.drop(1).dropLast(1), RegexOption.IGNORE_CASE).containsMatchIn(value)
            }.getOrDefault(false)
        }
        if (!exactPlain) {
            val legacyRegexMatched = runCatching {
                Regex(pattern, RegexOption.IGNORE_CASE).containsMatchIn(value)
            }.getOrDefault(false)
            if (legacyRegexMatched) return true
        }
        if ('*' in pattern) {
            val regex = pattern
                .split("*")
                .joinToString(".*") { Regex.escape(it) }
            return Regex("^$regex$", RegexOption.IGNORE_CASE).matches(value)
        }
        return if (exactPlain) {
            value.equals(pattern, ignoreCase = true)
        } else {
            value.equals(pattern, ignoreCase = true) || value.contains(pattern, ignoreCase = true)
        }
    }
}
