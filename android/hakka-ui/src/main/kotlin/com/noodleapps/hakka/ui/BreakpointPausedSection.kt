package com.noodleapps.hakka.ui

import android.app.Activity
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.noodleapps.hakka.BreakpointEngine
import com.noodleapps.hakka.PausedEntry
import com.noodleapps.hakka.PausedPhase

/**
 * [BreakpointsPanel]'s "paused requests" section — entries currently blocking an
 * OkHttp thread, with Resume / Edit / Abort actions. Split out purely for file
 * size; [container] is [BreakpointsPanel.pausedSection], rebuilt from scratch on
 * every [BreakpointsPanel.refresh] the same way it was when this lived inline.
 */
internal fun buildPausedSection(
    activity: Activity,
    engine: BreakpointEngine,
    container: LinearLayout,
    paused: List<PausedEntry>,
) {
    container.removeAllViews()
    if (paused.isEmpty()) return

    container.addView(LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(activity.resources, Theme.s12), dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s12), dp(activity.resources, Theme.s8))
        addView(boldText(activity, "Paused (${paused.size})", 14f).apply {
            setTextColor(Theme.warning)
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        })
        addView(TextView(activity).apply {
            text = "Resume All"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.success)
            setPadding(dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s4), dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s4))
            isClickable = true; isFocusable = true
            setOnClickListener { engine.resumeAll() }
        })
    })

    for (entry in paused) {
        container.addView(buildPausedCard(activity, engine, entry))
    }
}

private fun buildPausedCard(activity: Activity, engine: BreakpointEngine, entry: PausedEntry): View {
    val isRequest = entry.phase == PausedPhase.REQUEST

    return LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(Theme.surfaceRaised(activity))
        setPadding(dp(activity.resources, Theme.s12), dp(activity.resources, Theme.s10), dp(activity.resources, Theme.s12), dp(activity.resources, Theme.s10))
        val margin = LinearLayout.LayoutParams(MP, WC).apply {
            setMargins(dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s4), dp(activity.resources, Theme.s8), 0)
        }
        layoutParams = margin

        addView(LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(phaseBadge(activity, isRequest))
            val urlOrStatus = if (isRequest) entry.request?.url else "Status ${entry.response?.status}"
            addView(monoText(activity, urlOrStatus ?: "", 11f).apply {
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
                maxLines = 2; isSingleLine = false
            })
        })

        addView(divider(activity).apply {
            layoutParams = LinearLayout.LayoutParams(MP, dp(activity.resources, 1)).apply {
                setMargins(0, dp(activity.resources, Theme.s6), 0, dp(activity.resources, Theme.s6))
            }
        })

        addView(LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL

            addView(actionButton(activity, "Resume", Theme.success) {
                if (isRequest) engine.resumeRequest(entry.id)
                else engine.resumeResponse(entry.id)
            })

            addView(actionButton(activity, "Edit…", Theme.accent(activity)) {
                if (isRequest) showEditRequestDialog(activity, engine, entry)
                else showEditResponseDialog(activity, engine, entry)
            })

            addView(actionButton(activity, "Abort", Theme.error) {
                engine.abort(entry.id)
            })
        })
    }
}

private fun phaseBadge(activity: Activity, isRequest: Boolean): TextView = TextView(activity).apply {
    text = if (isRequest) "REQ" else "RESP"
    textSize = GeneratedMetrics.FontSize.xs.toFloat(); setTypeface(null, Typeface.BOLD)
    setTextColor(Theme.badgeText)
    val bg = GradientDrawable().apply {
        setColor(if (isRequest) Theme.methodPost else Theme.methodPut)
        cornerRadius = dp(activity.resources, Theme.radiusS).toFloat()
    }
    background = bg
    setPadding(dp(activity.resources, Theme.s4), dp(activity.resources, GeneratedMetrics.Spacing.xxs), dp(activity.resources, Theme.s4), dp(activity.resources, GeneratedMetrics.Spacing.xxs))
    layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
        setMargins(0, 0, dp(activity.resources, Theme.s6), 0)
    }
}

/** Tinted pill button — same shape as [SettingsActivity]'s applyButton. */
private fun actionButton(activity: Activity, label: String, color: Int, onClick: () -> Unit): TextView =
    TextView(activity).apply {
        text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(color)
        setPadding(dp(activity.resources, Theme.s10), dp(activity.resources, Theme.s6), dp(activity.resources, Theme.s10), dp(activity.resources, Theme.s6))
        val bg = GradientDrawable().apply {
            cornerRadius = dp(activity.resources, Theme.radiusM).toFloat()
            setColor(android.graphics.Color.argb(26, android.graphics.Color.red(color),
                android.graphics.Color.green(color), android.graphics.Color.blue(color)))
        }
        background = bg
        layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
            setMargins(0, 0, dp(activity.resources, Theme.s6), 0)
        }
        isClickable = true; isFocusable = true
        addRipple(activity)
        setOnClickListener { onClick() }
    }
