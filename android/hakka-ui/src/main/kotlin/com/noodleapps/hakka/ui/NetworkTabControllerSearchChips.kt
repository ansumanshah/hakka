package com.noodleapps.hakka.ui

import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView

// ── Search bar ───────────────────────────────────────────────────────

internal fun NetworkTabController.buildSearchBar() = LinearLayout(activity).apply {
    orientation = LinearLayout.VERTICAL
    setBackgroundColor(Theme.surface(activity))
    setPadding(dp(Theme.s8), dp(Theme.s4), dp(Theme.s4), dp(Theme.s4))
    val searchBg = GradientDrawable().apply {
        setColor(Theme.bg(activity)); cornerRadius = dp(Theme.radiusL).toFloat()
    }
    addView(LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        addView(EditText(context).also { et ->
            searchEditText = et
            et.hint = "Search — url: header: body: /regex/ *glob*"; et.textSize = GeneratedMetrics.FontSize.lg.toFloat(); et.setSingleLine()
            et.setTextColor(Theme.text(activity))
            et.setHintTextColor(Theme.textSecondary(activity))
            et.background = searchBg
            et.setPadding(dp(Theme.s12), dp(Theme.s8), dp(Theme.s12), dp(Theme.s8))
            et.layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
            et.setText(searchQuery)
            et.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: android.text.Editable?) {
                    searchQuery = s?.toString()?.trim().orEmpty()
                    applyFilters()
                }
            })
        })
        addView(buildFiltersTrigger())
    })
    addView(buildQuickChipRow())
}

/**
 * "Filters +n" disclosure trigger: the sort icon plus a small count badge that stays
 * visible even while collapsed, so an active status filter/sort/group is never
 * silently hidden. `filterContainer` holds Status/Domain/Sort/Group/Presets —
 * everything past search+methods.
 */
private fun NetworkTabController.buildFiltersTrigger(): FrameLayout {
    val icon = iconButton(activity, activity.resources, R.drawable.hakka_ic_sort, "Filters",
        if (filtersExpanded) Theme.accent(activity) else Theme.textSecondary(activity)) {
        filtersExpanded = !filtersExpanded
        filterContainer.visibility = if (filtersExpanded) View.VISIBLE else View.GONE
        Haptics.light(activity)
    }
    filtersTrigger = FrameLayout(activity).apply { addView(icon) }
    refreshFiltersBadge()
    return filtersTrigger
}

/** Rebuild the count badge on the "Filters +n" trigger — called on every filter change. */
internal fun NetworkTabController.refreshFiltersBadge() {
    if (!isFiltersTriggerReady()) return
    // Keep index 0 (the icon), drop any previous badge view.
    while (filtersTrigger.childCount > 1) filtersTrigger.removeViewAt(1)
    val count = activeFilterCount()
    if (count > 0) {
        filtersTrigger.addView(TextView(activity).apply {
            text = if (count > 9) "9+" else count.toString()
            textSize = GeneratedMetrics.FontSize.xxs.toFloat(); gravity = Gravity.CENTER
            setTextColor(Theme.badgeText); setTypeface(null, Typeface.BOLD)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL; setColor(Theme.accent(activity))
            }
            layoutParams = FrameLayout.LayoutParams(dp(14), dp(14)).apply {
                gravity = Gravity.TOP or Gravity.END
                topMargin = dp(2); rightMargin = dp(2)
            }
        })
    }
}

/** Count of non-default filter/sort/group state — feeds the "Filters +n" badge. */
private fun NetworkTabController.activeFilterCount(): Int {
    var n = 0
    if (activeStatusGroup != null) n++
    if (activeDomain != null) n++
    if (sortField != SortField.TIME || sortAscending) n++
    if (groupBy != GroupBy.NONE) n++
    return n
}

/**
 * Primary quick-chip row — method chips only, matching DESIGN.md's rule and web's
 * reference implementation: the always-visible row is search + methods + the
 * "Filters +n" disclosure, nothing else inline. Status class, domain, sort, and
 * group all live behind the disclosure (`filterContainer`) instead of a second
 * always-visible chip row — see [rebuildQuickChips].
 */
private fun NetworkTabController.buildQuickChipRow() = HorizontalScrollView(activity).apply {
    isHorizontalScrollBarEnabled = false
    setPadding(0, dp(Theme.s4), 0, 0)
    quickChipStrip = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
    addView(quickChipStrip)
    rebuildQuickChips()
}

internal fun NetworkTabController.rebuildQuickChips() {
    if (!isQuickChipStripReady()) return
    quickChipStrip.removeAllViews()
    for (m in listOf("GET", "POST", "PUT", "PATCH", "DELETE")) {
        quickChipStrip.addView(quietQuickChip(activity, m, methodColor(m), m in activeMethodFilters) {
            if (activeMethodFilters.contains(m)) activeMethodFilters.remove(m)
            else activeMethodFilters.add(m); rebuildQuickChips(); applyFilters()
        })
    }
}
