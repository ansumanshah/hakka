package com.noodleapps.hakka.ui

import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

// ── Top bar ──────────────────────────────────────────────────────────
// Row 1: capture stats. Row 2: action icons — Pause/Resume + Share + Trash + Select.
// Close lives in HakkaActivity's shared header.

internal fun NetworkTabController.buildNormalTopBar() {
    topBarContainer.removeAllViews()
    topBarContainer.addView(LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(Theme.s16), dp(Theme.s10), dp(Theme.s16), dp(Theme.s8))

        // Row 1: capture stats
        statsLabel = TextView(activity).apply {
            textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.textSecondary(activity))
        }
        addView(statsLabel)

        // Row 2: action buttons — Pause/Resume (the one frequent, always-relevant
        // toggle) stays permanently docked; Select is contextual entry into
        // selection mode rather than another docked action.
        addView(LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(Theme.s8), 0, 0)
            val pauseLabel = HakkaUI.getInstance(activity).logStore?.isPaused == true
            addView(topBarButton(if (pauseLabel) "Resume" else "Pause") { togglePause() }.also {
                it.tag = "pauseBtn"
            })
            addView(View(activity), LinearLayout.LayoutParams(0, 1, 1f))
            addView(iconButton(activity, activity.resources, R.drawable.hakka_ic_share) {
                shareReport(allRequests.take(20))
            })
            // Destructive — chili tint, per Wok Hei accent discipline.
            addView(iconButton(activity, activity.resources, R.drawable.hakka_ic_trash, Theme.error) {
                clearRequests()
            })
            addView(iconButton(activity, activity.resources, R.drawable.hakka_ic_check) {
                enterSelectionMode()
            })
        })
    })
}

internal fun NetworkTabController.buildSelectionTopBar() {
    topBarContainer.removeAllViews()
    topBarContainer.addView(LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(Theme.s16), dp(Theme.s14), dp(Theme.s4), dp(Theme.s6))
        setBackgroundColor(Theme.surface(activity))
        addView(boldText(activity, "${selectedIds.size} selected", 14f).apply {
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        })
        addView(iconButton(activity, activity.resources, R.drawable.hakka_ic_share) {
            val selected = allRequests.filter { it.id in selectedIds }
            if (selected.isNotEmpty()) shareReport(selected)
            else Toast.makeText(activity, "No requests selected", Toast.LENGTH_SHORT).show()
        })
        addView(topBarButton("Done") { exitSelectionMode() })
    })
}

private fun NetworkTabController.topBarButton(label: String, onClick: () -> Unit) = TextView(activity).apply {
    text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.accent(activity))
    setPadding(dp(Theme.s12), dp(Theme.s6), dp(Theme.s8), dp(Theme.s6))
    setOnClickListener { onClick() }
}
