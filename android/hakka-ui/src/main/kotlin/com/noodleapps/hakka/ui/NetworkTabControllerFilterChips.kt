package com.noodleapps.hakka.ui

import android.app.AlertDialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

// ── Filter chips ─────────────────────────────────────────────────────

internal fun NetworkTabController.buildFilterSection() = LinearLayout(activity).apply {
    orientation = LinearLayout.VERTICAL; visibility = View.GONE
    setBackgroundColor(Theme.surface(activity))
    setPadding(dp(Theme.s8), dp(Theme.s4), dp(Theme.s8), dp(Theme.s8))
}.also { rebuildFilterChips() }

private fun NetworkTabController.chipRow(label: String, block: LinearLayout.() -> Unit) = LinearLayout(activity).apply {
    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
    setPadding(0, dp(GeneratedMetrics.Spacing.xxs), 0, dp(GeneratedMetrics.Spacing.xxs))
    addView(TextView(context).apply {
        text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.textSecondary(activity))
        layoutParams = LinearLayout.LayoutParams(dp(50), WC)
    })
    addView(HorizontalScrollView(context).apply {
        isHorizontalScrollBarEnabled = false
        addView(LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; block() })
        layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
    })
}

private fun NetworkTabController.filterChip(label: String, color: Int, active: Boolean, onClick: () -> Unit): TextView {
    val pill = GradientDrawable().apply {
        cornerRadius = dp(Theme.radiusM).toFloat()
        if (active) { setColor(color); setStroke(0, 0) }
        else { setColor(Color.TRANSPARENT); setStroke(dp(1), Theme.border(activity)) }
    }
    return TextView(activity).apply {
        text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
        setTextColor(if (active) Theme.badgeText else Theme.textSecondary(activity))
        setTypeface(null, if (active) Typeface.BOLD else Typeface.NORMAL)
        background = pill; setPadding(dp(GeneratedMetrics.Spacing.ml), dp(Theme.s4), dp(GeneratedMetrics.Spacing.ml), dp(Theme.s4))
        layoutParams = LinearLayout.LayoutParams(WC, WC).apply { setMargins(0, 0, dp(Theme.s6), 0) }
        addRipple(activity)
        setOnClickListener { onClick() }
    }
}

internal fun NetworkTabController.rebuildFilterChips() {
    if (isFilterContainerReady()) filterContainer.removeAllViews() else return
    refreshFiltersBadge()
    // Status-class chips — the always-visible quick-chip row is methods-only;
    // see buildQuickChipRow.
    filterContainer.addView(chipRow("Status") {
        for (cls in listOf("1xx", "2xx", "3xx", "4xx", "5xx")) {
            addView(filterChip(cls, statusClassColor(cls), activeStatusGroup == cls) {
                activeStatusGroup = if (activeStatusGroup == cls) null else cls
                rebuildFilterChips(); applyFilters()
            })
        }
    })
    // Domain/Sort/Group stay here in the disclosure.
    val domains = allRequests.map { hostOf(it.url) }.filter { it.isNotEmpty() }.distinct().sorted()
    if (domains.isNotEmpty()) filterContainer.addView(chipRow("Domain") {
        addView(filterChip("all", Theme.textSecondary(activity), activeDomain == null) {
            activeDomain = null; rebuildFilterChips(); applyFilters()
        })
        for (d in domains.take(10)) addView(filterChip(d, Theme.info, activeDomain == d) {
            activeDomain = if (activeDomain == d) null else d; rebuildFilterChips(); applyFilters()
        })
    })
    filterContainer.addView(chipRow("Sort") {
        val fields = listOf(
            SortField.TIME to "Time",
            SortField.DURATION to "Duration",
            SortField.SIZE to "Size",
            SortField.STATUS to "Status",
        )
        for ((field, label) in fields) {
            val active = sortField == field
            val chipLabel = if (active) "$label ${if (sortAscending) "↑" else "↓"}" else label
            addView(filterChip(chipLabel, Theme.info, active) {
                if (sortField == field) sortAscending = !sortAscending
                else { sortField = field; sortAscending = false }
                rebuildFilterChips(); applyFilters()
            })
        }
    })
    filterContainer.addView(chipRow("Group") {
        val groups = listOf(
            GroupBy.NONE to "None",
            GroupBy.HOST to "Host",
            GroupBy.STATUS_CLASS to "Status",
            GroupBy.METHOD to "Method",
            GroupBy.ERROR to "Error",
        )
        for ((group, label) in groups) {
            addView(filterChip(label, Theme.warning, groupBy == group) {
                groupBy = group; rebuildFilterChips(); applyFilters()
            })
        }
    })

    // ── Preset rows ───────────────────────────────────────────────────
    if (isPresetStoreReady()) {
        buildPresetRows()
    }
}

