package com.noodleapps.hakka.ui

import android.app.Activity
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.noodleapps.hakka.ThrottleConfig
import com.noodleapps.hakka.ThrottleEngine
import com.noodleapps.hakka.ThrottleProfile

/**
 * ThrottlePanel — native Android UI for [ThrottleEngine], embedded as the
 * "Throttle" section of [RulesTabController]'s segmented switch (Mocks | Breakpoints |
 * Throttle — see [MocksPanel] for the Mocks section).
 *
 * Displays a profile picker that mirrors the web ThrottleTab:
 * - Off (none)
 * - Fast 3G
 * - Slow 3G
 * - Edge
 * - Offline (all requests fail)
 *
 * The active profile is highlighted. Selecting a profile updates the shared
 * [ThrottleEngine] immediately. The status line below the picker shows the
 * active latency + bandwidth for the selected profile. Call [onResume] from the
 * hosting Activity's lifecycle method to refresh the highlighted profile.
 */
internal class ThrottlePanel(private val activity: Activity) {

    private val engine get() = ThrottleEngine.shared

    private lateinit var statusLabel: TextView
    private val profileViews = mutableMapOf<ThrottleProfile, TextView>()

    fun onResume() {
        refresh()
    }

    // ── View construction ─────────────────────────────────────────────────────

