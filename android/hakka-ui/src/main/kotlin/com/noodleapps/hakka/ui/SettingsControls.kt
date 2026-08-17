package com.noodleapps.hakka.ui

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import com.noodleapps.hakka.HakkaInterceptor
import com.noodleapps.hakka.connectBridge

/**
 * [SettingsActivity]'s "Controls" section — max records, retention, redact body
 * fields, desktop bridge. Split out purely for file size; reads/writes the same
 * live [HakkaInterceptor.config] the activity passes in, so behavior is
 * unchanged from when this lived inline (see the class doc on [SettingsActivity]
 * for the full session-only / no-persistence contract).
 */
private const val DEFAULT_BRIDGE_URL = "ws://localhost:8989"
private val RETENTION_OPTIONS: List<Pair<String, Long?>> = listOf(
    "Forever" to null,
    "1 hour" to 3_600_000L,
    "6 hours" to 21_600_000L,
    "1 day" to 86_400_000L,
    "1 week" to 604_800_000L,
)

internal fun buildControls(activity: Activity, parent: LinearLayout, ic: HakkaInterceptor?) {
    addOverline(activity, parent, "Controls")
    if (ic == null) {
        parent.addView(TextView(activity).apply {
            text = "Not available in this session — the host app wired the inspector " +
                "without Hakka.install(), so there's no live interceptor to configure."
            textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTextColor(Theme.textTertiary(activity))
            setPadding(0, 0, 0, dp(activity.resources, Theme.s8))
        })
    }
    buildMaxRecordsRow(activity, parent, ic)
    parent.addView(divider(activity))
    buildRetentionRow(activity, parent, ic)
    parent.addView(divider(activity))
    buildRedactBodyRow(activity, parent, ic)
    parent.addView(divider(activity))
    buildBridgeRow(activity, parent, ic)
    parent.addView(divider(activity))
}

/** Ring buffer capacity — [HakkaInterceptor.updateConfig] propagates to the retention
 *  policy immediately; the next captured request enforces the new bound. */
private fun buildMaxRecordsRow(activity: Activity, parent: LinearLayout, ic: HakkaInterceptor?) {
    val field = EditText(activity).apply {
        setText((ic?.config?.maxRequests ?: 500).toString())
        textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
        setTextColor(Theme.text(activity))
        gravity = Gravity.END
        isSingleLine = true
        inputType = InputType.TYPE_CLASS_NUMBER
        imeOptions = EditorInfo.IME_ACTION_DONE
        isEnabled = ic != null
        background = fieldBackground(activity)
        setPadding(dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s6), dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s6))
        layoutParams = LinearLayout.LayoutParams(dp(activity.resources, 64), WC)
    }
    fun commit() {
        val clamped = (field.text.toString().toIntOrNull() ?: return).coerceIn(10, 5000)
        field.setText(clamped.toString())
        ic?.updateConfig { it.copy(maxRequests = clamped) }
    }
    field.setOnFocusChangeListener { _, hasFocus -> if (!hasFocus) commit() }
    field.setOnEditorActionListener { _, actionId, _ ->
        if (actionId == EditorInfo.IME_ACTION_DONE) { commit(); true } else false
    }
    parent.addView(LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setPadding(0, dp(activity.resources, Theme.s10), 0, dp(activity.resources, Theme.s10))
        addView(inlineLabel(activity, "Max records", "Ring buffer capacity (10–5000)"))
        addView(field)
    })
}

/** Age-based retention — [HakkaInterceptor.config]'s `maxAgeMs` is enforced by the
 *  retention policy on the next captured request, same lazy-enforcement semantics
 *  as [buildMaxRecordsRow]. */
private fun buildRetentionRow(activity: Activity, parent: LinearLayout, ic: HakkaInterceptor?) {
    var activeMs: Long? = ic?.config?.maxAgeMs
    val chipRow = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }

    fun refreshChips() {
        chipRow.removeAllViews()
        for ((label, ms) in RETENTION_OPTIONS) {
            chipRow.addView(retentionChip(activity, label, ms == activeMs, ic != null) {
                if (ic == null) return@retentionChip
                activeMs = ms
                ic.updateConfig { it.copy(maxAgeMs = ms) }
                refreshChips()
            })
        }
    }
    refreshChips()

    parent.addView(LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(activity.resources, Theme.s10), 0, dp(activity.resources, Theme.s10))
        addView(stackedLabel(activity, "Retention", "Drop captures older than this age"))
        addView(HorizontalScrollView(activity).apply {
            isHorizontalScrollBarEnabled = false
            setPadding(0, dp(activity.resources, Theme.s6), 0, 0)
            addView(chipRow)
        })
    })
}