/** Appends "Save", "Saved", and "Recent" rows to filterContainer. */
private fun NetworkTabController.buildPresetRows() {
    val saved = presetStore.loadSaved()
    val recent = presetStore.loadRecent()

    filterContainer.addView(LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setPadding(0, dp(Theme.s4), 0, dp(GeneratedMetrics.Spacing.xxs))
        addView(TextView(context).apply {
            text = "Presets"; textSize = GeneratedMetrics.FontSize.sm.toFloat()
            setTextColor(Theme.textSecondary(activity))
            layoutParams = LinearLayout.LayoutParams(dp(50), WC)
        })
        addView(HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(saveChip())
                for (np in saved) {
                    addView(savedPresetChip(np.name, np.preset))
                }
            })
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        })
    })

    if (recent.isNotEmpty()) {
        filterContainer.addView(chipRow("Recent") {
            for (preset in recent) {
                addView(recentPresetChip(preset))
            }
        })
    }
}

/** Small "Save…" action chip that opens the save dialog. */
private fun NetworkTabController.saveChip(): TextView {
    val pill = GradientDrawable().apply {
        cornerRadius = dp(Theme.radiusM).toFloat()
        setColor(Color.TRANSPARENT)
        setStroke(dp(1), Theme.accent(activity))
    }
    return TextView(activity).apply {
        text = "+ Save"; textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
        setTextColor(Theme.accent(activity))
        background = pill
        setPadding(dp(GeneratedMetrics.Spacing.ml), dp(Theme.s4), dp(GeneratedMetrics.Spacing.ml), dp(Theme.s4))
        layoutParams = LinearLayout.LayoutParams(WC, WC).apply { setMargins(0, 0, dp(Theme.s6), 0) }
        addRipple(activity)
        setOnClickListener { showSavePresetDialog() }
    }
}

/** Chip for a named saved preset — tap to apply, long-press to delete. */
private fun NetworkTabController.savedPresetChip(name: String, preset: FilterPreset): TextView {
    val pill = GradientDrawable().apply {
        cornerRadius = dp(Theme.radiusM).toFloat()
        setColor(Color.TRANSPARENT)
        setStroke(dp(1), Theme.border(activity))
    }
    return TextView(activity).apply {
        text = name; textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
        setTextColor(Theme.textSecondary(activity))
        background = pill
        // Bookmark glyph as a small tinted vector icon, never an emoji — see DESIGN.md.
        val bookmarkIcon = activity.resources.getDrawable(R.drawable.hakka_ic_bookmark, activity.theme).apply {
            setBounds(0, 0, dp(11), dp(11))
        }
        setCompoundDrawables(bookmarkIcon, null, null, null)
        compoundDrawablePadding = dp(Theme.s4)
        compoundDrawableTintList = ColorStateList.valueOf(Theme.textSecondary(activity))
        setPadding(dp(GeneratedMetrics.Spacing.ml), dp(Theme.s4), dp(GeneratedMetrics.Spacing.ml), dp(Theme.s4))
        layoutParams = LinearLayout.LayoutParams(WC, WC).apply { setMargins(0, 0, dp(Theme.s6), 0) }
        addRipple(activity)
        setOnClickListener {
            Haptics.light(activity)
            applyPreset(preset)
        }
        setOnLongClickListener {
            AlertDialog.Builder(activity)
                .setTitle("Delete preset '$name'?")
                .setPositiveButton("Delete") { _, _ ->
                    presetStore.remove(name)
                    rebuildFilterChips()
                    Toast.makeText(activity, "Preset deleted", Toast.LENGTH_SHORT).show()
                }
                .setNegativeButton("Cancel", null)
                .show()
            true
        }
    }
}

/** Chip for a recent filter state — tap to apply. */
private fun NetworkTabController.recentPresetChip(preset: FilterPreset): TextView {
    val label = buildRecentLabel(preset)
    val pill = GradientDrawable().apply {
        cornerRadius = dp(Theme.radiusM).toFloat()
        setColor(Color.TRANSPARENT)
        setStroke(dp(1), Theme.border(activity))
    }
    return TextView(activity).apply {
        text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
        setTextColor(Theme.textSecondary(activity))
        background = pill
        setPadding(dp(GeneratedMetrics.Spacing.ml), dp(Theme.s4), dp(GeneratedMetrics.Spacing.ml), dp(Theme.s4))
        layoutParams = LinearLayout.LayoutParams(WC, WC).apply { setMargins(0, 0, dp(Theme.s6), 0) }
        addRipple(activity)
        setOnClickListener {
            Haptics.light(activity)
            applyPreset(preset)
        }
    }
}

/** Build a compact human-readable label for a recent filter preset. */
private fun NetworkTabController.buildRecentLabel(p: FilterPreset): String {
    val parts = mutableListOf<String>()
    if (p.searchQuery.isNotEmpty()) parts.add("'${p.searchQuery.take(12)}${if (p.searchQuery.length > 12) "..." else ""}'")
    if (p.methodFilters.isNotEmpty()) parts.add(p.methodFilters.take(2).joinToString("+"))
    if (p.statusGroup != null) parts.add(p.statusGroup)
    if (p.groupBy != GroupBy.NONE) parts.add("grp:${p.groupBy.name.lowercase()}")
    return if (parts.isEmpty()) "default" else parts.joinToString(" ")
}
