package com.noodleapps.hakka.ui

import android.graphics.Typeface
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

// ── Detail tab shared row/section builders ──────────────────────────────
// Generic KV-row and section-header primitives used across every DetailActivity
// tab (Overview, Request, Response, Timing, Frames, GraphQL). Kept separate from
// any one tab file since none of them own this vocabulary exclusively.

/** First value of a header (case-insensitive), or null. */
internal fun DetailActivity.headerValue(headers: Map<String, List<String>>, name: String): String? =
    headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value?.firstOrNull()

internal fun DetailActivity.addSectionHeader(parent: LinearLayout, title: String) {
    parent.addView(TextView(this).apply {
        text = title; textSize = GeneratedMetrics.FontSize.md.toFloat(); setTypeface(null, Typeface.BOLD)
        setTextColor(Theme.text(this@addSectionHeader))
        setPadding(0, dp(Theme.s10), 0, dp(Theme.s4))
    })
}

internal fun DetailActivity.addKV(parent: LinearLayout, key: String, value: String) {
    parent.addView(LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, dp(GeneratedMetrics.Spacing.xxs))
        // Key column shrinks to fit its own content (no fixed 1:2 split) so short
        // labels ("URL", "Method") don't waste width the value column could use.
        addView(TextView(context).apply {
            text = key; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.textSecondary(this@addKV))
            layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
                setMargins(0, 0, dp(Theme.s8), 0)
            }
        })
        addView(TextView(context).apply {
            text = value; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
            setTextColor(Theme.text(this@addKV)); gravity = Gravity.END
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        })
    })
}

/**
 * Stacked key/value row for long-form values (e.g. an error message on the
 * "Status" row) — label on its own line, value wraps full-width below at
 * body-text size instead of being squeezed into the narrow value column.
 */
internal fun DetailActivity.addKVStacked(parent: LinearLayout, key: String, value: String) {
    parent.addView(LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, dp(GeneratedMetrics.Spacing.xxs))
        addView(TextView(context).apply {
            text = key; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.textSecondary(this@addKVStacked))
        })
        addView(TextView(context).apply {
            text = value; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
            setTextColor(Theme.error); setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, 0)
        })
    })
}

internal fun DetailActivity.buildHeaderTable(parent: LinearLayout, headers: Map<String, List<String>>) {
    for ((name, values) in headers) for (v in values) {
        parent.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(1), 0, dp(1))
            addView(TextView(context).apply {
                text = "$name: "; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
                setTextColor(Theme.textSecondary(this@buildHeaderTable))
            })
            addView(TextView(context).apply {
                text = v; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
                setTextColor(Theme.text(this@buildHeaderTable))
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
            })
        })
    }
}