/** JSON body field redaction — applied per-request at capture time (the capture
 *  processor reads `sensitiveBodyFields` fresh on every enqueue), so this affects
 *  new captures only, never retroactively. */
private fun buildRedactBodyRow(activity: Activity, parent: LinearLayout, ic: HakkaInterceptor?) {
    val field = EditText(activity).apply {
        setText((ic?.config?.sensitiveBodyFields ?: emptySet()).sorted().joinToString(", "))
        textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
        setTextColor(Theme.text(activity))
        hint = "password, token, ssn"
        setHintTextColor(Theme.textTertiary(activity))
        isSingleLine = true
        imeOptions = EditorInfo.IME_ACTION_DONE
        isEnabled = ic != null
        background = fieldBackground(activity)
        setPadding(dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s6), dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s6))
        layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
    }
    fun commit() {
        val fields = field.text.toString().split(",").map { it.trim() }.filter { it.isNotEmpty() }
        field.setText(fields.joinToString(", "))
        ic?.updateConfig { it.copy(sensitiveBodyFields = fields.toSet()) }
    }
    field.setOnFocusChangeListener { _, hasFocus -> if (!hasFocus) commit() }
    field.setOnEditorActionListener { _, actionId, _ ->
        if (actionId == EditorInfo.IME_ACTION_DONE) { commit(); true } else false
    }
    parent.addView(LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(activity.resources, Theme.s10), 0, dp(activity.resources, Theme.s10))
        addView(stackedLabel(
            activity,
            "Redact body fields",
            "Mask these JSON keys in captured bodies (comma-separated, case-insensitive)",
        ))
        addView(LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(activity.resources, Theme.s6), 0, 0)
            addView(field)
            addView(applyButton(activity) { commit() }.apply {
                layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
                    setMargins(dp(activity.resources, Theme.s6), 0, 0, 0)
                }
            })
        })
    })
}

/**
 * Desktop bridge connect/disconnect. Android's `connectBridge` returns only an
 * [AutoCloseable] (no connection-state callback like iOS's `BridgeConnectionState`) — the
 * status line below can say "Streaming to <url>" or "Disconnected" but never
 * "Connected"/"Connecting"/"Error", because the engine doesn't expose that. The connection
 * this toggle opens is tracked on [HakkaUI] (survives leaving this screen), mirroring
 * iOS's `SettingsView.bridgeClient`, which is likewise separate from any `bridgeUrl` set at
 * `Hakka.install {}` time — toggling here can't tear down an install-time-configured
 * bridge sink either, same limitation iOS has.
 */
private fun buildBridgeRow(activity: Activity, parent: LinearLayout, ic: HakkaInterceptor?) {
    val ui = HakkaUI.getInstance(activity)
    var enabled = ui.bridgeConnection != null || ic?.config?.bridgeUrl != null

    val statusLabel = TextView(activity).apply {
        textSize = GeneratedMetrics.FontSize.xs.toFloat()
        setPadding(0, dp(activity.resources, Theme.s4), 0, dp(activity.resources, Theme.s6))
    }
    val urlField = EditText(activity).apply {
        setText(ic?.config?.bridgeUrl ?: DEFAULT_BRIDGE_URL)
        textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
        setTextColor(Theme.text(activity))
        hint = DEFAULT_BRIDGE_URL
        setHintTextColor(Theme.textTertiary(activity))
        isSingleLine = true
        inputType = InputType.TYPE_TEXT_VARIATION_URI
        imeOptions = EditorInfo.IME_ACTION_DONE
        isEnabled = ic != null
        background = fieldBackground(activity)
        setPadding(dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s6), dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s6))
        layoutParams = LinearLayout.LayoutParams(0, WC, 1f)
    }

    fun updateStatus() {
        if (enabled) {
            statusLabel.text = "Streaming to ${urlField.text}"
            statusLabel.setTextColor(Theme.success)
        } else {
            statusLabel.text = "Disconnected"
            statusLabel.setTextColor(Theme.textSecondary(activity))
        }
    }

    fun applyConnection() {
        ui.bridgeConnection?.close()
        ui.bridgeConnection = null
        if (enabled) {
            val url = urlField.text.toString().ifBlank { DEFAULT_BRIDGE_URL }
            urlField.setText(url)
            ic?.updateConfig { it.copy(bridgeUrl = url) }
            ui.bridgeConnection = ic?.connectBridge(url)
        } else {
            ic?.updateConfig { it.copy(bridgeUrl = null) }
        }
        updateStatus()
    }
    updateStatus()

    val toggle = Switch(activity).apply {
        isChecked = enabled
        isEnabled = ic != null
        setOnCheckedChangeListener { _, isChecked ->
            enabled = isChecked
            applyConnection()
        }
    }

    parent.addView(LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(activity.resources, Theme.s10), 0, dp(activity.resources, Theme.s10))
        addView(LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(inlineLabel(activity, "Connect to desktop", "Stream captures to the Hakka desktop app"))
            addView(toggle)
        })
        addView(statusLabel)
        addView(LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(urlField)
            addView(applyButton(activity) { if (enabled) applyConnection() }.apply {
                layoutParams = LinearLayout.LayoutParams(WC, WC).apply {
                    setMargins(dp(activity.resources, Theme.s6), 0, 0, 0)
                }
            })
        })
    })
}

