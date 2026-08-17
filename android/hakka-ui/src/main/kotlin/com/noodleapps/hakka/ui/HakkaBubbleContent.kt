package com.noodleapps.hakka.ui

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.noodleapps.hakka.NetworkRequest

// ── Collapsed / expanded content ─────────────────────────────────────

internal fun HakkaBubble.setExpanded(activity: Activity, expanded: Boolean) {
    val target = if (expanded) BubbleUiState.EXPANDED else BubbleUiState.COLLAPSED
    if (target == uiState) return
    uiState = target
    rebuildContent(activity)
}

internal fun HakkaBubble.rebuildContent(activity: Activity) {
    val bubble = bubbleView ?: return
    bubble.removeAllViews()
    recentRowsContainer = null
    val content = if (uiState == BubbleUiState.EXPANDED) buildExpandedContent(activity) else buildCapsuleContent(activity)
    bubble.addView(content, FrameLayout.LayoutParams(MP, MP))
    applyBubbleShape(activity)
    resizeWindow(activity)
    render()
}

internal fun HakkaBubble.applyBubbleShape(activity: Activity) {
    val bubble = bubbleView ?: return
    val res = activity.resources
    val bg = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = if (uiState == BubbleUiState.EXPANDED) {
            dp(res, Theme.radiusL).toFloat()
        } else {
            dp(res, BUBBLE_HEIGHT_DP) / 2f
        }
        setColor(COLOR_BG)
        setStroke(dp(res, 1).toInt(), COLOR_BORDER)
    }
    bubble.background = bg
}

/** Resizes/repositions the overlay window for the current [uiState], preserving
 *  whichever screen edge the bubble is currently anchored to. */
internal fun HakkaBubble.resizeWindow(activity: Activity) {
    val wm = windowManager ?: return
    val bubble = bubbleView ?: return
    val params = layoutParams ?: return
    val res = activity.resources
    val screenWidth = res.displayMetrics.widthPixels
    val screenHeight = res.displayMetrics.heightPixels
    val edgePadding = dp(res, EDGE_PADDING_DP)

    val oldWidth = params.width.takeIf { it > 0 } ?: dp(res, BUBBLE_WIDTH_DP)
    val newWidth = if (uiState == BubbleUiState.EXPANDED) dp(res, EXPANDED_WIDTH_DP) else dp(res, BUBBLE_WIDTH_DP)
    val newHeight = if (uiState == BubbleUiState.EXPANDED) {
        WindowManager.LayoutParams.WRAP_CONTENT
    } else {
        dp(res, BUBBLE_HEIGHT_DP)
    }

    val wasRightAnchored = (params.x + oldWidth / 2) > screenWidth / 2
    params.x = if (wasRightAnchored) {
        (params.x + oldWidth - newWidth).coerceAtLeast(edgePadding)
    } else {
        params.x.coerceIn(edgePadding, (screenWidth - newWidth - edgePadding).coerceAtLeast(edgePadding))
    }
    if (uiState == BubbleUiState.EXPANDED) {
        val estimatedHeight = dp(res, EXPANDED_HEIGHT_BUDGET_DP)
        val maxY = (screenHeight - estimatedHeight - edgePadding).coerceAtLeast(edgePadding)
        if (params.y > maxY) params.y = maxY
    }
    params.width = newWidth
    params.height = newHeight
    try { wm.updateViewLayout(bubble, params) } catch (_: Exception) {}
}

internal fun HakkaBubble.buildCapsuleContent(activity: Activity): LinearLayout {
    val res = activity.resources
    val content = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
        setPadding(dp(res, 10).toInt(), 0, dp(res, 10).toInt(), 0)
    }

    val requestMetric = metricStack(activity, valueWidthDp = 34)
    requestValueView = requestMetric.value
    requestCaptionView = requestMetric.caption.apply { text = "REQ" }
    content.addView(requestMetric.container)
    content.addView(metricDivider(activity))

    val networkMetric = metricStack(activity, valueWidthDp = 44, valueTextSize = 17f)
    networkValueView = networkMetric.value
    networkCaptionView = networkMetric.caption.apply { text = "P95" }
    content.addView(networkMetric.container)
    content.addView(metricDivider(activity))

    val fpsMetric = metricStack(activity, valueWidthDp = 34, withDetail = true)
    fpsValueView = fpsMetric.value
    fpsCaptionView = fpsMetric.caption.apply { text = "FPS" }
    fpsDetailView = fpsMetric.detail
    content.addView(fpsMetric.container)
    return content
}

