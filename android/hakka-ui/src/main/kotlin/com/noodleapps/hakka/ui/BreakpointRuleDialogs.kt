package com.noodleapps.hakka.ui

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.noodleapps.hakka.BreakpointEngine
import com.noodleapps.hakka.BreakpointPhase
import com.noodleapps.hakka.BreakpointRule
import com.noodleapps.hakka.BreakpointRuleInput
import com.noodleapps.hakka.PausedEntry
import com.noodleapps.hakka.PausedRequestEdits
import com.noodleapps.hakka.PausedResponseEdits

/**
 * [BreakpointsPanel]'s [AlertDialog]-based editors — the paused-entry edit
 * dialogs (edit-in-flight request/response before resuming) and the add/edit
 * rule dialog. Split out purely for file size.
 */
internal fun showEditRequestDialog(activity: Activity, engine: BreakpointEngine, entry: PausedEntry) {
    val req = entry.request ?: return

    val layout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(activity.resources, Theme.s16), dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s16), dp(activity.resources, Theme.s8))
    }

    val urlField = EditText(activity).apply {
        hint = "URL"; setText(req.url); textSize = GeneratedMetrics.FontSize.md.toFloat()
        setTextColor(Theme.text(activity))
    }
    val methodField = EditText(activity).apply {
        hint = "Method"; setText(req.method); textSize = GeneratedMetrics.FontSize.md.toFloat()
        setTextColor(Theme.text(activity))
    }
    val headersField = EditText(activity).apply {
        hint = "Headers (key: value, one per line)"
        setText(req.headers.entries.joinToString("\n") { "${it.key}: ${it.value}" })
        textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
        minLines = 3; inputType = InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_CLASS_TEXT
        setTextColor(Theme.text(activity))
    }
    val bodyField = EditText(activity).apply {
        hint = "Body (optional)"
        setText(req.body ?: "")
        textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
        minLines = 4; inputType = InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_CLASS_TEXT
        setTextColor(Theme.text(activity))
    }

    layout.addView(grayText(activity, "URL", 11f))
    layout.addView(urlField)
    layout.addView(grayText(activity, "Method", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) })
    layout.addView(methodField)
    layout.addView(grayText(activity, "Headers", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) })
    layout.addView(headersField)
    layout.addView(grayText(activity, "Body", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) })
    layout.addView(bodyField)

    AlertDialog.Builder(activity)
        .setTitle("Edit Request")
        .setView(ScrollView(activity).apply { addView(layout) })
        .setPositiveButton("Resume with edits") { _, _ ->
            val edits = PausedRequestEdits(
                url = urlField.text.toString().trim().ifEmpty { null },
                method = methodField.text.toString().trim().ifEmpty { null },
                headers = parseHeaderLines(headersField.text.toString()),
                body = bodyField.text.toString().ifEmpty { null },
            )
            engine.resumeRequest(entry.id, edits)
        }
        .setNeutralButton("Resume as-is") { _, _ -> engine.resumeRequest(entry.id) }
        .setNegativeButton("Abort") { _, _ -> engine.abort(entry.id) }
        .show()
}

internal fun showEditResponseDialog(activity: Activity, engine: BreakpointEngine, entry: PausedEntry) {
    val resp = entry.response ?: return

    val layout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(activity.resources, Theme.s16), dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s16), dp(activity.resources, Theme.s8))
    }

    val statusField = EditText(activity).apply {
        hint = "Status code"; setText(resp.status.toString()); textSize = GeneratedMetrics.FontSize.md.toFloat()
        inputType = InputType.TYPE_CLASS_NUMBER
        setTextColor(Theme.text(activity))
    }
    val headersField = EditText(activity).apply {
        hint = "Headers (key: value, one per line)"
        setText(resp.headers.entries.joinToString("\n") { "${it.key}: ${it.value}" })
        textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
        minLines = 3; inputType = InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_CLASS_TEXT
        setTextColor(Theme.text(activity))
    }
    val bodyField = EditText(activity).apply {
        hint = "Body"; setText(resp.body); textSize = GeneratedMetrics.FontSize.sm.toFloat(); setTypeface(Typeface.MONOSPACE)
        minLines = 5; inputType = InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_CLASS_TEXT
        setTextColor(Theme.text(activity))
    }

    layout.addView(grayText(activity, "Status", 11f))
    layout.addView(statusField)
    layout.addView(grayText(activity, "Headers", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) })
    layout.addView(headersField)
    layout.addView(grayText(activity, "Body", 11f).apply { setPadding(0, dp(activity.resources, Theme.s8), 0, 0) })
    layout.addView(bodyField)

    AlertDialog.Builder(activity)
        .setTitle("Edit Response")
        .setView(ScrollView(activity).apply { addView(layout) })
        .setPositiveButton("Resume with edits") { _, _ ->
            val status = statusField.text.toString().toIntOrNull()
            val edits = PausedResponseEdits(
                status = status,
                headers = parseHeaderLines(headersField.text.toString()),
                body = bodyField.text.toString().ifEmpty { null },
            )
            engine.resumeResponse(entry.id, edits)
        }
        .setNeutralButton("Resume as-is") { _, _ -> engine.resumeResponse(entry.id) }
        .setNegativeButton("Abort") { _, _ -> engine.abort(entry.id) }
        .show()
}

