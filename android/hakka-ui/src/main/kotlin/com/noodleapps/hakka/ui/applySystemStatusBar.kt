package com.noodleapps.hakka.ui

import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.view.View
import android.view.Window
import android.view.WindowInsetsController

/** Matches system bars to the active Hakka theme. */
@Suppress("DEPRECATION")
internal fun applySystemStatusBar(window: Window, context: Context) {
    window.statusBarColor = Theme.bg(context)
    window.navigationBarColor = Theme.bg(context)
    val isDark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val statusAppearance = if (isDark) 0 else WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
        val navigationAppearance = if (isDark) 0 else WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance(
            statusAppearance or navigationAppearance,
            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
        )
    } else {
        window.decorView.systemUiVisibility = if (isDark) 0
            else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
    }
}