// ── Control building blocks ──────────────────────────────────────────

private fun controlTitle(activity: Activity, title: String) = TextView(activity).apply {
    text = title; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
    setTextColor(Theme.text(activity))
}

private fun controlHint(activity: Activity, hint: String) = TextView(activity).apply {
    text = hint; textSize = GeneratedMetrics.FontSize.sm.toFloat()
    setTextColor(Theme.textTertiary(activity))
    setPadding(0, dp(activity.resources, GeneratedMetrics.Spacing.xxs), 0, 0)
}

/** Label+hint stack that shrinks to leave room for an inline control (switch/field) to its right. */
private fun inlineLabel(activity: Activity, title: String, hint: String) = LinearLayout(activity).apply {
    orientation = LinearLayout.VERTICAL
    layoutParams = LinearLayout.LayoutParams(0, WC, 1f).apply { setMargins(0, 0, dp(activity.resources, Theme.s8), 0) }
    addView(controlTitle(activity, title)); addView(controlHint(activity, hint))
}

/** Label+hint stack for a full-width row whose control sits on the line below. */
private fun stackedLabel(activity: Activity, title: String, hint: String) = LinearLayout(activity).apply {
    orientation = LinearLayout.VERTICAL
    addView(controlTitle(activity, title)); addView(controlHint(activity, hint))
}

private fun fieldBackground(activity: Activity) = GradientDrawable().apply {
    setColor(Theme.surface(activity)); cornerRadius = dp(activity.resources, Theme.radiusM).toFloat()
}

/** Tinted pill button — same shape as [BreakpointsPanel]'s actionButton. */
private fun applyButton(activity: Activity, label: String = "Apply", onClick: () -> Unit) = TextView(activity).apply {
    text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(null, Typeface.BOLD)
    val accent = Theme.accent(activity)
    setTextColor(accent)
    background = GradientDrawable().apply {
        cornerRadius = dp(activity.resources, Theme.radiusM).toFloat()
        setColor(Color.argb(26, Color.red(accent), Color.green(accent), Color.blue(accent)))
    }
    setPadding(dp(activity.resources, Theme.s10), dp(activity.resources, Theme.s6), dp(activity.resources, Theme.s10), dp(activity.resources, Theme.s6))
    isClickable = true; isFocusable = true
    addRipple(activity)
    setOnClickListener { onClick() }
}

private fun retentionChip(activity: Activity, label: String, active: Boolean, enabled: Boolean, onClick: () -> Unit) =
    TextView(activity).apply {
        text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
        setTypeface(null, if (active) Typeface.BOLD else Typeface.NORMAL)
        val textColor = if (active) Theme.badgeText else Theme.textSecondary(activity)
        setTextColor(if (enabled) textColor else Color.argb(128, Color.red(textColor), Color.green(textColor), Color.blue(textColor)))
        background = GradientDrawable().apply {
            cornerRadius = dp(activity.resources, Theme.radiusM).toFloat()
            if (active) setColor(Theme.accent(activity))
            else { setColor(Color.TRANSPARENT); setStroke(dp(activity.resources, 1), Theme.border(activity)) }
        }
        setPadding(dp(activity.resources, Theme.s10), dp(activity.resources, Theme.s6), dp(activity.resources, Theme.s10), dp(activity.resources, Theme.s6))
        layoutParams = LinearLayout.LayoutParams(WC, WC).apply { setMargins(0, 0, dp(activity.resources, Theme.s6), 0) }
        isClickable = enabled; isFocusable = enabled
        if (enabled) addRipple(activity)
        setOnClickListener { onClick() }
    }
