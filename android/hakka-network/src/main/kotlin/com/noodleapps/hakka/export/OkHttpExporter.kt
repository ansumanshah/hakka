package com.noodleapps.hakka.export

import com.noodleapps.hakka.HttpMethod
import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.firstValue

/**
 * Generates paste-runnable Kotlin OkHttp request code from [NetworkRequest] objects.
 *
 * OkHttp is `compileOnly` in this module (the AAR itself never links it) — this exporter
 * only emits *text* and never imports or references an OkHttp type, so it adds no
 * runtime dependency of its own.
 */
object OkHttpExporter {

    /** Generates idiomatic Kotlin OkHttp code that reproduces the given request. */
    fun export(request: NetworkRequest): String = buildString {
        val bodyVar = request.requestBody?.let { body ->
            val contentType = request.requestHeaders.firstValue("Content-Type")
            appendLine("val body = ${bodyExpr(body, contentType)}")
            appendLine()
            "body"
        }

        appendLine("val client = OkHttpClient()")
        appendLine()
        appendLine("val request = Request.Builder()")
        appendLine("    .url(${kString(request.url)})")
        for ((name, values) in request.requestHeaders) {
            for (value in values) {
                appendLine("    .addHeader(${kString(name)}, ${kString(value)})")
            }
        }
        methodCall(request.method, bodyVar)?.let { appendLine("    $it") }
        appendLine("    .build()")
        appendLine()
        appendLine("client.newCall(request).execute().use { response ->")
        appendLine("    println(response.body?.string())")
        append("}")
    }

    /** The `.get()`/`.post(body)`/… builder call for [method], or null when the default (GET) applies. */
    private fun methodCall(method: HttpMethod, bodyVar: String?): String? = when (method) {
        HttpMethod.GET -> null
        HttpMethod.POST -> ".post(${bodyVar ?: emptyBodyExpr()})"
        HttpMethod.PUT -> ".put(${bodyVar ?: emptyBodyExpr()})"
        HttpMethod.PATCH -> ".patch(${bodyVar ?: emptyBodyExpr()})"
        HttpMethod.DELETE -> if (bodyVar != null) ".delete($bodyVar)" else ".delete()"
        HttpMethod.HEAD -> ".head()"
        HttpMethod.OPTIONS -> ".method(\"OPTIONS\", ${bodyVar ?: "null"})"
    }

    /** `"<body>".toRequestBody(...)` — modern OkHttp 4/5 Kotlin extension idiom, not `RequestBody.create`. */
    private fun bodyExpr(body: String, contentType: String?): String {
        val literal = kString(body)
        return if (contentType != null) {
            "$literal.toRequestBody(${kString(contentType)}.toMediaType())"
        } else {
            "$literal.toRequestBody()"
        }
    }

    /** Empty-string request body — POST/PUT/PATCH require a non-null RequestBody even when no body was captured. */
    private fun emptyBodyExpr(): String = "\"\".toRequestBody()"

    /** Wraps [value] as a Kotlin double-quoted string literal, fully escaped. */
    private fun kString(value: String): String = "\"${escapeKotlinString(value)}\""

    /**
     * Escapes a string for safe inclusion inside a Kotlin double-quoted string literal:
     * backslashes, quotes, control characters, and the dollar sign — which would otherwise
     * trigger template interpolation, so a captured body containing a template-like sequence
     * must not silently break the generated code. A plain escaped literal (rather than a
     * triple-quoted raw string) sidesteps every raw-string edge case too — an embedded run of
     * three quote characters, or a body ending in a quote right before the closing delimiter —
     * since every character is escaped individually and unconditionally.
     */
    private fun escapeKotlinString(value: String): String = buildString {
        for (ch in value) {
            when (ch) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '$' -> append("\\$")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> append(ch)
            }
        }
    }
}
