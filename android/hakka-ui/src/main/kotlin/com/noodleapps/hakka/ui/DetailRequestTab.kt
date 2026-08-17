package com.noodleapps.hakka.ui

import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import com.noodleapps.hakka.isUrlEncoded
import com.noodleapps.hakka.parseRequestCookies
import com.noodleapps.hakka.percentDecode

// ── Request tab ──────────────────────────────────────────────────────

internal fun DetailActivity.buildRequestTab() {
    val c = contentLayout
    val method = request.method.name
    val body = request.requestBody
    val hasQueryParams = request.url.contains("?")

    // Parse raw query params (no decode) to detect percent-encoding.
    val rawParams: List<Pair<String, String>> = if (hasQueryParams) {
        val query = request.url.substringAfter("?", "").substringBefore("#")
        query.split("&").map { pair ->
            val eq = pair.indexOf("=")
            if (eq == -1) pair to "" else pair.substring(0, eq) to pair.substring(eq + 1)
        }
    } else emptyList()

    val hasEncodedQueryParam = rawParams.any { (k, v) -> isUrlEncoded(k) || isUrlEncoded(v) }

    if (hasQueryParams) {
        addSectionHeaderRow(c, "Query Parameters") {
            if (hasEncodedQueryParam) addView(buildUrlDecodeToggle())
        }
        val displayParams = if (urlDecoded) {
            rawParams.map { (k, v) -> percentDecode(k) to percentDecode(v) }
        } else rawParams
        for ((key, value) in displayParams) addKV(c, key, value)
        c.addView(divider(this))
    }

    // Cookies (display-only: parsed raw from the unredacted header value is unavailable
    // since stored headers are redacted; the section shows the cookie names still visible
    // when the header was not fully redacted, or indicates cookies are present)
    val rawCookieHeader = getRawCookieHeader(request.requestHeaders, "cookie")
    val requestCookies = parseRequestCookies(rawCookieHeader)
    if (requestCookies.isNotEmpty()) {
        if (hasQueryParams) c.addView(divider(this))
        addSectionHeader(c, "Cookies (${requestCookies.size})")
        buildRequestCookiesTable(c, requestCookies)
        c.addView(divider(this))
    }

    if (body != null && method in listOf("POST", "PUT", "PATCH")) {
        // Detect form-urlencoded body to offer the same Decoded/Raw toggle.
        val ct = request.requestHeaders.entries
            .firstOrNull { it.key.equals("content-type", ignoreCase = true) }
            ?.value?.firstOrNull()?.lowercase() ?: ""
        val isFormEncoded = ct.contains("application/x-www-form-urlencoded")
        val hasEncodedBody = isFormEncoded && isUrlEncoded(body)

        addSectionHeaderRow(c, "Body") {
            if (hasEncodedBody) addView(buildUrlDecodeToggle())
        }
        if (isFormEncoded && hasEncodedBody) {
            buildFormEncodedBody(c, body)
        } else {
            buildBodyContent(c, body, ct.ifEmpty { null }, headerValue(request.requestHeaders, "content-encoding"))
        }
    } else if (body == null && !hasQueryParams && requestCookies.isEmpty()) {
        c.addView(grayText(this, "(no request body)", 12f).apply {
            setPadding(0, dp(Theme.s16), 0, dp(Theme.s16)); gravity = Gravity.CENTER
        })
    }
}

/**
 * Section header with an optional trailing widget (e.g. the Decoded/Raw toggle).
 * Replaces [addSectionHeader] for sections that may have a toggle.
 */
private fun DetailActivity.addSectionHeaderRow(parent: LinearLayout, title: String, block: LinearLayout.() -> Unit = {}) {
    parent.addView(LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setPadding(0, dp(Theme.s10), 0, dp(Theme.s4))
        addView(TextView(context).apply {
            text = title; textSize = GeneratedMetrics.FontSize.md.toFloat(); setTypeface(null, Typeface.BOLD)
            setTextColor(Theme.text(this@addSectionHeaderRow))
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        })
        block()
    })
}

/**
 * A pill-style "Decoded | Raw" toggle that flips [DetailActivity.urlDecoded] and rebuilds
 * the tab. Matches the RN ContentTab toggle visually (active = accent pill, inactive =
 * transparent).
 */
private fun DetailActivity.buildUrlDecodeToggle(): LinearLayout {
    val toggleBg = GradientDrawable().apply {
        setColor(Theme.surfaceRaised(this@buildUrlDecodeToggle)); cornerRadius = dp(Theme.radiusM).toFloat()
    }
    val container = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; background = toggleBg
        setPadding(dp(GeneratedMetrics.Spacing.xxs), dp(GeneratedMetrics.Spacing.xxs), dp(GeneratedMetrics.Spacing.xxs), dp(GeneratedMetrics.Spacing.xxs))
    }

    fun pill(label: String, active: Boolean, onClick: () -> Unit): TextView {
        val bg = if (active) GradientDrawable().apply {
            setColor(Theme.accent(this@buildUrlDecodeToggle)); cornerRadius = dp(Theme.radiusS).toFloat()
        } else null
        return TextView(this).apply {
            text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
            setTypeface(null, if (active) Typeface.BOLD else Typeface.NORMAL)
            setTextColor(if (active) Theme.badgeText else Theme.tabInactive(this@buildUrlDecodeToggle))
            background = bg
            setPadding(dp(Theme.s8), dp(GeneratedMetrics.Spacing.xs), dp(Theme.s8), dp(GeneratedMetrics.Spacing.xs))
            isClickable = true; isFocusable = true
            addRipple(this@buildUrlDecodeToggle)
            setOnClickListener { Haptics.light(this@buildUrlDecodeToggle); onClick() }
        }
    }

    container.addView(pill("Decoded", urlDecoded) {
        if (!urlDecoded) { urlDecoded = true; rebuildTabContent() }
    })
    container.addView(pill("Raw", !urlDecoded) {
        if (urlDecoded) { urlDecoded = false; rebuildTabContent() }
    })
    return container
}

/**
 * Render a form-urlencoded body as a key-value list, applying the current
 * [DetailActivity.urlDecoded] setting. Falls back to [buildBodyContent] for raw display.
 */
private fun DetailActivity.buildFormEncodedBody(parent: LinearLayout, body: String) {
    val pairs = body.split("&").map { pair ->
        val eq = pair.indexOf("=")
        if (eq == -1) pair to "" else pair.substring(0, eq) to pair.substring(eq + 1)
    }
    if (urlDecoded) {
        for ((k, v) in pairs) addKV(parent, percentDecode(k), percentDecode(v))
    } else {
        for ((k, v) in pairs) addKV(parent, k, v)
    }
}
