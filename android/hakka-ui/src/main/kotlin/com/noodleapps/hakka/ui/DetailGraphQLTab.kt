package com.noodleapps.hakka.ui

import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.widget.TextView
import com.noodleapps.hakka.NetworkRequest

// ── GraphQL tab ──────────────────────────────────────────────────────

/** Returns true when the request looks like a GraphQL operation (URL or content-type). */
internal fun DetailActivity.isGraphQLRequest(r: NetworkRequest): Boolean {
    if (r.url.contains("graphql", ignoreCase = true)) return true
    val ct = r.requestHeaders.entries.firstOrNull { it.key.equals("content-type", ignoreCase = true) }
        ?.value?.firstOrNull() ?: return false
    return ct.contains("graphql", ignoreCase = true)
}

internal fun DetailActivity.buildGraphQLTab() {
    val c = contentLayout
    val meta = GraphQLMetaParser.parse(request.requestBody, request.responseBody, request.graphqlOperationName)

    addSectionHeader(c, "Operation")
    val opType = meta.operationType ?: "(unknown)"
    val opName = meta.operationName ?: "(anonymous)"
    addKV(c, "Type", opType.replaceFirstChar { it.uppercase() })
    addKV(c, "Name", opName)
    c.addView(divider(this))

    // Query section — raw query/mutation text, parsed locally from the request body
    // (not carried on the wire; matches iOS's GraphQLBodyParser.query).
    if (!meta.query.isNullOrBlank()) {
        addSectionHeader(c, "Query")
        buildBodyContent(c, meta.query)
        c.addView(divider(this))
    }

    if (meta.variables != null) {
        addSectionHeader(c, "Variables")
        buildBodyContent(c, meta.variables, "application/json", null)
        c.addView(divider(this))
    } else {
        addSectionHeader(c, "Variables")
        c.addView(grayText(this, "(none)", 12f).apply {
            setPadding(0, dp(Theme.s4), 0, dp(Theme.s8))
        })
        c.addView(divider(this))
    }

    if (meta.errors != null) {
        addSectionHeader(c, "Errors")
        val errorBg = GradientDrawable().apply {
            setColor(Theme.surface(this@buildGraphQLTab))
            setStroke(dp(1), Theme.error)
            cornerRadius = dp(Theme.radiusM).toFloat()
        }
        c.addView(TextView(this).apply {
            text = meta.errors; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
            setTextColor(Theme.error); background = errorBg
            setPadding(dp(Theme.s8), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))
        })
    } else if (request.responseBody != null) {
        addSectionHeader(c, "Errors")
        c.addView(grayText(this, "(none)", 12f).apply {
            setPadding(0, dp(Theme.s4), 0, dp(Theme.s8))
        })
    }
}
