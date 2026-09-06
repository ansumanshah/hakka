package com.noodleapps.hakka.ui

import android.content.Context
import android.graphics.Color as AndroidColor
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
    val surface = Color(Theme.surface(context))
    val raised = Color(Theme.surfaceRaised(context))
    val text = Color(Theme.text(context))
    val secondary = Color(Theme.textSecondary(context))
    val outline = Color(Theme.border(context))
    return if (Theme.isDark(context)) darkColorScheme(
        primary = primary, onPrimary = Color(Theme.badgeText), primaryContainer = raised, onPrimaryContainer = text,
        secondary = secondary, onSecondary = Color(Theme.bg(context)), secondaryContainer = raised, onSecondaryContainer = text,
        tertiary = Color(AndroidColor.parseColor(GeneratedTokens.timingTcp)), onTertiary = Color(Theme.bg(context)), tertiaryContainer = raised, onTertiaryContainer = text,
        background = Color(Theme.bg(context)), surface = surface, surfaceVariant = raised, surfaceContainerLow = raised,
        onBackground = text, onSurface = text, onSurfaceVariant = secondary, outline = outline,
        error = Color(Theme.error), onError = Color(Theme.badgeText), errorContainer = raised, onErrorContainer = text,
    ) else lightColorScheme(
        primary = primary, onPrimary = Color(Theme.badgeText), primaryContainer = raised, onPrimaryContainer = text,
        secondary = secondary, onSecondary = Color(Theme.bg(context)), secondaryContainer = raised, onSecondaryContainer = text,
        tertiary = Color(AndroidColor.parseColor(GeneratedTokens.timingTcp)), onTertiary = Color(Theme.bg(context)), tertiaryContainer = raised, onTertiaryContainer = text,
        background = Color(Theme.bg(context)), surface = surface, surfaceVariant = raised, surfaceContainerLow = raised,
        onBackground = text, onSurface = text, onSurfaceVariant = secondary, outline = outline,
        error = Color(Theme.error), onError = Color(Theme.badgeText), errorContainer = raised, onErrorContainer = text,
    )
}

internal val HakkaTypography = Typography(
    titleLarge = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
)
