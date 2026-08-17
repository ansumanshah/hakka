package com.noodleapps.hakka.export

import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.firstValue
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/**
 * Exports captured requests as a Postman Collection v2.1 JSON file.
 *
 * Ported from packages/hakka-core/src/model/postman.ts — produces an import-ready
 * `.postman_collection.json` that opens directly in Postman / Insomnia / Hoppscotch.
 *
 * Schema: https://schema.getpostman.com/json/collection/v2.1.0/collection.json
 */
object PostmanExporter {

    private const val SCHEMA =
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"

    /**
     * Exports [requests] as a Postman Collection v2.1 JSON string.
     *
     * @param requests the captured requests to include.
     * @param name collection name shown in Postman — defaults to "Hakka Export".
     */
    fun export(requests: List<NetworkRequest>, name: String = "Hakka Export"): String {
        val items = JSONArray()
        for (req in requests) {
            items.put(buildItem(req))
        }
        val info = JSONObject()
            .put("name", name)
            .put("schema", SCHEMA)
        val collection = JSONObject()
            .put("info", info)
            .put("item", items)
        return collection.toString(2)
    }

    private fun buildItem(req: NetworkRequest): JSONObject {
        val method = req.method.name
        val urlStr = req.url
        val headers = buildHeadersArray(req.requestHeaders)
        val requestObj = JSONObject()
            .put("method", method)
            .put("header", headers)
            .put("url", buildUrlObject(urlStr))
        val body = req.requestBody
        if (body != null && body.isNotEmpty()) {
            val mimeType = req.requestHeaders.firstValue("content-type") ?: ""
            requestObj.put("body", buildBody(body, mimeType))
        }
        return JSONObject()
            .put("name", itemName(method, urlStr))
            .put("request", requestObj)
            .put("response", JSONArray())
    }

    /** Item name: "GET /path" — mirrors the TS implementation. */
    private fun itemName(method: String, url: String): String {
        val path = try { URI(url).path.ifEmpty { "/" } } catch (_: Exception) { url }
        return "$method $path"
    }

    /**
     * Builds a structured Postman URL object with decomposed host, path, and query.
     * Falls back to a plain string when parsing fails.
     */
    private fun buildUrlObject(url: String): JSONObject {
        return try {
            val uri = URI(url)
            val hostParts = (uri.host ?: "").split(".")
            val pathParts = uri.path.split("/").filter { it.isNotEmpty() }
            val queryParams = parseQuery(uri.query)
            JSONObject()
                .put("raw", url)
                .put("protocol", uri.scheme ?: "https")
                .put("host", JSONArray(hostParts))
                .put("path", JSONArray(pathParts))
                .apply { if (queryParams.length() > 0) put("query", queryParams) }
        } catch (_: Exception) {
            JSONObject().put("raw", url)
        }
    }

    private fun parseQuery(query: String?): JSONArray {
        val arr = JSONArray()
        if (query.isNullOrEmpty()) return arr
        for (pair in query.split("&")) {
            val idx = pair.indexOf('=')
            if (idx < 0) {
                arr.put(JSONObject().put("key", pair).put("value", ""))
            } else {
                arr.put(
                    JSONObject()
                        .put("key", pair.substring(0, idx))
                        .put("value", pair.substring(idx + 1)),
                )
            }
        }
        return arr
    }

    private fun buildHeadersArray(headers: Map<String, List<String>>): JSONArray {
        val arr = JSONArray()
        for ((name, values) in headers) {
            // Skip pseudo-headers and host (Postman manages these)
            if (name.startsWith(":") || name.equals("host", ignoreCase = true)) continue
            for (value in values) {
                arr.put(JSONObject().put("key", name).put("value", value))
            }
        }
        return arr
    }

    private fun buildBody(rawBody: String, mimeType: String): JSONObject {
        // Use "raw" mode regardless of content type — works for JSON, form, GraphQL, etc.
        return JSONObject()
            .put("mode", "raw")
            .put("raw", rawBody)
            .put(
                "options",
                JSONObject().put(
                    "raw",
                    JSONObject().put(
                        "language",
                        when {
                            mimeType.contains("json", ignoreCase = true) -> "json"
                            mimeType.contains("xml", ignoreCase = true) -> "xml"
                            mimeType.contains("graphql", ignoreCase = true) -> "graphql"
                            else -> "text"
                        },
                    ),
                ),
            )
    }
}
