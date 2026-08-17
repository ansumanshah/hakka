package com.noodleapps.hakka.ui

import android.content.Context
import android.view.View

/**
 * Android-specific panel descriptor contributed by a [com.noodleapps.hakka.HakkaPlugin].
 *
 * Unlike the platform-neutral TypeScript descriptor, the Android panel carries a
 * [viewFactory] so the inspector host can inflate a fully native [View] on demand
 * rather than using a descriptor-to-renderer look-up table.
 *
 * @property id Stable identifier, unique across all registered plugins.
 *   Must match a panel id declared in [com.noodleapps.hakka.HakkaPlugin] if the plugin
 *   also contributes panels via that interface.
 * @property title Display title shown in the tab bar / navigation row.
 * @property order Lower values sort first in the tab bar.
 *   Built-in panels occupy orders 0–9; plugin panels should start at 100+.
 * @property icon Optional Android drawable resource id used as the tab icon.
 *   Pass null to use a text-only tab.
 * @property viewFactory Called once (or on re-layout) by the inspector host to create
 *   the panel's root [View]. Receives the host [Context].
 *   Must not throw — wrap unsafe construction internally.
 */
data class HakkaPanel(
    val id: String,
    val title: String,
    val order: Int = 100,
    val icon: Int? = null,
    val viewFactory: (Context) -> View,
)

/**
 * Extended [com.noodleapps.hakka.HakkaPlugin] contract for plugins that also contribute
 * Android UI panels to the inspector.
 *
 * Not currently rendered by either inspector shell ([HakkaActivity] / [HakkaBottomSheet]) —
 * both host a fixed Network/Stats/Logs/Rules/Storage tab set with no plugin-panel slot.
 * Kept as a public type for forward compatibility; a future host would collect
 * [androidPanels] from all registered plugins and sort by [HakkaPanel.order].
 */
interface HakkaAndroidPlugin : com.noodleapps.hakka.HakkaPlugin {
    /** Android panels this plugin contributes. Sorted by [HakkaPanel.order] by the host. */
    val androidPanels: List<HakkaPanel> get() = emptyList()
}