/** Capsule row + a divider + the most recent captured requests, compact HUD style. */
internal fun HakkaBubble.buildExpandedContent(activity: Activity): LinearLayout {
    val res = activity.resources
    return LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        addView(buildCapsuleContent(activity), LinearLayout.LayoutParams(MP, dp(res, BUBBLE_HEIGHT_DP)))
        addView(View(activity).apply {
            setBackgroundColor(COLOR_BORDER)
            layoutParams = LinearLayout.LayoutParams(MP, dp(res, 1))
        })
        val rows = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(res, 10).toInt(), dp(res, 6).toInt(), dp(res, 10).toInt(), dp(res, 8).toInt())
        }
        recentRowsContainer = rows
        addView(rows)
    }.also { populateRecentRows(activity) }
}

/** Method + path + status, in the same plain-text method treatment and status
 *  coloring the request-list rows use (`styleAsPlainMethodText` / `statusTextColor`
 *  — see DESIGN.md's "chips are for controls, rows get plain text" rule). */
internal fun HakkaBubble.populateRecentRows(activity: Activity) {
    val rows = recentRowsContainer ?: return
    rows.removeAllViews()
    val recent = (logStore?.all() ?: emptyList()).sortedByDescending { it.startTimeMs }.take(MAX_RECENT_ROWS)
    if (recent.isEmpty()) {
        rows.addView(TextView(activity).apply {
            text = "No requests yet"; textSize = GeneratedMetrics.FontSize.xs.toFloat(); setTextColor(COLOR_MUTED)
        })
        return
    }
    for (r in recent) rows.addView(buildRecentRow(activity, r))
}

private fun HakkaBubble.buildRecentRow(activity: Activity, r: NetworkRequest): LinearLayout {
    val res = activity.resources
    return LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, dp(res, 2).toInt(), 0, dp(res, 2).toInt())
        addView(TextView(activity).also { styleAsPlainMethodText(it, r.method.name, widthDp = 36, sp = 9f) })
        addView(TextView(activity).apply {
            text = pathText(r); textSize = GeneratedMetrics.FontSize.xs.toFloat(); maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setTextColor(COLOR_TEXT)
            setPadding(dp(res, 4).toInt(), 0, dp(res, 4).toInt(), 0)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        addView(TextView(activity).apply {
            text = fmtStatusOnly(r); textSize = GeneratedMetrics.FontSize.xxs.toFloat()
            setTypeface(Typeface.MONOSPACE)
            setTextColor(statusTextColor(r.status, r.error != null))
        })
    }
}

internal data class MetricViews(
    val container: LinearLayout,
    val value: TextView,
    val caption: TextView,
    val detail: TextView? = null,
)

internal fun HakkaBubble.metricStack(
    activity: Activity,
    valueWidthDp: Int,
    valueTextSize: Float = 18f,
    withDetail: Boolean = false,
): MetricViews {
    val value = TextView(activity).apply {
        text = "--"
        textSize = valueTextSize
        setTextColor(COLOR_MUTED)
        setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
        gravity = Gravity.CENTER
        includeFontPadding = false
        maxLines = 1
    }
    val caption = TextView(activity).apply {
        textSize = GeneratedMetrics.FontSize.xxs.toFloat()
        setTextColor(COLOR_MUTED)
        setTypeface(null, Typeface.BOLD)
        gravity = Gravity.CENTER
        includeFontPadding = false
        maxLines = 1
    }
    val detail = if (withDetail) {
        TextView(activity).apply {
            text = "JNK -- FRZ --"
            textSize = GeneratedMetrics.FontSize.xxs.toFloat()
            setTextColor(COLOR_MUTED)
            gravity = Gravity.CENTER
            includeFontPadding = false
            maxLines = 1
            layoutParams = LinearLayout.LayoutParams(
                dp(resources, valueWidthDp).toInt(),
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply {
                setMargins(0, dp(resources, 1), 0, 0)
            }
        }
    } else null
    val container = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        addView(value, LinearLayout.LayoutParams(dp(resources, valueWidthDp).toInt(), dp(resources, 22).toInt()))
        addView(caption, LinearLayout.LayoutParams(dp(resources, valueWidthDp).toInt(), dp(resources, 12).toInt()))
        if (detail != null) addView(detail)
    }
    return MetricViews(container, value, caption, detail)
}

internal fun HakkaBubble.metricDivider(activity: Activity): View =
    View(activity).apply {
        setBackgroundColor(withAlpha(Color.parseColor(GeneratedTokens.darkBorder), 200))
        layoutParams = LinearLayout.LayoutParams(dp(resources, 1).toInt(), dp(resources, 25).toInt()).apply {
            marginStart = dp(resources, 5).toInt()
            marginEnd = dp(resources, 5).toInt()
        }
    }
