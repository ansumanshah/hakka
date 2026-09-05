package com.noodleapps.hakka.ui

import android.app.Activity
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Compose-first inspector shell shared by the fullscreen host and bottom sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun HakkaInspectorCompose(activity: Activity, onClose: () -> Unit) {
    val colors = hakkaColorScheme(activity)
    var tab by rememberSaveable { androidx.compose.runtime.mutableStateOf(NavTab.NETWORK) }
    val pageState = rememberSaveableStateHolder()
    MaterialTheme(colorScheme = colors, typography = HakkaTypography) {
        Scaffold(
            modifier = if (activity is HakkaActivity) Modifier.statusBarsPadding() else Modifier,
            containerColor = colors.background,
            contentWindowInsets = WindowInsets(0),
            topBar = {
                if (tab != NavTab.NETWORK) {
                    TopAppBar(
                        title = { Text(tab.label, style = MaterialTheme.typography.titleLarge) },
                        actions = {
                            IconButton(onClick = { activity.startActivity(Intent(activity, SettingsActivity::class.java)) }) {
                                Icon(painterResource(R.drawable.hakka_ic_settings), "Settings")
                            }
                            IconButton(onClick = onClose) { Icon(painterResource(R.drawable.hakka_ic_close), "Close") }
                        },
                    )
                }
            },
            bottomBar = { HakkaNavigation(tab, onSelect = { tab = it }) },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                pageState.SaveableStateProvider(tab.name) {
                    when (tab) {
                        NavTab.NETWORK -> ComposeNetworkPage(activity, onClose)
                        NavTab.STATS -> ComposeStatsPage(activity)
                        NavTab.LOGS -> ComposeLogsPage(activity)
                        NavTab.RULES -> ComposeRulesPage(activity)
                        NavTab.STORAGE -> ComposeStoragePage(activity)
                    }
                }
            }
        }
    }
}

@Composable
private fun HakkaNavigation(selected: NavTab, onSelect: (NavTab) -> Unit) = Surface(
    tonalElevation = 2.dp,
    modifier = Modifier.navigationBarsPadding(),
) {
    Row(Modifier.fillMaxWidth().height(56.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
        NavTab.entries.forEach { tab ->
            val active = tab == selected
            Box(
                Modifier.weight(1f).fillMaxSize().semantics { this.selected = active }.clickable { onSelect(tab) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painterResource(tab.iconRes), tab.label,
                    tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}
