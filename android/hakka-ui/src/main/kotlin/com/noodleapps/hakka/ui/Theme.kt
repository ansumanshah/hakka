package com.noodleapps.hakka.ui

import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.graphics.Color
import android.view.ViewGroup

// ── Theme ────────────────────────────────────────────────────────────
// Wok Hei tokens (GeneratedTokens, mirrored from design-tokens.json — shared
// with RN + iOS). Dark-first; follows the device's dark/light setting via
// Configuration.uiMode, never the host app's Material theme attributes — the
// inspector must look like Wok Hei (warm graphite ground) on every host app,
// not whatever colorBackground/textColorPrimary that app happens to define.

object Theme {
    // Query system dark mode — independent of any theme applied to the
    // current Activity/Context, so this is correct even when the host
    // app forces a specific theme.
    private fun isDark(ctx: Context): Boolean =
        (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    // Backgrounds / surfaces — Wok Hei warm graphite (dark) / warm cream (light)
    fun bg(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.darkBackground else GeneratedTokens.lightBackground)
    fun surface(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.darkSurface else GeneratedTokens.lightSurface)
    fun surfaceRaised(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.darkSurfaceRaised else GeneratedTokens.lightSurfaceRaised)
    fun border(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.darkBorder else GeneratedTokens.lightBorder)

    // Text — Wok Hei text tokens (dark/light aware)
    fun text(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.darkText else GeneratedTokens.lightText)
    fun textSecondary(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.darkTextSecondary else GeneratedTokens.lightTextSecondary)
    fun textTertiary(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.darkTextTertiary else GeneratedTokens.lightTextTertiary)

    // Status / method / timing / code colors come from GeneratedTokens
    // (mirrored from design-tokens.json — shared with RN + iOS).
    val success: Int = Color.parseColor(GeneratedTokens.statusSuccess)
    val info: Int = Color.parseColor(GeneratedTokens.statusInfo)
    val warning: Int = Color.parseColor(GeneratedTokens.statusWarning)
    val error: Int = Color.parseColor(GeneratedTokens.statusError)
    val pending: Int = Color.parseColor(GeneratedTokens.statusPending)

    // HTTP method badges
    val methodGet: Int = Color.parseColor(GeneratedTokens.methodGet)
    val methodPost: Int = Color.parseColor(GeneratedTokens.methodPost)
    val methodPut: Int = Color.parseColor(GeneratedTokens.methodPut)
    val methodPatch: Int = Color.parseColor(GeneratedTokens.methodPatch)
    val methodDelete: Int = Color.parseColor(GeneratedTokens.methodDelete)
    val methodOther: Int = Color.parseColor(GeneratedTokens.methodOther)

    // JSON syntax palette
    fun jsonKey(ctx: Context): Int = text(ctx) // bold weight distinguishes
    fun jsonString(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.codeDarkString else GeneratedTokens.codeLightString)
    fun jsonNumber(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.codeDarkNumber else GeneratedTokens.codeLightNumber)
    fun jsonBool(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.codeDarkBoolean else GeneratedTokens.codeLightBoolean)
    fun jsonNull(ctx: Context): Int = jsonBool(ctx)
    fun jsonPunctuation(ctx: Context): Int = textSecondary(ctx) // braces, commas, colons

    // Timing phases
    val timingDNS: Int = Color.parseColor(GeneratedTokens.timingDns)
    val timingTCP: Int = Color.parseColor(GeneratedTokens.timingTcp)
    val timingTLS: Int = Color.parseColor(GeneratedTokens.timingTls)
    val timingTTFB: Int = Color.parseColor(GeneratedTokens.timingTtfb)
    val timingDownload: Int = Color.parseColor(GeneratedTokens.timingDownload)

    // UI elements — accent is the flame token (dark/light-aware); it is the
    // ONLY color for active tab / selected row / primary buttons / focus.
    // Steel (info) is reserved for the 3xx/info semantic — never for accent.
    fun accent(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.darkAccent else GeneratedTokens.lightAccent)
    fun tabInactive(ctx: Context): Int = textSecondary(ctx)

    // Badge text — always white on colored badges
    val badgeText: Int = Color.WHITE

    // Search highlight — dim (non-focused matches)
    fun searchHighlight(ctx: Context): Int =
        Color.parseColor(if (isDark(ctx)) GeneratedTokens.codeDarkHighlight else GeneratedTokens.codeLightHighlight)

    // Search highlight — active/focused match (brighter accent)
    fun searchHighlightActive(ctx: Context): Int =
        if (isDark(ctx)) Color.argb(200, 0xF5, 0x9E, 0x0B)  // amber-500 @ 78%
        else Color.argb(220, 0xF5, 0x9E, 0x0B)               // amber-500 @ 86%

    // ── Geometry (dp values, call dp() to convert) ──
    //
    // The numbers live in [GeneratedMetrics], generated from the same scale RN,
    // web and iOS use — see DESIGN.md "One geometry". The `sN` spellings are the
    // legacy value-named aliases kept for the 225 existing call sites: `s16`
    // says how big the gap is but not what it is, which is how the page edge
    // drifted from screen to screen. Prefer [GeneratedMetrics.Layout.gutter] for
    // a page edge and [GeneratedMetrics.ControlHeight] for anything interactive.

    const val s2 = GeneratedMetrics.Spacing.xxs
    const val s4 = GeneratedMetrics.Spacing.xs
    const val s6 = GeneratedMetrics.Spacing.sm
    const val s8 = GeneratedMetrics.Spacing.md
    const val s10 = GeneratedMetrics.Spacing.ml
    const val s12 = GeneratedMetrics.Spacing.lg
    const val s14 = GeneratedMetrics.Spacing.ll
    const val s16 = GeneratedMetrics.Spacing.xl

    // ── Corner radii (dp) ──
    const val radiusS = GeneratedMetrics.Radius.sm
    const val radiusM = GeneratedMetrics.Radius.md
    const val radiusL = GeneratedMetrics.Radius.lg
}

// ── Layout constants ─────────────────────────────────────────────────

const val MP = ViewGroup.LayoutParams.MATCH_PARENT
const val WC = ViewGroup.LayoutParams.WRAP_CONTENT

fun dp(res: Resources, dp: Int): Int = (dp * res.displayMetrics.density).toInt()
