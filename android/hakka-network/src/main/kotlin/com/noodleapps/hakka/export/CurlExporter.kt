package com.noodleapps.hakka.export

import com.noodleapps.hakka.NetworkRequest

/**
 * Generates cURL command strings from [NetworkRequest] objects.
 */
object CurlExporter {

    /** Generates a single-line cURL command for the given request. */
    fun export(request: NetworkRequest): String = buildString {
        append("curl")
        if (request.method.name != "GET") {
            append(" -X ").append(request.method.name)
        }
        for ((name, values) in request.requestHeaders) {
            for (value in values) {
                append(" -H '").append(escapeShell(name)).append(": ").append(escapeShell(value)).append("'")
            }
        }
        request.requestBody?.let { body ->
            append(" -d '").append(escapeShell(body)).append("'")
        }
        append(" '").append(escapeShell(request.url)).append("'")
    }

    /** Escapes a string for safe inclusion inside single-quoted shell arguments. */
    private fun escapeShell(value: String): String = value.replace("'", "'\"'\"'")
}
