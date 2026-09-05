package com.noodleapps.hakka.ui

import android.content.Context
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Hakka's existing generated tokens expressed as Material 3 roles. */
internal fun hakkaColorScheme(context: Context): ColorScheme {
    val primary = Color(Theme.accent(context))
    return if (Theme.isDark(context)) darkColorScheme(
        primary = primary, background = Color(Theme.bg(context)), surface = Color(Theme.surface(context)),
        surfaceContainerLow = Color(Theme.surfaceRaised(context)), onBackground = Color(Theme.text(context)),
        onSurface = Color(Theme.text(context)), onSurfaceVariant = Color(Theme.textSecondary(context)),
    ) else lightColorScheme(
        primary = primary, background = Color(Theme.bg(context)), surface = Color(Theme.surface(context)),
        surfaceContainerLow = Color(Theme.surfaceRaised(context)), onBackground = Color(Theme.text(context)),
        onSurface = Color(Theme.text(context)), onSurfaceVariant = Color(Theme.textSecondary(context)),
    )
}

internal val HakkaTypography = Typography(
    titleLarge = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
)