internal fun showRuleDialog(activity: Activity, engine: BreakpointEngine, existing: BreakpointRule?) {
    val layout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(activity.resources, Theme.s16), dp(activity.resources, Theme.s8), dp(activity.resources, Theme.s16), dp(activity.resources, Theme.s8))
    }

    val patternField = EditText(activity).apply {
        hint = "URL substring (e.g. /api/users)"
        setText(existing?.pattern ?: "")
        textSize = GeneratedMetrics.FontSize.md.toFloat(); setTypeface(Typeface.MONOSPACE)
        setTextColor(Theme.text(activity))
    }

    val methodField = EditText(activity).apply {
        hint = "Method filter (blank = any)"
        setText(existing?.method ?: "")
        textSize = GeneratedMetrics.FontSize.md.toFloat()
        setTextColor(Theme.text(activity))
    }

    // Phase selector — simple 3-option chip row
    var selectedPhase = existing?.on ?: BreakpointPhase.REQUEST
    val phaseRow = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
    val phaseLabels = listOf(
        BreakpointPhase.REQUEST to "Request",
        BreakpointPhase.RESPONSE to "Response",
        BreakpointPhase.BOTH to "Both",
    )
    val phaseViews = phaseLabels.map { (_, label) ->
        TextView(activity).apply {
            text = label; textSize = GeneratedMetrics.FontSize.sm.toFloat(); gravity = Gravity.CENTER
            setPadding(dp(activity.resources, Theme.s10), dp(activity.resources, Theme.s6), dp(activity.resources, Theme.s10), dp(activity.resources, Theme.s6))
            layoutParams = LinearLayout.LayoutParams(0, WC, 1f).apply {
                setMargins(0, 0, dp(activity.resources, Theme.s4), 0)
            }
            isClickable = true; isFocusable = true
            addRipple(activity)
        }
    }

    fun updatePhaseSelection() {
        phaseLabels.forEachIndexed { i, (phase, _) ->
            val active = phase == selectedPhase
            val tv = phaseViews[i]
            tv.setTextColor(if (active) Theme.badgeText else Theme.text(activity))
            tv.background = GradientDrawable().apply {
                cornerRadius = dp(activity.resources, Theme.radiusM).toFloat()
                setColor(if (active) Theme.accent(activity) else Theme.surfaceRaised(activity))
            }
        }
    }
    phaseLabels.forEachIndexed { i, (phase, _) ->
        phaseViews[i].setOnClickListener {
            selectedPhase = phase
            updatePhaseSelection()
        }
        phaseRow.addView(phaseViews[i])
    }
    updatePhaseSelection()

    val enabledCheck = CheckBox(activity).apply {
        text = "Enabled"
        isChecked = existing?.enabled ?: true
        setTextColor(Theme.text(activity))
    }

    layout.addView(grayText(activity, "URL Pattern", 11f))
    layout.addView(patternField)
    layout.addView(grayText(activity, "HTTP Method (optional)", 11f).apply {
        setPadding(0, dp(activity.resources, Theme.s8), 0, 0)
    })
    layout.addView(methodField)
    layout.addView(grayText(activity, "Pause on phase", 11f).apply {
        setPadding(0, dp(activity.resources, Theme.s8), 0, dp(activity.resources, Theme.s4))
    })
    layout.addView(phaseRow)
    layout.addView(enabledCheck.apply {
        setPadding(0, dp(activity.resources, Theme.s8), 0, 0)
    })

    val title = if (existing == null) "Add Breakpoint" else "Edit Breakpoint"
    AlertDialog.Builder(activity)
        .setTitle(title)
        .setView(layout)
        .setPositiveButton(if (existing == null) "Add" else "Save") { _, _ ->
            val pattern = patternField.text.toString()
            val method = methodField.text.toString().trim().uppercase().ifEmpty { null }
            val enabled = enabledCheck.isChecked
            if (existing == null) {
                engine.addBreakpoint(BreakpointRuleInput(
                    pattern = pattern,
                    method = method,
                    on = selectedPhase,
                    enabled = enabled,
                ))
                Toast.makeText(activity, "Breakpoint added", Toast.LENGTH_SHORT).show()
            } else {
                engine.removeBreakpoint(existing.id)
                engine.addBreakpoint(BreakpointRuleInput(
                    pattern = pattern,
                    method = method,
                    on = selectedPhase,
                    enabled = enabled,
                    id = existing.id,
                ))
                Toast.makeText(activity, "Breakpoint updated", Toast.LENGTH_SHORT).show()
            }
        }
        .setNegativeButton("Cancel", null)
        .apply {
            if (existing != null) {
                setNeutralButton("Delete") { _, _ ->
                    engine.removeBreakpoint(existing.id)
                    Toast.makeText(activity, "Breakpoint removed", Toast.LENGTH_SHORT).show()
                }
            }
        }
        .show()
}

/** Parse "Key: Value\nKey2: Value2" lines into a map. */
private fun parseHeaderLines(text: String): Map<String, String>? {
    if (text.isBlank()) return null
    val map = LinkedHashMap<String, String>()
    for (line in text.lines()) {
        val colon = line.indexOf(':')
        if (colon < 1) continue
        val key = line.substring(0, colon).trim()
        val value = line.substring(colon + 1).trim()
        if (key.isNotEmpty()) map[key] = value
    }
    return map.ifEmpty { null }
}
