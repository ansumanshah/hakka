package com.noodleapps.hakka.ui

import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import com.noodleapps.hakka.ParsedCookie
import com.noodleapps.hakka.RequestCookie

// ── Detail tab cookie helpers ────────────────────────────────────────────
// Request-header `Cookie:` parsing (used by the Request tab) and `Set-Cookie:`
// response parsing (used by the Response tab) share this file since both
// render structured cookie tables from the same [DetailActivity] request.

/**
 * Returns the first value for [headerName] from [headers] (case-insensitive).
 * Used to retrieve the raw `Cookie:` header value for parsing.
 *
 * Note: stored headers are redacted if the header name is in [HakkaConfig.redactHeaders].
 * By default `cookie` and `set-cookie` are redacted, so the value seen here will be "██"
 * unless the caller has removed those from the redact-set.  We display whatever is stored
 * and let the user decide whether to redact cookie values in their config.
 */
internal fun DetailActivity.getRawCookieHeader(headers: Map<String, List<String>>, name: String): String? =
    headers.entries
        .firstOrNull { it.key.equals(name, ignoreCase = true) }
        ?.value?.firstOrNull()

/** Returns all values for [headerName] from [headers] (case-insensitive, multi-value). */
internal fun DetailActivity.getMultiHeaderValues(headers: Map<String, List<String>>, name: String): List<String> =
    headers.entries
        .filter { it.key.equals(name, ignoreCase = true) }
        .flatMap { it.value }

/** Renders a structured table of request [RequestCookie] name/value pairs. */
internal fun DetailActivity.buildRequestCookiesTable(parent: LinearLayout, cookies: List<RequestCookie>) {
    for (cookie in cookies) {
        parent.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(1), 0, dp(1))
            // Key column shrinks to fit its content — no fixed 1:2 split.
            addView(TextView(context).apply {
                text = cookie.name; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
                setTextColor(Theme.textSecondary(this@buildRequestCookiesTable))
                layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
                    setMargins(0, 0, dp(Theme.s8), 0)
                }
            })
            addView(TextView(context).apply {
                text = cookie.value; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
                setTextColor(Theme.text(this@buildRequestCookiesTable))
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
            })
        })
    }
}

/** Renders a structured card for each [ParsedCookie] from `Set-Cookie` headers. */
internal fun DetailActivity.buildSetCookiesTable(parent: LinearLayout, cookies: List<ParsedCookie>) {
    for (cookie in cookies) {
        val cardBg = GradientDrawable().apply {
            setColor(Theme.surface(this@buildSetCookiesTable)); cornerRadius = dp(Theme.radiusL).toFloat()
        }
        parent.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; background = cardBg
            setPadding(dp(Theme.s8), dp(Theme.s8), dp(Theme.s8), dp(Theme.s8))
            layoutParams = LinearLayout.LayoutParams(MP, WC).apply {
                setMargins(0, 0, 0, dp(Theme.s4))
            }
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(context).apply {
                    text = cookie.name; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
                    setTextColor(Theme.text(this@buildSetCookiesTable))
                    layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                })
                addView(TextView(context).apply {
                    text = cookie.value; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
                    setTextColor(Theme.text(this@buildSetCookiesTable))
                    layoutParams = LinearLayout.LayoutParams(0, WC, 2f)
                })
            })
            fun attr(label: String, value: String) {
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(1), 0, dp(1))
                    addView(TextView(context).apply {
                        text = label; textSize = GeneratedMetrics.FontSize.xs.toFloat()
                        setTextColor(Theme.textSecondary(this@buildSetCookiesTable))
                        layoutParams = LinearLayout.LayoutParams(dp(68), WC)
                    })
                    addView(TextView(context).apply {
                        text = value; textSize = GeneratedMetrics.FontSize.xs.toFloat(); setTypeface(Typeface.MONOSPACE)
                        setTextColor(Theme.text(this@buildSetCookiesTable))
                    })
                })
            }
            cookie.domain?.let { attr("Domain", it) }
            cookie.path?.let { attr("Path", it) }
            cookie.expires?.let { attr("Expires", it) }
            cookie.maxAge?.let { attr("Max-Age", it.toString()) }
            cookie.sameSite?.let { attr("SameSite", it.name) }
            // Boolean flags as badges
            val flags = buildList {
                if (cookie.httpOnly) add("HttpOnly")
                if (cookie.secure) add("Secure")
            }
            if (flags.isNotEmpty()) {
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL
                    setPadding(0, dp(Theme.s2), 0, 0)
                    for (flag in flags) {
                        val pill = GradientDrawable().apply {
                            setColor(Theme.surfaceRaised(this@buildSetCookiesTable))
                            cornerRadius = dp(Theme.radiusS).toFloat()
                        }
                        addView(TextView(context).apply {
                            text = flag; textSize = GeneratedMetrics.FontSize.xxs.toFloat(); gravity = Gravity.CENTER
                            setTextColor(Theme.textSecondary(this@buildSetCookiesTable))
                            background = pill
                            setPadding(dp(Theme.s6), dp(GeneratedMetrics.Spacing.xxs), dp(Theme.s6), dp(GeneratedMetrics.Spacing.xxs))
                            layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
                                setMargins(0, 0, dp(Theme.s4), 0)
                            }
                        })
                    }
                })
            }
        })
    }
}
