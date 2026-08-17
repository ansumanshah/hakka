package com.noodleapps.hakka.ui

/**
 * The five persistent bottom-nav destinations, in tab-bar order. Every destination is
 * one tap away, always labeled, always visible — no hidden overflow menu.
 *
 * Settings is deliberately NOT a tab: it's a persistent header gear reachable from
 * every tab (see [SettingsActivity]) rather than spending a sixth, low-frequency
 * bottom-bar slot. Five is the practical one-handed reach ceiling for a bottom bar.
 */
enum class NavTab(val label: String, val iconRes: Int) {
    NETWORK("Network", R.drawable.hakka_ic_network),
    STATS("Stats", R.drawable.hakka_ic_stats),
    LOGS("Logs", R.drawable.hakka_ic_logs),
    RULES("Rules", R.drawable.hakka_ic_rules),
    STORAGE("Storage", R.drawable.hakka_ic_storage),
}
