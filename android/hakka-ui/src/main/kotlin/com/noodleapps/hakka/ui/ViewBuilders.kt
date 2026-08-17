package com.noodleapps.hakka.ui

import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

// ── Shared Android View builders ─────────────────────────────────────
// Every function here constructs (or restyles) a View given plain data and
// callbacks — no dependency on any panel's instance state. Kept separate
// from Formatters.kt (data → String/Int, no View construction).

internal fun divider(ctx: Context): View = View(ctx).apply {
    setBackgroundColor(Theme.border(ctx))
    layoutParams = LinearLayout.LayoutParams(MP, dp(ctx.resources, 1)).apply {
        setMargins(0, dp(ctx.resources, Theme.s4), 0, dp(ctx.resources, Theme.s4))
    }
}

internal fun grayText(ctx: Context, s: String, sp: Float) = TextView(ctx).apply {
    text = s; textSize = sp; setTextColor(Theme.textSecondary(ctx))
}

internal fun hRow(ctx: Context, topPad: Int = 0, block: LinearLayout.() -> Unit) = LinearLayout(ctx).apply {
    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
    if (topPad > 0) setPadding(0, topPad, 0, 0); block()
}

internal fun boldText(ctx: Context, s: String, sp: Float) = TextView(ctx).apply {
    text = s; textSize = sp; setTextColor(Theme.text(ctx)); setTypeface(null, Typeface.BOLD)
}

internal fun monoText(ctx: Context, s: String, sp: Float) = TextView(ctx).apply {
    text = s; textSize = sp; setTextColor(Theme.textSecondary(ctx)); setTypeface(Typeface.MONOSPACE)
}

/**
 * Wok Hei method chip — outlined mono tint. Method-colored text, ~40%-opacity
 * border, ~10% tint background, radius-s (4dp, nested-badge scale), fixed width.
 * NEVER a filled pill with white text — chips whisper, status speaks.
 */
fun methodChip(ctx: Context, method: String, widthDp: Int = 52, sp: Float = 10f): TextView {
    val color = methodColor(method)
    val bg = GradientDrawable().apply {
        cornerRadius = dp(ctx.resources, Theme.radiusS).toFloat()
        setColor(Color.argb(26, Color.red(color), Color.green(color), Color.blue(color))) // ~10%
        setStroke(dp(ctx.resources, 1), Color.argb(102, Color.red(color), Color.green(color), Color.blue(color))) // ~40%
    }
    return TextView(ctx).apply {
        text = method; textSize = sp; gravity = Gravity.CENTER
        setTextColor(color); setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
        background = bg
        setPadding(dp(ctx.resources, Theme.s4), dp(ctx.resources, 2), dp(ctx.resources, Theme.s4), dp(ctx.resources, 2))
        layoutParams = LinearLayout.LayoutParams(dp(ctx.resources, widthDp), WC)
    }
}

/**
 * Wok Hei quiet quick chip — method/status chip family used in the primary
 * filter row. Quiet at rest (graphite tertiary text, default border) so five
 * always-lit colors don't shout; semantic [tone] appears only when [active]
 * (then: tone text, ~40%-opacity tone border, ~10% tone tint background).
 * Same box language as [methodChip]: radius-s, mono, bold, ~20dp total height.
 */
internal fun quietQuickChip(
    ctx: Context, label: String, tone: Int, active: Boolean, onClick: () -> Unit,
): TextView {
    val bg = GradientDrawable().apply {
        cornerRadius = dp(ctx.resources, Theme.radiusS).toFloat()
        if (active) {
            setColor(Color.argb(26, Color.red(tone), Color.green(tone), Color.blue(tone))) // ~10%
            setStroke(dp(ctx.resources, 1), Color.argb(102, Color.red(tone), Color.green(tone), Color.blue(tone))) // ~40%
        } else {
            setColor(Color.TRANSPARENT)
            setStroke(dp(ctx.resources, 1), Theme.border(ctx))
        }
    }
    return TextView(ctx).apply {
        text = label; textSize = GeneratedMetrics.FontSize.xs.toFloat(); gravity = Gravity.CENTER
        setTextColor(if (active) tone else Theme.textTertiary(ctx))
        setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
        background = bg
        setPadding(dp(ctx.resources, Theme.s6), dp(ctx.resources, 3), dp(ctx.resources, Theme.s6), dp(ctx.resources, 3))
        layoutParams = LinearLayout.LayoutParams(WC, WC).apply { setMargins(0, 0, dp(ctx.resources, Theme.s6), 0) }
        isClickable = true; isFocusable = true
        addRipple(ctx)
        setOnClickListener { onClick() }
    }
}

