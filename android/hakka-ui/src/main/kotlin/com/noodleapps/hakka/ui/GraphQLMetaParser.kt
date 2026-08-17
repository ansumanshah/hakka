package com.noodleapps.hakka.ui

import org.json.JSONObject

/**
 * Parses GraphQL operation metadata (type, name, query/mutation text, variables, response
 * errors) from a captured request/response body pair — display-time only, mirrors
 * `GraphQLBodyParser` on iOS. No field is added to the wire schema (RECORD_SCHEMA_VERSION is
 * untouched); this is pure UI-side parsing of the body Android already captured, kept out
 * of [DetailActivity] so it's unit-testable without an Activity/Context.
 */
internal object GraphQLMetaParser {

    data class GraphQLMeta(
        val operationType: String?,
        val operationName: String?,
        val query: String?,
        val variables: String?,
        val errors: String?,
    )

    /**
     * @param requestBody the captured request body (raw JSON string), or null.
     * @param responseBody the captured response body (raw JSON string), or null.
     * @param knownOperationName `NetworkRequest.graphqlOperationName` if the engine already
     *   resolved it — preferred over any `operationName` field parsed from the body.
     */
    fun parse(requestBody: String?, responseBody: String?, knownOperationName: String?): GraphQLMeta {
        var operationType: String? = null
        var operationName: String? = knownOperationName
        var query: String? = null
        var variables: String? = null
        var errors: String? = null

        if (requestBody != null) {
            try {
                val json = JSONObject(requestBody)
                if (operationName == null) {
                    val opName = json.optString("operationName", "")
                    if (opName.isNotBlank()) operationName = opName
                }
                val q = json.optString("query", "")
                if (q.isNotBlank()) {
                    query = q
                    val match = Regex("""^\s*(query|mutation|subscription)""").find(q)
                    operationType = match?.groupValues?.getOrNull(1)
                }
                val vars = json.optJSONObject("variables")
                if (vars != null) variables = vars.toString(2)
            } catch (_: Exception) {
                // Not valid JSON (e.g. a body truncated by maxBodySize) — leave fields null.
            }
        }

        if (responseBody != null) {
            try {
                val respJson = JSONObject(responseBody)
                val errArray = respJson.optJSONArray("errors")
                if (errArray != null && errArray.length() > 0) errors = errArray.toString(2)
            } catch (_: Exception) {}
        }

        return GraphQLMeta(operationType, operationName, query, variables, errors)
    }
}
