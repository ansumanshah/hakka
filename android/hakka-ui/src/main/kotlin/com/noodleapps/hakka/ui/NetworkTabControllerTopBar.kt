package com.noodleapps.hakka.ui

import android.view.Gravity
import android.view.View
import android.widget.PopupMenu
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

// ── Top bar ──────────────────────────────────────────────────────────
// Capture stats + the frequent pause control share one compact row. Less frequent
// session actions stay in the overflow so the request list starts near the chrome.

internal fun NetworkTabController.buildNormalTopBar() {
    topBarContainer.removeAllViews()
    topBarContainer.addView(LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(activity))
        setPadding(dp(GeneratedMetrics.Layout.gutter), dp(Theme.s10), dp(GeneratedMetrics.Layout.gutter), dp(Theme.s6))

        statsLabel = TextView(activity).apply {
            textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.textSecondary(activity))
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        }
        addView(statsLabel)

        val paused = HakkaUI.getInstance(activity).logStore?.isPaused == true
        addView(iconButton(
            activity,
            activity.resources,
            if (paused) R.drawable.hakka_ic_play else R.drawable.hakka_ic_pause,
            if (paused) "Resume capture" else "Pause capture",
            Theme.accent(activity),
        ) { togglePause() }.also { it.tag = "pauseBtn" })
        val moreActions = iconButton(activity, activity.resources, R.drawable.hakka_ic_more, "More session actions") {}
        moreActions.setOnClickListener {
            PopupMenu(activity, moreActions).apply {
                menu.add("Select requests").setOnMenuItemClickListener { enterSelectionMode(); true }
                menu.add("Share report").setOnMenuItemClickListener { shareReport(allRequests.take(20)); true }
                menu.add("Clear requests").setOnMenuItemClickListener { clearRequests(); true }
                show()
            }
        }
        addView(moreActions)
        onOpenSettings?.let { openSettings ->
            addView(iconButton(activity, activity.resources, R.drawable.hakka_ic_settings, "Settings", onClick = openSettings))
        }
        onCloseInspector?.let { closeInspector ->
            addView(iconButton(activity, activity.resources, R.drawable.hakka_ic_close, "Close inspector", onClick = closeInspector))
        }
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
        addView(iconButton(activity, activity.resources, R.drawable.hakka_ic_share, "Share selected") {
            val selected = allRequests.filter { it.id in selectedIds }
            if (selected.isNotEmpty()) shareReport(selected)
            else Toast.makeText(activity, "No requests selected", Toast.LENGTH_SHORT).show()
        })
        addView(topBarButton("Done") { exitSelectionMode() })
    })
}

private fun NetworkTabController.topBarButton(label: String, onClick: () -> Unit) = TextView(activity).apply {
    text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.accent(activity))
    gravity = Gravity.CENTER
    minimumHeight = dp(48)
    setPadding(dp(Theme.s10), 0, dp(Theme.s10), 0)
    setOnClickListener { onClick() }
}
