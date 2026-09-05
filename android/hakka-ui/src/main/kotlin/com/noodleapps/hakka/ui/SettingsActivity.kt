package com.noodleapps.hakka.ui

import android.app.Activity
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.noodleapps.hakka.HakkaInterceptor
import java.util.Locale

/**
 * Settings — reached via the persistent header gear on every [HakkaActivity] tab.
 *
 * Two halves:
 * - Controls: max records, retention, redact body fields, desktop bridge — mirrors
 *   `SettingsTab` (web) / `SettingsPanel` (RN) / `SettingsView` (iOS). Reads/writes the live
 *   [HakkaInterceptor.config] via [HakkaUI.attachInterceptor] — session-only exactly like iOS
 *   (no persistence layer; resets to whatever `Hakka.install {}` configured on relaunch).
 *   Disabled (not hidden) when no interceptor is attached, which only happens if a host wires
 *   [HakkaUI] manually without going through [Hakka.install] — never a silent no-op. Built by
 *   [buildControls] (SettingsControls.kt).
 * - Environment: read-only device/app/locale/screen/network diagnostics — this was the whole
 *   screen before, kept below Controls, same grouping the other three platforms use. Built by
 *   [buildInfoRows] (SettingsEnvironment.kt).
 *
 * Knobs the other platforms have that Android's engine doesn't support are intentionally
 * absent here: theme preset / panel opacity / log-to-console / call-stack capture (web-only,
 * no Android equivalent), session export/import (RN-only). `traceEnabled` exists in
 * `HakkaConfig` but wasn't part of the common cross-platform set this pass targets.
 */
class SettingsActivity : Activity() {

    private var interceptor: HakkaInterceptor? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try { initUI() } catch (_: Exception) { finish() }
    }

    private fun initUI() {
        interceptor = HakkaUI.getInstance(this).interceptor
        window.navigationBarColor = Theme.bg(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Theme.bg(this@SettingsActivity))
            fitsSystemWindows = true
        }

        root.addView(buildHeader())

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(GeneratedMetrics.Layout.gutter), dp(Theme.s8), dp(GeneratedMetrics.Layout.gutter), dp(Theme.s16))
        }

        buildControls(this, content, interceptor)
        addOverline(this, content, "Environment")
        buildInfoRows(this, content)

        root.addView(ScrollView(this).apply {
            setBackgroundColor(Theme.bg(this@SettingsActivity))
            addView(content)
        }, LinearLayout.LayoutParams(MP, 0, 1f))

        setContentView(root)
        applySystemStatusBar(window, this)
    }

    // ── Header ────────────────────────────────────────────────────────────

    private fun buildHeader() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Theme.surface(this@SettingsActivity))
        setPadding(dp(GeneratedMetrics.Layout.gutter), dp(Theme.s10), dp(GeneratedMetrics.Layout.gutter), dp(Theme.s10))

        addView(ImageView(context).apply {
            setImageResource(R.drawable.hakka_ic_back)
            setColorFilter(Theme.text(this@SettingsActivity))
            val circle = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Theme.surfaceRaised(this@SettingsActivity))
            }
            background = circle
            layoutParams = LinearLayout.LayoutParams(dp(32), dp(32)).apply {
                setMargins(0, 0, dp(Theme.s8), 0)
            }
            isClickable = true; isFocusable = true
            addRipple(this@SettingsActivity)
            setOnClickListener { finish() }
        })

        addView(TextView(context).apply {
            text = "Settings"; textSize = GeneratedMetrics.FontSize.xl.toFloat(); setTypeface(null, Typeface.BOLD)
            setTextColor(Theme.text(this@SettingsActivity))
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
        })
    }

    private fun dp(dp: Int): Int = dp(resources, dp)
}

/** Uppercase, letterspaced group label — visually lighter than [SettingsEnvironment.kt]'s
 *  `addSection` headers so "Controls"/"Environment" read as super-groups, not another
 *  category. Shared between [SettingsActivity.initUI] and [buildControls]. */
internal fun addOverline(activity: Activity, parent: LinearLayout, title: String) {
    parent.addView(TextView(activity).apply {
        text = title.uppercase(Locale.US); textSize = GeneratedMetrics.FontSize.xs.toFloat()
        setTypeface(null, Typeface.BOLD); letterSpacing = 0.05f
        setTextColor(Theme.textTertiary(activity))
        setPadding(0, dp(activity.resources, Theme.s16), 0, dp(activity.resources, Theme.s4))
    })
}