/**
 * Wok Hei segmented switch — tinted track (radius-md) holding mono uppercase
 * segment buttons (radius-sm, the "nested" scale). The active segment fills
 * with the accent at ~16% opacity; inactive segments are quiet graphite text.
 * Returns the track view; call [onSelect] to react to taps (index into [labels]).
 */
internal fun buildSegmentedSwitch(
    ctx: Context, labels: List<String>, selectedIndex: Int, onSelect: (Int) -> Unit,
): LinearLayout {
    val trackBg = GradientDrawable().apply {
        cornerRadius = dp(ctx.resources, Theme.radiusM).toFloat()
        setColor(Theme.surfaceRaised(ctx))
        setStroke(dp(ctx.resources, 1), Theme.border(ctx))
    }
    val track = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        background = trackBg
        setPadding(dp(ctx.resources, 2), dp(ctx.resources, 2), dp(ctx.resources, 2), dp(ctx.resources, 2))
    }
    val segViews = mutableListOf<TextView>()

    fun restyle() {
        segViews.forEachIndexed { i, tv ->
            val active = i == selectedIndex
            tv.setTextColor(if (active) Theme.accent(ctx) else Theme.textTertiary(ctx))
            tv.setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            tv.background = if (active) GradientDrawable().apply {
                cornerRadius = dp(ctx.resources, Theme.radiusS).toFloat()
                val accent = Theme.accent(ctx)
                setColor(Color.argb(41, Color.red(accent), Color.green(accent), Color.blue(accent))) // ~16%
            } else null
        }
    }

    labels.forEachIndexed { i, label ->
        val tv = TextView(ctx).apply {
            text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
            isAllCaps = true; letterSpacing = 0.03f
            setPadding(dp(ctx.resources, Theme.s10), dp(ctx.resources, Theme.s6), dp(ctx.resources, Theme.s10), dp(ctx.resources, Theme.s6))
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
            isClickable = true; isFocusable = true
            addRipple(ctx)
            setOnClickListener { onSelect(i) }
        }
        segViews.add(tv)
        track.addView(tv)
    }
    restyle()
    return track
}

/**
 * Plain-text method label for LIST ROWS: rows are data, not controls — mono,
 * bold, uppercase, method-colored text with no border or tinted background.
 * [methodChip] stays reserved for interactive controls (filter bar, demo
 * buttons). Mutates [tv] in place so RecyclerView/ListView row-recycling can
 * call this on every bind without allocating a new TextView, and can also be
 * used to style a freshly-built TextView the first time.
 */
internal fun styleAsPlainMethodText(tv: TextView, method: String, widthDp: Int = 52, sp: Float = 11f) {
    tv.text = method
    tv.textSize = sp
    tv.gravity = Gravity.START or Gravity.CENTER_VERTICAL
    tv.setTextColor(methodColor(method))
    tv.setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
    tv.background = null
    tv.setPadding(0, 0, 0, 0)
    tv.layoutParams = LinearLayout.LayoutParams(dp(tv.resources, widthDp), WC)
}

/**
 * Navigation-bar inset in px for padding the bottom tab bar under a gesture-nav
 * strip — same resource-lookup fallback pattern as the bubble's edge clamps,
 * kept here so [HakkaActivity]'s tab bar can share it.
 */
internal fun navigationBarInsetPx(res: Resources): Int {
    val id = res.getIdentifier("navigation_bar_height", "dimen", "android")
    return if (id > 0) res.getDimensionPixelSize(id) else dp(res, 48)
}

