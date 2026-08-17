package com.noodleapps.hakka.export

import com.noodleapps.hakka.NetworkRequest

/**
 * Exports [NetworkRequest] objects as human-readable plain text.
 */
object TextExporter {

    /** Exports a single request as human-readable text. */
    fun export(request: NetworkRequest): String = buildString {
        // Summary line: METHOD /path  STATUS  DURATION
        val path = extractPath(request.url)
        append(request.method.name).append("  ").append(path)
        request.status?.let { append("  ").append(it) }
        request.durationMs?.let { append("  ").append(formatDuration(it)) }
        if (request.error != null) append("  ERROR: ").append(request.error)
        appendLine()

        appendLine("URL: ${request.url}")

        if (request.requestHeaders.isNotEmpty()) {
            appendLine("Request Headers:")
            for ((name, values) in request.requestHeaders) {
                for (value in values) {
                    appendLine("  $name: $value")
                }
            }
        }

        if (request.responseHeaders.isNotEmpty()) {
            appendLine("Response Headers:")
            for ((name, values) in request.responseHeaders) {
                for (value in values) {
                    appendLine("  $name: $value")
                }
            }
        }

        if (request.requestBody != null) {
            appendLine("Request Body:")
            appendLine("  ${request.requestBody}")
        }

        if (request.responseBody != null) {
            appendLine("Response Body:")
            appendLine("  ${request.responseBody}")
        }
    }

    /** Exports multiple requests as human-readable text, separated by `---`. */
    fun export(requests: List<NetworkRequest>): String =
        requests.joinToString("---\n") { export(it) }

    private fun extractPath(url: String): String = try {
        val idx = url.indexOf("://")
        if (idx < 0) url
        else {
            val afterScheme = url.substring(idx + 3)
            val pathStart = afterScheme.indexOf('/')
            if (pathStart < 0) "/" else afterScheme.substring(pathStart)
        }
    } catch (_: Exception) {
        url
    }

    private fun formatDuration(ms: Long): String = when {
        ms < 1_000 -> "${ms}ms"
        else -> String.format("%.1fs", ms / 1_000.0)
    }
}