    fun buildView(): View {
        val scroll = ScrollView(activity)
        val scrollContent = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(Theme.s16), dp(Theme.s12), dp(Theme.s16), dp(Theme.s16))
        }

        scrollContent.addView(buildSectionLabel("Network Throttle"))
        scrollContent.addView(buildProfilePicker())
        scrollContent.addView(buildStatusSection())
        scrollContent.addView(buildInfoSection())

        scroll.addView(scrollContent)
        refresh()
        return scroll
    }

    private fun buildSectionLabel(text: String) = TextView(activity).apply {
        this.text = text; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
        setTextColor(Theme.textSecondary(activity))
        layoutParams = LinearLayout.LayoutParams(MP, WC).apply {
            setMargins(0, 0, 0, dp(Theme.s8))
        }
    }

    // ── Profile picker ────────────────────────────────────────────────────────

    private val PROFILES = listOf(
        ThrottleProfile.NONE     to "Off",
        ThrottleProfile.FAST_3G  to "Fast 3G",
        ThrottleProfile.SLOW_3G  to "Slow 3G",
        ThrottleProfile.EDGE     to "Edge",
        ThrottleProfile.OFFLINE  to "Offline",
    )

    private fun buildProfilePicker(): View {
        val container = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                cornerRadius = dp(Theme.radiusL).toFloat()
                setColor(Theme.surface(activity))
            }
        }

        PROFILES.forEachIndexed { index, (profile, label) ->
            val row = buildProfileRow(profile, label)
            profileViews[profile] = row.findViewWithTag<TextView>("profileLabel")
            container.addView(row)

            // Divider between rows (not after last)
            if (index < PROFILES.lastIndex) {
                container.addView(View(activity).apply {
                    setBackgroundColor(Theme.border(activity))
                    layoutParams = LinearLayout.LayoutParams(MP, dp(1)).apply {
                        setMargins(dp(Theme.s16), 0, dp(Theme.s16), 0)
                    }
                })
            }
        }

        return container
    }

    private fun buildProfileRow(profile: ThrottleProfile, label: String): LinearLayout {
        return LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(Theme.s16), dp(Theme.s14), dp(Theme.s16), dp(Theme.s14))
            isClickable = true; isFocusable = true
            addRipple(activity)
            setOnClickListener {
                engine.setProfile(profile)
                Haptics.light(activity)
                refresh()
            }

            addView(TextView(activity).apply {
                tag = "profileLabel"
                text = label; textSize = GeneratedMetrics.FontSize.lg.toFloat()
                setTextColor(Theme.text(activity))
                layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
            })

            val hint = profileHint(profile)
            if (hint.isNotEmpty()) {
                addView(TextView(activity).apply {
                    text = hint; textSize = GeneratedMetrics.FontSize.sm.toFloat()
                    setTextColor(Theme.textSecondary(activity))
                    layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
                        setMargins(0, 0, dp(Theme.s8), 0)
                    }
                })
            }

            // Checkmark (hidden by default; shown when active) — vector icon, not a glyph.
            addView(ImageView(activity).apply {
                tag = "checkmark"
                setImageResource(R.drawable.hakka_ic_check)
                setColorFilter(Theme.accent(activity))
                layoutParams = LinearLayout.LayoutParams(dp(16), dp(16))
                visibility = View.INVISIBLE
            })
        }
    }

    private fun profileHint(profile: ThrottleProfile): String = when (profile) {
        ThrottleProfile.NONE    -> ""
        ThrottleProfile.FAST_3G -> "150ms · 1500 kbps"
        ThrottleProfile.SLOW_3G -> "400ms · 400 kbps"
        ThrottleProfile.EDGE    -> "250ms · 240 kbps"
        ThrottleProfile.OFFLINE -> "drops all requests"
        ThrottleProfile.CUSTOM  -> "custom"
    }

    // ── Status section ────────────────────────────────────────────────────────

    private fun buildStatusSection(): View {
        statusLabel = TextView(activity).apply {
            textSize = GeneratedMetrics.FontSize.sm.toFloat()
            setTextColor(Theme.textSecondary(activity))
            setPadding(0, dp(Theme.s12), 0, 0)
        }
        return statusLabel
    }

    // ── Info section ──────────────────────────────────────────────────────────

    private fun buildInfoSection(): View {
        return LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(Theme.s16), 0, 0)

            addView(TextView(activity).apply {
                text = "Throttle adds latency before each request and limits download bandwidth " +
                    "by dripping response bytes at the configured rate.\n\n" +
                    "Offline mode causes all matching requests to fail with a connection error."
                textSize = GeneratedMetrics.FontSize.sm.toFloat()
                setTextColor(Theme.textSecondary(activity))
                layoutParams = LinearLayout.LayoutParams(MP, WC)
            })
        }
    }

    // ── Refresh ───────────────────────────────────────────────────────────────

    private fun refresh() {
        val active = engine.config.profile

        for ((profile, labelView) in profileViews) {
            val isSelected = profile == active
            labelView.setTextColor(
                if (isSelected) Theme.accent(activity) else Theme.text(activity)
            )
            val row = labelView.parent as? LinearLayout ?: continue
            row.findViewWithTag<ImageView>("checkmark")?.visibility =
                if (isSelected) View.VISIBLE else View.INVISIBLE
        }

        if (::statusLabel.isInitialized) statusLabel.text = formatStatus(engine.config)
    }

    private fun formatStatus(config: ThrottleConfig): String = when (config.profile) {
        ThrottleProfile.NONE    -> "Throttle off — requests pass through normally."
        ThrottleProfile.OFFLINE -> "Offline — all requests will fail with a connection error."
        else                    -> buildString {
            append("Active: ${profileDisplayName(config.profile)}")
            if (config.latencyMs > 0) append(" · +${config.latencyMs}ms latency")
            if (config.downloadKbps > 0) append(" · ${config.downloadKbps} kbps download")
        }
    }

    private fun profileDisplayName(profile: ThrottleProfile): String = when (profile) {
        ThrottleProfile.NONE    -> "Off"
        ThrottleProfile.FAST_3G -> "Fast 3G"
        ThrottleProfile.SLOW_3G -> "Slow 3G"
        ThrottleProfile.EDGE    -> "Edge"
        ThrottleProfile.OFFLINE -> "Offline"
        ThrottleProfile.CUSTOM  -> "Custom"
    }

    private fun dp(dp: Int): Int = dp(activity.resources, dp)
}
