package com.noodleapps.hakka.ui

import com.noodleapps.hakka.NetworkRequest
import com.noodleapps.hakka.RequestSource

/**
 * A single conditional key/value row in the Detail Overview tab.
 * Pure data — no Android View dependency — so the row-derivation logic is
 * unit-testable without an Activity/Context.
 */
data class OverviewRow(val key: String, val value: String)

/**
 * Derives the Overview tab's field-completeness contract:
 * URL, Method, Status, Duration, Request/Response size, Content-Type,
 * Encoding, Protocol, Started, Source, Redirects(+chain), WebSocket
 * frames(+protocol), Trace/correlationId, GraphQL op, Mocked, Request ID.
 * Every row is conditional on the engine having captured it — this function
 * is the single source of truth for that contract so [DetailActivity] and
 * tests share the same logic.
 *
 * Value formatting for duration/size/timestamp is intentionally left to the
 * caller (Android's mono-tabular formatters live in Formatters.kt) — this
 * function only decides WHICH rows appear, in WHAT order, with the raw
 * value, so it stays a plain-Kotlin/JVM unit test target with no Android
 * dependency.
 *
 * @param startedLabel pre-formatted "Started" timestamp.
 * @param durationLabel pre-formatted duration ("…" while pending).
 * @param requestSizeLabel pre-formatted request body size, or null if 0 bytes.
 * @param responseSizeLabel pre-formatted response body size, or null if 0 bytes.
 * @param isGraphQL whether the request/response body parsed as a GraphQL operation.
 * @param graphqlOperationType parsed from the request/response body by the
 *   caller (JSON parsing needs `org.json`, kept out of this pure module).
 * @param graphqlOperationName resolved GraphQL operation name, if any.
 */
fun buildOverviewRows(
    request: NetworkRequest,
    startedLabel: String,
    durationLabel: String,
    requestSizeLabel: String?,
    responseSizeLabel: String?,
    contentType: String?,
    contentEncoding: String?,
    isGraphQL: Boolean,
    graphqlOperationType: String?,
    graphqlOperationName: String?,
): List<OverviewRow> {
    val rows = mutableListOf<OverviewRow>()
    rows += OverviewRow("URL", request.url)
    rows += OverviewRow("Method", request.method.name)
    // Short class label only — the full error text lives in the dedicated Error
    // section alone (DetailActivity.buildOverviewTab). Printing the full raw
    // message in both places said the same fact twice on one screen.
    rows += OverviewRow(
        "Status",
        when {
            request.status != null -> request.status.toString()
            request.error != null -> "ERR"
            else -> "Pending"
        },
    )
    rows += OverviewRow("Duration", durationLabel)
    requestSizeLabel?.let { rows += OverviewRow("Request size", it) }
    responseSizeLabel?.let { rows += OverviewRow("Response size", it) }
    contentType?.let { rows += OverviewRow("Content-Type", it) }
    contentEncoding?.let { rows += OverviewRow("Encoding", it) }
    request.protocol?.let { rows += OverviewRow("Protocol", it) }
    rows += OverviewRow("Started", startedLabel)
    rows += OverviewRow("Source", request.source.value)
    if (request.redirectUrls.isNotEmpty()) {
        rows += OverviewRow("Redirects", "${request.redirectCount} · ${request.redirectUrls.joinToString(" → ")}")
    }
    if (request.wsMessages.isNotEmpty()) {
        val proto = request.wsProtocol?.let { " · $it" } ?: ""
        rows += OverviewRow("WebSocket", "${request.wsMessages.size} frames$proto")
    }
    request.correlationId?.let { rows += OverviewRow("Trace", it) }
    if (isGraphQL) {
        val opType = graphqlOperationType ?: "operation"
        val name = graphqlOperationName?.let { " · $it" } ?: ""
        rows += OverviewRow("GraphQL", "$opType$name")
    }
    if (request.source == RequestSource.MOCK) rows += OverviewRow("Mocked", "Yes")
    rows += OverviewRow("Request ID", request.id)
    return rows
}