/**
 * Icon button. [drawableRes] must be one of hakka-ui's own `R.drawable.hakka_ic_*`
 * vector assets — never `android.R.drawable.ic_menu_*` (shaded 2.x-era bitmaps whose
 * internal gloss/gradient survives tinting, and which vary per OEM skin) and never a
 * unicode/emoji glyph rendered as a TextView. See `res/drawable/hakka_ic_*.xml`.
 */
internal fun iconButton(
    ctx: Context, res: Resources, drawableRes: Int, tint: Int? = null, onClick: () -> Unit,
) = ImageView(ctx).apply {
    setImageResource(drawableRes)
    val color = tint ?: Theme.textSecondary(ctx)
    @Suppress("DEPRECATION") setColorFilter(color, PorterDuff.Mode.SRC_IN)
    val pad = dp(res, Theme.s8)
    setPadding(pad, pad, pad, pad)
    layoutParams = LinearLayout.LayoutParams(dp(res, 36), dp(res, 36)).apply {
        gravity = Gravity.CENTER_VERTICAL
    }
    isClickable = true; isFocusable = true
    addRipple(ctx)
    setOnClickListener { onClick() }
}

/** Sets status bar color to match theme and adjusts icon appearance for light/dark. */
@Suppress("DEPRECATION")
internal fun applySystemStatusBar(window: android.view.Window, ctx: Context) {
    window.statusBarColor = Theme.bg(ctx)
    window.navigationBarColor = Theme.bg(ctx)
    val isDark = (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val statusAppearance = if (isDark) 0 else android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
        val navAppearance = if (isDark) 0 else android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance(
            statusAppearance or navAppearance,
            android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        )
    } else {
        window.decorView.systemUiVisibility = if (isDark) 0
            else (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
    }
}

/** Add platform ripple feedback to any clickable view. */
fun View.addRipple(ctx: Context) {
    val attrs = intArrayOf(android.R.attr.selectableItemBackground)
    val ta = ctx.obtainStyledAttributes(attrs)
    foreground = ta.getDrawable(0)
    ta.recycle()
}

/**
 * Shared "quiet state" component: icon (line-art from the shared icon set, never
 * emoji) + one bold line + one muted line. Use for every list-shaped surface with
 * nothing captured yet (Network, Logs, Console, Storage, Breakpoints) instead of
 * leaving the surface blank — "quiet states over empty states" (DESIGN.md) means
 * a quiet *message*, not silence.
 */
internal fun buildEmptyState(ctx: Context, title: String, subtitle: String, iconRes: Int = R.drawable.hakka_ic_inbox): LinearLayout =
    LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(ctx.resources, 32), dp(ctx.resources, 56), dp(ctx.resources, 32), dp(ctx.resources, 56))
        addView(ImageView(ctx).apply {
            setImageResource(iconRes)
            @Suppress("DEPRECATION") setColorFilter(Theme.textTertiary(ctx), PorterDuff.Mode.SRC_IN)
            layoutParams = LinearLayout.LayoutParams(dp(ctx.resources, 40), dp(ctx.resources, 40)).apply {
                gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(ctx.resources, Theme.s12)
            }
        })
        addView(TextView(ctx).apply {
            text = title; textSize = GeneratedMetrics.FontSize.lg.toFloat(); setTypeface(null, Typeface.BOLD)
            setTextColor(Theme.text(ctx)); gravity = Gravity.CENTER
        })
        addView(TextView(ctx).apply {
            text = subtitle; textSize = GeneratedMetrics.FontSize.sm.toFloat()
            setTextColor(Theme.textSecondary(ctx)); gravity = Gravity.CENTER
            setPadding(0, dp(ctx.resources, Theme.s4), 0, 0)
        })
    }

/** Haptic feedback helpers. API 26+ (VibrationEffect). */
internal object Haptics {
    fun light(context: Context) = vibrate(context, 10)
    fun medium(context: Context) = vibrate(context, 25)
    fun success(context: Context) = vibrate(context, 15)
    fun warning(context: Context) = vibrate(context, 30)

    @Suppress("DEPRECATION")
    private fun vibrate(context: Context, ms: Long) {
        val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            vibrator.vibrate(ms)
        }
    }
}
