package com.noodleapps.hakka.ui

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.sp

/** Settings for the live interceptor. Changes apply to this session only. */
class SettingsActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val interceptor = HakkaUI.getInstance(this).interceptor
            window.navigationBarColor = Theme.bg(this)
            applySystemStatusBar(window, this)
            setContent {
                SettingsMaterialTheme(this@SettingsActivity) {
                    SettingsScreen(this@SettingsActivity, interceptor, ::finish)
                }
            }
        } catch (_: Exception) {
            finish()
        }
    }
}

@Composable
private fun SettingsMaterialTheme(activity: ComponentActivity, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = hakkaColorScheme(activity), typography = HakkaTypography, content = content)
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun SettingsScreen(
    activity: ComponentActivity,
    interceptor: com.noodleapps.hakka.HakkaInterceptor?,
    onBack: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Text("‹", fontSize = 32.sp) }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                    navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
                ),
            )
        },
    ) { padding ->
        SettingsContent(
            activity = activity,
            interceptor = interceptor,
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(padding),
        )
    }
}
