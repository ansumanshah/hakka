package com.noodleapps.hakka.ui

import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

// ── Overview tab ──────────────────────────────────────────────────────

/**
 * Field-completeness contract: every row below is conditional on the
 * engine having captured it. Mirrors the RN/web/iOS Overview so dev+QA can rely on the
 * same field set cross-platform. Request ID is always shown (cross-references
 * hakka mcp's get_request).
 */
internal fun DetailActivity.buildOverviewTab() {
    val c = contentLayout

    // General section — field-completeness contract via buildOverviewRows (unit-tested)
    addSectionHeader(c, "General")
    val isGraphQL = request.graphqlOperationName != null || isGraphQLRequest(request)
    val graphqlMeta = if (isGraphQL) {
        GraphQLMetaParser.parse(request.requestBody, request.responseBody, request.graphqlOperationName)
    } else null
    val rows = buildOverviewRows(
        request = request,
        startedLabel = fmtTime(request.startTimeMs),
        durationLabel = request.durationMs?.let { fmtDuration(it) } ?: "…",
        requestSizeLabel = if (request.requestBodySize > 0) fmtSize(request.requestBodySize) else null,
        responseSizeLabel = if (request.responseBodySize > 0) fmtSize(request.responseBodySize) else null,
        contentType = headerValue(request.responseHeaders, "content-type"),
        contentEncoding = headerValue(request.responseHeaders, "content-encoding"),
        isGraphQL = isGraphQL,
        graphqlOperationType = graphqlMeta?.operationType,
        graphqlOperationName = graphqlMeta?.operationName,
    )
    for (row in rows) {
        // Long values (e.g. "Status" carrying a full error message) get a stacked
        // label-above-value layout instead of the fixed 1:2 side-by-side split —
        // squeezing prose into the narrow value column produces an ugly 3-line wrap.
        if (row.value.length > 40) addKVStacked(c, row.key, row.value) else addKV(c, row.key, row.value)
    }
    c.addView(divider(this))

    if (request.tlsVersion != null || request.cipherSuite != null) {
        addSectionHeader(c, "Connection")
        request.tlsVersion?.let { addKV(c, "Encryption", it) }
        request.cipherSuite?.let { addKV(c, "Cipher", it) }
        c.addView(divider(this))
    }

    if (request.error != null) {
        addSectionHeader(c, "Error")
        c.addView(TextView(this).apply {
            text = request.error; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.error)
            setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, dp(Theme.s4))
        })
        c.addView(divider(this))
    }

    if (request.redirectUrls.isNotEmpty()) {
        addSectionHeader(c, "Redirect chain")
        buildRedirectChain(c)
        c.addView(divider(this))
    }

    if (request.requestHeaders.isNotEmpty()) {
        addSectionHeader(c, "Request Headers")
        buildHeaderTable(c, request.requestHeaders)
        c.addView(divider(this))
    }

    if (request.responseHeaders.isNotEmpty()) {
        addSectionHeader(c, "Response Headers")
        buildHeaderTable(c, request.responseHeaders)
    }
}

private fun DetailActivity.buildRedirectChain(parent: LinearLayout) {
    for ((i, url) in request.redirectUrls.withIndex()) {
        val isLast = i == request.redirectUrls.lastIndex
        parent.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(Theme.s4), dp(GeneratedMetrics.Spacing.xs), 0, dp(GeneratedMetrics.Spacing.xs))
            val code = if (isLast) request.status else (if (i == 0) 301 else 302)
            val badge = GradientDrawable().apply {
                setColor(barColor(code)); cornerRadius = dp(Theme.radiusS).toFloat()
            }
            addView(TextView(context).apply {
                text = "${code ?: "?"}"; textSize = GeneratedMetrics.FontSize.xs.toFloat(); gravity = Gravity.CENTER
                setTextColor(Theme.badgeText); setTypeface(null, Typeface.BOLD)
                background = badge; setPadding(dp(Theme.s6), dp(GeneratedMetrics.Spacing.xxs), dp(Theme.s6), dp(GeneratedMetrics.Spacing.xxs))
            })
            val host = hostOf(url)
            val path = try { java.net.URL(url).path } catch (_: Exception) { url }
            addView(TextView(context).apply {
                text = "$host$path"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.text(this@buildRedirectChain))
                setPadding(dp(Theme.s6), 0, 0, 0); setSingleLine()
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
            })
        })
        if (!isLast) {
            parent.addView(TextView(this).apply {
                text = "  ↓"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.textSecondary(this@buildRedirectChain))
                setPadding(dp(Theme.s14), 0, 0, 0)
            })
        }
    }
}
