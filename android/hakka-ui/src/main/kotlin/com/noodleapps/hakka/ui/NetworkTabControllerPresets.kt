package com.noodleapps.hakka.ui

import android.app.AlertDialog
import android.widget.EditText
import android.widget.Toast
import com.noodleapps.hakka.NetworkRequest

// ── Stats ─────────────────────────────────────────────────────────────

internal fun NetworkTabController.updateStatsBar(requests: List<NetworkRequest>) {
    if (!isStatsLabelReady()) return
    val ok = requests.count { (it.status ?: 0) in 200..399 }
    val errs = requests.count { (it.status ?: 0) >= 400 || it.error != null }
    val pending = requests.count { it.status == null && it.error == null }
    val avgMs = requests.mapNotNull { it.durationMs }.let { if (it.isEmpty()) null else it.average().toLong() }
    val parts = mutableListOf("${requests.size} reqs")
    parts.add("$ok ok")
    if (errs > 0) parts.add("$errs err")
    if (pending > 0) parts.add("$pending ···")
    if (avgMs != null) parts.add("avg ${fmtDuration(avgMs)}")
    statsLabel.text = parts.joinToString(" · ")
}

// ── Filter preset helpers ────────────────────────────────────────────

/** Snapshot current filter/sort/group state into a [FilterPreset]. */
private fun NetworkTabController.currentPreset(): FilterPreset = FilterPreset(
    searchQuery = searchQuery,
    methodFilters = activeMethodFilters.toSet(),
    statusGroup = activeStatusGroup,
    domain = activeDomain,
    sortField = sortField,
    sortAscending = sortAscending,
    groupBy = groupBy,
)

/** Apply all fields from [preset] to the live filter state and refresh the UI. */
internal fun NetworkTabController.applyPreset(preset: FilterPreset) {
    searchQuery = preset.searchQuery
    activeMethodFilters.clear(); activeMethodFilters.addAll(preset.methodFilters)
    activeStatusGroup = preset.statusGroup
    activeDomain = preset.domain
    sortField = preset.sortField
    sortAscending = preset.sortAscending
    groupBy = preset.groupBy
    // Sync the search-bar EditText so the user can see the restored text
    searchEditText?.setText(preset.searchQuery)
    rebuildQuickChips()
    rebuildFilterChips()
    applyFilters()
}

/** Push the current state to the recent list (no-op if all-default). */
internal fun NetworkTabController.pushCurrentToRecent() {
    if (isPresetStoreReady()) presetStore.pushRecent(currentPreset())
}

/** Show a dialog to name and save the current filter state. */
internal fun NetworkTabController.showSavePresetDialog() {
    val input = EditText(activity).apply {
        hint = "Preset name"; textSize = GeneratedMetrics.FontSize.lg.toFloat()
        setTextColor(Theme.text(activity))
        setHintTextColor(Theme.textSecondary(activity))
        setPadding(dp(Theme.s16), dp(Theme.s8), dp(Theme.s16), dp(Theme.s8))
    }
    AlertDialog.Builder(activity)
        .setTitle("Save filter preset")
        .setView(input)
        .setPositiveButton("Save") { _, _ ->
            val name = input.text.toString().trim()
            if (name.isEmpty()) {
                Toast.makeText(activity, "Name cannot be empty", Toast.LENGTH_SHORT).show()
                return@setPositiveButton
            }
            presetStore.save(name, currentPreset())
            rebuildFilterChips()
            Toast.makeText(activity, "Preset '$name' saved", Toast.LENGTH_SHORT).show()
        }
        .setNegativeButton("Cancel", null)
        .show()
}
